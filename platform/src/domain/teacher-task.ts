import type { ActivityService } from './activity.js'
import { BehaviorChecker } from './behavior-checker.js'
import { StandFlagChecker, StringCompareChecker } from './checker.js'
import type { TaskLevel, TaskMode } from './catalog.js'
import { teamLimit } from './catalog.js'
import { DomainError } from './errors.js'
import type { AuthUser } from './identity.js'
import { canAuthorTask } from './identity.js'
import { requireTheme } from './themes.js'
import type { ThemeWindowService } from './theme-window-service.js'
import type { PostgresOralSessionRepository } from '../repository/accounts.js'
import type {
  PostgresTeacherTaskRepository,
  TaskVerdict,
  TeacherCheckerName,
  TeacherTaskRecord,
} from '../repository/teacher-tasks.js'
import type { AttemptRepository, TeamRepository } from '../repository/interfaces.js'

const FLAG = /^HITS\{[A-Za-z0-9_-]{4,64}\}$/
const LEVELS: readonly TaskLevel[] = ['простое', 'среднее', 'сложное']
const MODES: readonly TaskMode[] = ['тренажёр', 'очное']
const CHECKERS: readonly TeacherCheckerName[] = ['флаг', 'строка', 'патч']

const flags = new StandFlagChecker()
const strings = new StringCompareChecker()
const patches = new BehaviorChecker()

export interface TeacherTaskDraft {
  title: string
  themeKey: string
  competency: string
  mode: string
  level: string
  statement: string
  checker: string
  secret?: string
  mustHave?: string[]
  mustNot?: string[]
  attemptLimit?: number
  hints?: string[]
}

export interface TeacherTaskView {
  id: string
  title: string
  theme: string
  themeKey: string
  competency: string
  mode: TaskMode
  level: TaskLevel
  checker: TeacherCheckerName
  statement: string | null
  closed: string | null
  verdict?: TaskVerdict | null
  secret?: string
  mustHave?: string[]
  mustNot?: string[]
}

interface PatchSpec {
  type: 'config'
  mustHave: string[]
  mustNot: string[]
}

export class TeacherTaskService {
  constructor(
    private readonly tasks: PostgresTeacherTaskRepository,
    private readonly teams: TeamRepository,
    private readonly windows: ThemeWindowService,
    private readonly oral: PostgresOralSessionRepository,
    private readonly attempts: AttemptRepository,
    private readonly activity: ActivityService,
  ) {}

  async create(actor: AuthUser, draft: TeacherTaskDraft): Promise<{ id: string }> {
    if (!canAuthorTask(actor.role)) {
      throw new DomainError('Задание собирает автор', 'forbidden')
    }
    const theme = requireTheme(draft.themeKey)
    const mode = requiredMode(draft.mode)
    const level = requiredLevel(draft.level)
    const checker = requiredChecker(draft.checker)
    const title = requiredText(draft.title, 'Название', 120)
    const competency = requiredText(draft.competency, 'Компетенция', 300)
    const statement = requiredText(draft.statement, 'Условие', 4000)
    const secret = secretFor(checker, draft, statement)
    const hints = hintSteps(draft.hints, statement, secret)
    const attemptLimit = limitOf(draft.attemptLimit)
    const saved = await this.tasks.insert({
      title,
      themeKey: theme.key,
      competency,
      mode,
      level,
      statement,
      checker,
      secret,
      attemptLimit,
      authorUserId: actor.id,
    })
    if (hints.length > 0) await this.activity.saveHints(saved.id, hints)
    return { id: saved.id }
  }

