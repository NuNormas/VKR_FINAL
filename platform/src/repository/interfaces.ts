import type { ThemeWindow } from '../domain/theme-window.js'

export interface Team {
  id: string
  name: string
  members: string[]
}

export interface TeamRepository {
  create(input: { name: string; members: { userId: string; displayName: string }[] }): Promise<Team>
  findById(id: string): Promise<Team | null>
  hasMember(teamId: string, userId: string): Promise<boolean>
  memberTeamIds(userId: string): Promise<string[]>
}

export interface ThemeWindowRepository {
  get(themeKey: string): Promise<ThemeWindow>
  save(themeKey: string, window: ThemeWindow): Promise<void>
}

export interface TaskIssue {
  teamId: string
  taskId: string
  seed: string
  secret: string
}

export interface IssueRepository {
  findByTeamAndTask(teamId: string, taskId: string): Promise<TaskIssue | null>
  insert(issue: TaskIssue): Promise<'inserted' | 'exists'>
  findOtherTeamBySecret(
    taskId: string,
    secret: string,
    exceptTeamId: string,
  ): Promise<{ teamId: string } | null>
}

export interface SubmittedArtifact {
  taskId: string
  teamId: string
  teamName: string
  artifact: string
  grading: 'преподаватель'
}

export interface AttemptRepository {
  record(input: {
    teamId: string
    taskId: string
    accepted: boolean
    foreignOwnerTeamId: string | null
    artifact: string | null
    answer: string
    submitterUserId: string
  }): Promise<void>
  countAccepted(teamId: string, taskIds: string[]): Promise<number>
  countFor(teamId: string, taskId: string): Promise<number>
  outcomes(teamId: string, taskIds: string[]): Promise<{ taskId: string; accepted: boolean }[]>
  listArtifacts(): Promise<SubmittedArtifact[]>
  listJournal(teamIds: string[] | null): Promise<JournalEntry[]>
  findJournal(id: string): Promise<JournalDetail | null>
}

export interface JournalEntry {
  id: string
  taskId: string
  teamId: string
  teamName: string
  submitterName: string | null
  accepted: boolean
  pending: boolean
  submittedAt: string
}

export interface JournalDetail extends JournalEntry {
  answer: string | null
}

export interface ForeignAnswerIncident {
  taskId: string
  submitterTeamId: string
  submitterName: string
  ownerTeamId: string
  ownerName: string
}

export interface IncidentRepository {
  list(): Promise<ForeignAnswerIncident[]>
}
