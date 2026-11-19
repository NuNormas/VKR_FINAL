import { OneLabPolicy, type GradeDecision, type InPersonEvidence } from './grading-policy.js'
import { DomainError } from './errors.js'
import type { AuthUser } from './identity.js'
import { requireTheme } from './themes.js'
import type { PostgresOralPathRepository, PostgresPassportRepository } from '../repository/accounts.js'
import type { PostgresActivityRepository } from '../repository/activity.js'
import type { AttemptRepository, TeamRepository } from '../repository/interfaces.js'

export interface ThemeAssessmentResult extends GradeDecision {
  theme: string
  trainerTasksTotal: number
  trainerTasksSolved: number
}

// «Несколько подсказок» на сданном сложном — две и больше. Одна подсказка пятёрку не снижает.
const SEVERAL_HINTS = 2

export class ThemeAssessment {
  constructor(
    private readonly teams: TeamRepository,
    private readonly attempts: AttemptRepository,
    private readonly passports: PostgresPassportRepository,
    private readonly hints: PostgresActivityRepository,
    private readonly paths: PostgresOralPathRepository,
    private readonly policy = new OneLabPolicy(SEVERAL_HINTS),
  ) {}

  async assess(teamId: string, themeKey: string): Promise<ThemeAssessmentResult> {
    const team = await this.teams.findById(teamId)
    if (!team) throw new DomainError('Команда не найдена', 'not_found')
    const theme = requireTheme(themeKey)
    const taskIds = await this.passports.trainerIds(theme.key)
    const trainerTasksSolved =
      taskIds.length === 0 ? 0 : await this.attempts.countAccepted(teamId, taskIds)
    const decision = this.policy.grade({
      trainerTasksTotal: taskIds.length,
      trainerTasksSolved,
      inPerson: await this.inPerson(teamId, theme.key, taskIds.length, trainerTasksSolved),
    })
    return {
      theme: theme.name,
      trainerTasksTotal: taskIds.length,
      trainerTasksSolved,
      grade: decision.grade,
      label: decision.label,
    }
  }

  async markCorrectPath(actor: AuthUser, solutionId: string): Promise<{ marked: true }> {
    if (actor.role !== 'преподаватель') {
      throw new DomainError('Верный путь отмечает преподаватель', 'forbidden')
    }
    const entry = await this.attempts.findJournal(solutionId)
    if (!entry) throw new DomainError('Сдача не найдена', 'not_found')
    const passport = await this.passports.findById(entry.taskId)
    if (!passport || passport.mode !== 'очное' || passport.level !== 'сложное') {
      throw new DomainError('Верный путь отмечается на сложном очном задании', 'bad_request')
    }
    await this.paths.mark(entry.teamId, entry.taskId)
    return { marked: true }
  }

  private async inPerson(
    teamId: string,
    themeKey: string,
    trainerTasksTotal: number,
    trainerTasksSolved: number,
  ): Promise<InPersonEvidence | null> {
    const oral = await this.passports.oralOf(themeKey)
    if (oral.length === 0) return null
    const ids = oral.map((task) => task.id)
    const outcomes = await this.attempts.outcomes(teamId, ids)
    const marked = new Set(await this.paths.markedIds(teamId, ids))
    const engaged = oral.filter(
      (task) => outcomes.some((item) => item.taskId === task.id) || marked.has(task.id),
    )
    if (engaged.length === 0) return null

    let chosen: InPersonEvidence | null = null
    let best = 0
    for (const task of engaged) {
      const opened = await this.hints.opened(teamId, task.id)
      const evidence: InPersonEvidence = {
        level: task.level,
        accepted: outcomes.some((item) => item.taskId === task.id && item.accepted),
        hintCount: opened.length,
        hintIssuedAt: opened.map((item) => item.openedAt),
        correctPath: marked.has(task.id),
      }
      const decision = this.policy.grade({
        trainerTasksTotal,
        trainerTasksSolved,
        inPerson: evidence,
      })
      if (chosen === null) chosen = evidence
      if (decision.grade !== null && decision.grade > best) {
        best = decision.grade
        chosen = evidence
      }
    }
    return chosen
  }
}
