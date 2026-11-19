import { DomainError } from './errors.js'
import type { AuthUser } from './identity.js'
import type { PostgresPassportRepository } from '../repository/accounts.js'
import type { PostgresTeacherTaskRepository } from '../repository/teacher-tasks.js'
import type { AttemptRepository, JournalEntry, TeamRepository } from '../repository/interfaces.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type SolutionVerdict = 'зачтено' | 'не зачтено' | 'на проверке у преподавателя'

export interface SolutionSummary {
  id: string
  who: string
  teamName: string
  taskId: string
  taskTitle: string
  verdict: SolutionVerdict
  submittedAt: string
}

export interface SolutionDetail extends SolutionSummary {
  answer: string | null
}

export class SolutionService {
  constructor(
    private readonly attempts: AttemptRepository,
    private readonly teams: TeamRepository,
    private readonly passports: PostgresPassportRepository,
    private readonly teacherTasks: PostgresTeacherTaskRepository,
  ) {}

  async list(actor: AuthUser): Promise<SolutionSummary[]> {
    const entries = await this.attempts.listJournal(await this.scope(actor))
    const titles = await this.titles(entries.map((entry) => entry.taskId))
    return entries.map((entry) => this.summary(entry, titles))
  }

  async read(actor: AuthUser, id: string): Promise<SolutionDetail> {
    if (!UUID.test(id)) throw new DomainError('Сдача не найдена', 'not_found')
    const entry = await this.attempts.findJournal(id)
    if (!entry) throw new DomainError('Сдача не найдена', 'not_found')
    if (actor.role !== 'преподаватель' && !(await this.teams.hasMember(entry.teamId, actor.id))) {
      throw new DomainError('Чужой результат недоступен', 'forbidden')
    }
    const titles = await this.titles([entry.taskId])
    return { ...this.summary(entry, titles), answer: entry.answer }
  }

  private async scope(actor: AuthUser): Promise<string[] | null> {
    if (actor.role === 'преподаватель') return null
    return this.teams.memberTeamIds(actor.id)
  }

  private summary(entry: JournalEntry, titles: Map<string, string>): SolutionSummary {
    return {
      id: entry.id,
      who: entry.submitterName ?? entry.teamName,
      teamName: entry.teamName,
      taskId: entry.taskId,
      taskTitle: titles.get(entry.taskId) ?? entry.taskId,
      verdict: verdictOf(entry),
      submittedAt: entry.submittedAt,
    }
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

function verdictOf(entry: JournalEntry): SolutionVerdict {
  if (entry.accepted) return 'зачтено'
  if (entry.pending) return 'на проверке у преподавателя'
  return 'не зачтено'
}