  async list(actor: AuthUser, teamId: string | undefined): Promise<TeacherTaskView[]> {
    const tasks = await this.tasks.list()
    if (canAuthorTask(actor.role)) {
      return tasks.map((task) => this.present(task, { statement: true, secret: false }))
    }
    if (!teamId) throw new DomainError('Нужна команда', 'bad_request')
    await this.requireMember(teamId, actor.id)
    const verdicts = await this.tasks.verdicts(teamId, tasks.map((task) => task.id))
    return tasks.map((task) => ({
      ...this.present(task, { statement: false, secret: false }),
      verdict: verdicts.get(task.id) ?? null,
    }))
  }

  async read(actor: AuthUser, id: string, teamId?: string): Promise<TeacherTaskView> {
    const task = await this.require(id)
    if (canAuthorTask(actor.role)) {
      return this.present(task, { statement: true, secret: true })
    }
    const gate = await this.gate(actor.id, task)
    if (gate === null && teamId) {
      await this.requireMember(teamId, actor.id)
      await this.activity.record(teamId, id, 'открытие')
    }
    return {
      ...this.present(task, { statement: gate === null, secret: false }),
      closed: gate,
    }
  }

  async submit(
    actor: AuthUser,
    id: string,
    teamId: string,
    rawAnswer: string,
  ): Promise<{ result: TaskVerdict }> {
    if (actor.role !== 'студент') throw new DomainError('Сдаёт студент', 'forbidden')
    const task = await this.require(id)
    await this.requireTeam(teamId, task.themeKey)
    await this.requireMember(teamId, actor.id)
    const gate = await this.gate(actor.id, task)
    if (gate) throw new DomainError(gate, 'conflict')
    const answer = rawAnswer.normalize('NFC').trim()
    if (!answer) throw new DomainError('Пустой ответ', 'bad_request')
    await this.activity.assertCanAttempt(teamId, task.id)
    const accepted = check(task, answer)
    await this.attempts.record({
      teamId,
      taskId: task.id,
      accepted,
      foreignOwnerTeamId: null,
      artifact: null,
      answer,
      submitterUserId: actor.id,
    })
    await this.activity.noteAttempt(teamId, task.id, accepted)
    return { result: accepted ? 'зачтено' : 'не зачтено' }
  }

  private async require(id: string): Promise<TeacherTaskRecord> {
    const task = await this.tasks.findById(id)
    if (!task) throw new DomainError('Задание не найдено', 'not_found')
    return task
  }

  private async gate(userId: string, task: TeacherTaskRecord): Promise<string | null> {
    const window = await this.windows.get(task.themeKey)
    if (window.phase !== 'открыта') {
      return window.phase === 'закончилась'
        ? 'Неделя темы закончилась, пересдачи нет'
        : 'Окно темы закрыто'
    }
    if (task.mode === 'очное') {
      const joined = await this.oral.hasActiveJoin(userId, task.themeKey, task.level)
      if (!joined) return 'Очное задание открывается в своей сессии этого уровня'
    }
    return null
  }

  private present(
    task: TeacherTaskRecord,
    access: { statement: boolean; secret: boolean },
  ): TeacherTaskView {
    const theme = requireTheme(task.themeKey)
    const view: TeacherTaskView = {
      id: task.id,
      title: task.title,
      theme: theme.name,
      themeKey: task.themeKey,
      competency: task.competency,
      mode: task.mode,
      level: task.level,
      checker: task.checker,
      statement: access.statement ? task.statement : null,
      closed: null,
    }
    if (!access.secret) return view
    if (task.checker === 'патч') {
      const spec = parsePatch(task.secret)
      return { ...view, mustHave: spec.mustHave, mustNot: spec.mustNot }
    }
    return { ...view, secret: task.secret }
  }

