import { randomBytes } from 'node:crypto'
import type { ActivityService } from './activity.js'
import type { CheckerRegistry } from './checker.js'
import { teamLimit } from './catalog.js'
import { DomainError } from './errors.js'
import type { GeneratorFactory } from './generator.js'
import type { PostgresOralSessionRepository, PostgresPassportRepository } from '../repository/accounts.js'
import type { StandRuntime } from '../stands/runtime.js'
import type {
  AttemptRepository,
  IssueRepository,
  TeamRepository,
  ThemeWindowRepository,
} from '../repository/interfaces.js'

export interface OpenedTask {
  taskId: string
  condition: {
    statement: string
    ciphertext?: string
    standLabel?: string
    standUrl?: string
  }
}

// Наружу уходит условие. Seed и секрет остаются в репозитории.
export class SubmissionFacade {
  constructor(
    private readonly teams: TeamRepository,
    private readonly windows: ThemeWindowRepository,
    private readonly issues: IssueRepository,
    private readonly attempts: AttemptRepository,
    private readonly generators: GeneratorFactory,
    private readonly checkers: CheckerRegistry,
    private readonly passports: PostgresPassportRepository,
    private readonly oral: PostgresOralSessionRepository,
    private readonly stands: StandRuntime,
    private readonly activity: ActivityService,
  ) {}

  async openTask(userId: string, teamId: string, taskId: string): Promise<OpenedTask> {
    const task = await this.requirePassport(taskId)
    await this.requireTeam(teamId, task.themeKey)
    await this.requireMember(teamId, userId)
    await this.requireOpenWindow(task.themeKey)
    await this.requireOralSession(userId, task)
    await this.activity.record(teamId, taskId, 'открытие')

    const existing = await this.issues.findByTeamAndTask(teamId, taskId)
    if (existing) {
      const condition = await this.withStand(
        teamId,
        taskId,
        existing.secret,
        this.conditionFromSeed(task.generatorId, existing.seed, existing.secret),
      )
      return { taskId, condition }
    }

    const seed = randomBytes(16).toString('hex')
    const variant = this.generators.create(task.generatorId).generate(seed)
    const inserted = await this.issues.insert({
      teamId,
      taskId,
      seed,
      secret: variant.secret,
    })
    if (inserted === 'exists') {
      const raced = await this.issues.findByTeamAndTask(teamId, taskId)
      if (!raced) {
        throw new DomainError('Вариант задания не сохранился', 'internal')
      }
      const condition = await this.withStand(
        teamId,
        taskId,
        raced.secret,
        this.conditionFromSeed(task.generatorId, raced.seed, raced.secret),
      )
      return { taskId, condition }
    }
    const condition = await this.withStand(teamId, taskId, variant.secret, variant.condition)
    return { taskId, condition }
  }

  async submit(
    userId: string,
    teamId: string,
    taskId: string,
    rawAnswer: string,
  ): Promise<
    | { result: 'зачтено' | 'не зачтено' }
    | { result: 'на проверке у преподавателя'; grading: 'преподаватель' }
  > {
    const task = await this.requirePassport(taskId)
    await this.requireTeam(teamId, task.themeKey)
    await this.requireMember(teamId, userId)
    await this.requireOpenWindow(task.themeKey)
    await this.requireOralSession(userId, task)

    const issue = await this.issues.findByTeamAndTask(teamId, taskId)
    if (!issue) {
      throw new DomainError('Сначала откройте задание', 'conflict')
    }

    const variant = this.generators.create(task.generatorId).generate(issue.seed)
    if (variant.secret !== issue.secret) {
      throw new DomainError('Вариант задания повреждён', 'internal')
    }

    const answer = rawAnswer.normalize('NFC').trim()
    await this.activity.assertCanAttempt(teamId, taskId)
    const verdict = this.checkers.forKind(task.checkerKind).check(variant.secret, answer)

    if (verdict.pendingTeacher) {
      await this.attempts.record({
        teamId,
        taskId,
        accepted: false,
        foreignOwnerTeamId: null,
        artifact: answer,
        answer,
        submitterUserId: userId,
      })
      await this.activity.noteAttempt(teamId, taskId, false)
      return { result: 'на проверке у преподавателя', grading: 'преподаватель' }
    }

    let foreignOwnerTeamId: string | null = null
    if (!verdict.accepted && answer.length > 0) {
      const other = await this.issues.findOtherTeamBySecret(taskId, answer, teamId)
      if (other) foreignOwnerTeamId = other.teamId
    }

    await this.attempts.record({
      teamId,
      taskId,
      accepted: verdict.accepted,
      foreignOwnerTeamId,
      artifact: null,
      answer,
      submitterUserId: userId,
    })
    await this.activity.noteAttempt(teamId, taskId, verdict.accepted)

    return { result: verdict.accepted ? 'зачтено' : 'не зачтено' }
  }

  private async withStand(
    teamId: string,
    taskId: string,
    secret: string,
    condition: OpenedTask['condition'],
  ): Promise<OpenedTask['condition']> {
    const stand = await this.stands.ensure({ teamId, taskId, flag: secret })
    if (!stand) return condition
    if (stand.started) await this.activity.record(teamId, taskId, 'стенд')
    return { ...condition, standUrl: stand.url }
  }

  private conditionFromSeed(generatorId: string, seed: string, storedSecret: string) {
    const variant = this.generators.create(generatorId).generate(seed)
    if (variant.secret !== storedSecret) {
      throw new DomainError('Вариант задания повреждён', 'internal')
    }
    return variant.condition
  }

  private async requirePassport(taskId: string) {
    const task = await this.passports.findById(taskId)
    if (!task) throw new DomainError('Задание не найдено', 'not_found')
    return task
  }

  private async requireMember(teamId: string, userId: string): Promise<void> {
    if (!(await this.teams.hasMember(teamId, userId))) {
      throw new DomainError('Чужой результат недоступен', 'forbidden')
    }
  }

  private async requireOralSession(
    userId: string,
    task: { mode: string; themeKey: string; level: 'простое' | 'среднее' | 'сложное' },
  ): Promise<void> {
    if (task.mode !== 'очное') return
    const joined = await this.oral.hasActiveJoin(userId, task.themeKey, task.level)
    if (!joined) {
      throw new DomainError('Очное задание открывается в своей сессии этого уровня', 'conflict')
    }
  }

  private async requireTeam(teamId: string, themeKey: string): Promise<void> {
    const team = await this.teams.findById(teamId)
    if (!team) throw new DomainError('Команда не найдена', 'not_found')
    const limit = teamLimit(themeKey)
    if (team.members.length < limit.min || team.members.length > limit.max) {
      throw new DomainError(
        limit.max === 1 ? 'Эту тему выполняет один человек' : 'В команде этой темы от одного до четырёх человек',
        'conflict',
      )
    }
  }

  private async requireOpenWindow(themeKey: string): Promise<void> {
    const window = await this.windows.get(themeKey)
    window.assertAcceptsWork()
  }
}
