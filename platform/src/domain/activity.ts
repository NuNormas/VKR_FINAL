import { DomainError } from './errors.js'
import type { AuthUser } from './identity.js'
import type { PostgresPassportRepository } from '../repository/accounts.js'
import type { ActivityKind, PostgresActivityRepository } from '../repository/activity.js'
import type { PostgresTeacherTaskRepository } from '../repository/teacher-tasks.js'
import type { AttemptRepository, TeamRepository } from '../repository/interfaces.js'
import type { PostgresOralSessionRepository } from '../repository/accounts.js'
import type { ThemeWindowService } from './theme-window-service.js'

// Подсветка для преподавателя. На оценку это не влияет.
const FAST_MS = 30_000

export interface ActivityView {
  id: string
  teamName: string
  taskId: string
  taskTitle: string
  kind: ActivityKind
  createdAt: string
  fast?: true
}

export interface HintState {
  hintsTotal: number
  opened: { step: number; body: string; openedAt: string }[]
  attemptLimit: number
  attemptsUsed: number
}

export class ActivityService {
  constructor(
    private readonly log: PostgresActivityRepository,
    private readonly teams: TeamRepository,
    private readonly attempts: AttemptRepository,
    private readonly passports: PostgresPassportRepository,
    private readonly teacherTasks: PostgresTeacherTaskRepository,
    private readonly windows: ThemeWindowService,
    private readonly oral: PostgresOralSessionRepository,
  ) {}

  record(teamId: string, taskId: string, kind: ActivityKind): Promise<void> {
    return this.log.insert(teamId, taskId, kind, false)
  }

  async noteAttempt(teamId: string, taskId: string, accepted: boolean): Promise<void> {
    let fast = false
    if (accepted) {
      const opened = await this.log.firstAt(teamId, taskId, 'открытие')
      if (opened && Date.now() - opened.getTime() < FAST_MS) fast = true
    }
    await this.log.insert(teamId, taskId, 'попытка', fast)
  }

  async assertCanAttempt(teamId: string, taskId: string): Promise<void> {
    const limit = await this.limitOf(taskId)
    const used = await this.attempts.countFor(teamId, taskId)
    if (used >= limit) throw new DomainError('Лимит попыток исчерпан', 'conflict')
  }

  saveHints(taskId: string, bodies: string[]): Promise<void> {
    return this.log.replaceHints(taskId, bodies)
  }

  async list(actor: AuthUser, teamId: string | undefined): Promise<ActivityView[]> {
    const scope = await this.scope(actor, teamId)
    const events = await this.log.list(scope)
    const titles = await this.titles(events.map((event) => event.taskId))
    return events.map((event) => {
      const view: ActivityView = {
        id: event.id,
        teamName: event.teamName,
        taskId: event.taskId,
        taskTitle: titles.get(event.taskId) ?? event.taskId,
        kind: event.kind,
        createdAt: event.createdAt,
      }
      if (actor.role === 'преподаватель' && event.fast) view.fast = true
      return view
    })
  }

  async hints(actor: AuthUser, taskId: string, teamId: string): Promise<HintState> {
    await this.guard(actor, taskId, teamId)
    return this.state(taskId, teamId)
  }

  async openHint(actor: AuthUser, taskId: string, teamId: string): Promise<HintState> {
    await this.guard(actor, taskId, teamId)
    const steps = await this.log.hints(taskId)
    if (steps.length === 0) throw new DomainError('У задания нет подсказок', 'conflict')
    const opened = await this.log.opened(teamId, taskId)
    const next = steps.find((step) => !opened.some((item) => item.step === step.step))
    if (!next) throw new DomainError('Подсказки кончились', 'conflict')
    if (next.step !== opened.length + 1) throw new DomainError('Подсказки открываются по порядку', 'conflict')
    await this.log.openHint(teamId, taskId, next.step)
    await this.record(teamId, taskId, 'подсказка')
    return this.state(taskId, teamId)
  }

  private async state(taskId: string, teamId: string): Promise<HintState> {
    const steps = await this.log.hints(taskId)
    const opened = await this.log.opened(teamId, taskId)
    return {
      hintsTotal: steps.length,
      opened: opened.flatMap((item) => {
        const step = steps.find((candidate) => candidate.step === item.step)
        return step ? [{ step: item.step, body: step.body, openedAt: item.openedAt }] : []
      }),
      attemptLimit: await this.limitOf(taskId),
      attemptsUsed: await this.attempts.countFor(teamId, taskId),
    }
  }

  private async guard(actor: AuthUser, taskId: string, teamId: string): Promise<void> {
    if (actor.role !== 'студент') throw new DomainError('Подсказку открывает студент', 'forbidden')
    const task = await this.taskOf(taskId)
    if (!(await this.teams.hasMember(teamId, actor.id))) {
      throw new DomainError('Чужой результат недоступен', 'forbidden')
    }
    const window = await this.windows.get(task.themeKey)
    if (window.phase !== 'открыта') throw new DomainError('Окно темы закрыто', 'conflict')
    if (task.mode === 'очное') {
      const joined = await this.oral.hasActiveJoin(actor.id, task.themeKey, task.level)
      if (!joined) throw new DomainError('Очное задание открывается в своей сессии этого уровня', 'conflict')
    }
  }

  private async scope(actor: AuthUser, teamId: string | undefined): Promise<string[] | null> {
    if (actor.role === 'преподаватель') return teamId ? [teamId] : null
    if (!teamId) throw new DomainError('Нужна команда', 'bad_request')
    if (!(await this.teams.hasMember(teamId, actor.id))) {
      throw new DomainError('Чужой результат недоступен', 'forbidden')
    }
    return [teamId]
  }

  private async limitOf(taskId: string): Promise<number> {
    const passport = await this.passports.findById(taskId)
    if (passport) return passport.attemptLimit
    const custom = await this.teacherTasks.findById(taskId)
    if (custom) return custom.attemptLimit
    throw new DomainError('Задание не найдено', 'not_found')
  }

  private async taskOf(taskId: string): Promise<{ themeKey: string; mode: string; level: 'простое' | 'среднее' | 'сложное' }> {
    const passport = await this.passports.findById(taskId)
    if (passport) return passport
    const custom = await this.teacherTasks.findById(taskId)
    if (custom) return custom
    throw new DomainError('Задание не найдено', 'not_found')
  }

  private async titles(taskIds: string[]): Promise<Map<string, string>> {
    const titles = new Map<string, string>()
    for (const taskId of new Set(taskIds)) {
      const passport = await this.passports.findById(taskId)
      if (passport) {
        titles.set(taskId, passport.title)
        continue
      }
      const custom = await this.teacherTasks.findById(taskId)
      if (custom) titles.set(taskId, custom.title)
    }
    return titles
  }
}