  private async requireMember(teamId: string, userId: string): Promise<void> {
    if (!(await this.teams.hasMember(teamId, userId))) {
      throw new DomainError('Чужой результат недоступен', 'forbidden')
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
}

function check(task: TeacherTaskRecord, answer: string): boolean {
  if (task.checker === 'флаг') return flags.check(task.secret, answer).accepted
  if (task.checker === 'строка') return strings.check(task.secret, answer).accepted
  return patches.check(task.secret, answer).accepted
}

function secretFor(checker: TeacherCheckerName, draft: TeacherTaskDraft, statement: string): string {
  if (checker === 'патч') {
    const mustHave = fragments(draft.mustHave, 'Что должно появиться в исправлении')
    const mustNot = fragments(draft.mustNot ?? [], 'Чего в исправлении быть не должно')
    if (mustHave.length === 0) throw new DomainError('Нужен хотя бы один фрагмент исправления', 'bad_request')
    const overlap = mustHave.find((line) => mustNot.includes(line))
    if (overlap) throw new DomainError('Один и тот же фрагмент не может быть и нужным, и запрещённым', 'bad_request')
    if (mustHave.some((line) => statement.includes(line))) {
      throw new DomainError('Фрагмент исправления не пишется в условие', 'bad_request')
    }
    const spec: PatchSpec = { type: 'config', mustHave, mustNot }
    return JSON.stringify(spec)
  }
  const secret = (draft.secret ?? '').normalize('NFC').trim()
  if (checker === 'флаг' && !FLAG.test(secret)) {
    throw new DomainError('Флаг должен быть вида HITS{...}', 'bad_request')
  }
  if (checker === 'строка' && (secret.length === 0 || secret.length > 500)) {
    throw new DomainError('Секрет строки задаётся в паспорте', 'bad_request')
  }
  if (statement.includes(secret)) throw new DomainError('Секрет не пишется в условие', 'bad_request')
  return secret
}

function fragments(value: string[] | undefined, label: string): string[] {
  if (!value || value.length === 0) return []
  if (value.length > 12) throw new DomainError(`${label}: не больше 12 строк`, 'bad_request')
  return value.map((line) => {
    const text = line.normalize('NFC').trim()
    if (text.length === 0 || text.length > 120) throw new DomainError(`${label}: каждая строка до 120 знаков`, 'bad_request')
    return text
  })
}

function parsePatch(secret: string): PatchSpec {
  const spec = JSON.parse(secret) as PatchSpec
  return { type: 'config', mustHave: spec.mustHave, mustNot: spec.mustNot }
}

function requiredText(value: string, label: string, max: number): string {
  const text = value.normalize('NFC').trim()
  if (text.length === 0 || text.length > max) throw new DomainError(`${label}: до ${max} знаков`, 'bad_request')
  return text
}

function requiredMode(value: string): TaskMode {
  if (!MODES.includes(value as TaskMode)) throw new DomainError('Режим: домашний или очный', 'bad_request')
  return value as TaskMode
}

function requiredLevel(value: string): TaskLevel {
  if (!LEVELS.includes(value as TaskLevel)) throw new DomainError('Уровень: простое, среднее или сложное', 'bad_request')
  return value as TaskLevel
}

function hintSteps(hints: string[] | undefined, statement: string, secret: string): string[] {
  const steps = (hints ?? []).map((hint) => hint.normalize('NFC').trim()).filter((hint) => hint.length > 0)
  if (steps.length === 1 || steps.length > 3) {
    throw new DomainError('Подсказки идут двумя или тремя ступенями', 'bad_request')
  }
  if (steps.some((hint) => hint.length > 500 || statement.includes(hint) || hint.includes(secret))) {
    throw new DomainError('Подсказка не содержит секрет и не повторяет условие', 'bad_request')
  }
  return steps
}

function limitOf(value: number | undefined): number {
  if (value === undefined) return 10
  if (!Number.isInteger(value) || value < 1 || value > 50) {
    throw new DomainError('Лимит попыток от 1 до 50', 'bad_request')
  }
  return value
}

function requiredChecker(value: string): TeacherCheckerName {
  if (!CHECKERS.includes(value as TeacherCheckerName)) {
    throw new DomainError('Чекер: флаг, строка или патч', 'bad_request')
  }
  return value as TeacherCheckerName
}
