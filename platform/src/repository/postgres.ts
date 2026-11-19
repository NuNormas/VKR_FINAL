import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { DomainError } from '../domain/errors.js'
import { ThemeWindow } from '../domain/theme-window.js'
import type {
  AttemptRepository,
  ForeignAnswerIncident,
  IncidentRepository,
  JournalDetail,
  JournalEntry,
  IssueRepository,
  TaskIssue,
  Team,
  TeamRepository,
  ThemeWindowRepository,
} from './interfaces.js'

const TEAM_LIMIT = 4

async function withTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'
}

export class PostgresTeamRepository implements TeamRepository {
  constructor(private readonly pool: Pool) {}

  async create(input: {
    name: string
    members: { userId: string; displayName: string }[]
  }): Promise<Team> {
    const name = input.name.trim()
    const members = input.members.map((member) => ({
      userId: member.userId,
      displayName: member.displayName.trim(),
    }))
    if (!name || members.length === 0 || members.some((member) => member.displayName.length === 0)) {
      throw new DomainError('У команды нужны название и хотя бы один участник', 'bad_request')
    }
    if (members.length > TEAM_LIMIT) {
      throw new DomainError('В команде не больше четырёх человек', 'bad_request')
    }
    if (new Set(members.map((member) => member.userId)).size !== members.length) {
      throw new DomainError('Участник указан дважды', 'bad_request')
    }

    const id = randomUUID()
    await withTransaction(this.pool, async (client) => {
      await client.query('INSERT INTO teams (id, name) VALUES ($1, $2)', [id, name])
      for (let position = 0; position < members.length; position += 1) {
        const member = members[position]!
        await client.query(
          `INSERT INTO team_members (id, team_id, display_name, position, user_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [randomUUID(), id, member.displayName, position, member.userId],
        )
      }
    })
    return { id, name, members: members.map((member) => member.displayName) }
  }

  async findById(id: string): Promise<Team | null> {
    const team = await this.pool.query<{ id: string; name: string }>(
      'SELECT id, name FROM teams WHERE id = $1',
      [id],
    )
    const row = team.rows[0]
    if (!row) return null
    const members = await this.pool.query<{ display_name: string }>(
      'SELECT display_name FROM team_members WHERE team_id = $1 ORDER BY position',
      [id],
    )
    return { id: row.id, name: row.name, members: members.rows.map((member) => member.display_name) }
  }

  async hasMember(teamId: string, userId: string): Promise<boolean> {
    const result = await this.pool.query(
      'SELECT 1 FROM team_members WHERE team_id = $1 AND user_id = $2 LIMIT 1',
      [teamId, userId],
    )
    return (result.rowCount ?? 0) > 0
  }

  async memberTeamIds(userId: string): Promise<string[]> {
    const result = await this.pool.query<{ team_id: string }>(
      'SELECT team_id FROM team_members WHERE user_id = $1 ORDER BY team_id',
      [userId],
    )
    return result.rows.map((row) => row.team_id)
  }
}

export class PostgresThemeWindowRepository implements ThemeWindowRepository {
  constructor(private readonly pool: Pool) {}

  async get(themeKey: string): Promise<ThemeWindow> {
    const result = await this.pool.query<{ phase: string }>(
      'SELECT phase FROM theme_windows WHERE theme_key = $1',
      [themeKey],
    )
    const phase = result.rows[0]?.phase
    if (!phase) throw new DomainError('Тема не найдена', 'not_found')
    return ThemeWindow.from(phase)
  }

  async save(themeKey: string, window: ThemeWindow): Promise<void> {
    const result = await this.pool.query(
      'UPDATE theme_windows SET phase = $2 WHERE theme_key = $1',
      [themeKey, window.phase],
    )
    if (result.rowCount !== 1) throw new DomainError('Тема не найдена', 'not_found')
  }
}

export class PostgresIssueRepository implements IssueRepository {
  constructor(private readonly pool: Pool) {}

  async findByTeamAndTask(teamId: string, taskId: string): Promise<TaskIssue | null> {
    const result = await this.pool.query<{ seed: string; secret: string }>(
      'SELECT seed, secret FROM task_issues WHERE team_id = $1 AND task_id = $2',
      [teamId, taskId],
    )
    const row = result.rows[0]
    if (!row) return null
    return { teamId, taskId, seed: row.seed, secret: row.secret }
  }

  async insert(issue: TaskIssue): Promise<'inserted' | 'exists'> {
    try {
      await this.pool.query(
        `INSERT INTO task_issues (id, team_id, task_id, seed, secret)
         VALUES ($1, $2, $3, $4, $5)`,
        [randomUUID(), issue.teamId, issue.taskId, issue.seed, issue.secret],
      )
      return 'inserted'
    } catch (error) {
      if (isUniqueViolation(error)) return 'exists'
      throw error
    }
  }

  async findOtherTeamBySecret(
    taskId: string,
    secret: string,
    exceptTeamId: string,
  ): Promise<{ teamId: string } | null> {
    const result = await this.pool.query<{ team_id: string }>(
      `SELECT team_id FROM task_issues
       WHERE task_id = $1 AND secret = $2 AND team_id <> $3
       LIMIT 1`,
      [taskId, secret, exceptTeamId],
    )
    const row = result.rows[0]
    return row ? { teamId: row.team_id } : null
  }
}

export class PostgresAttemptRepository implements AttemptRepository {
  constructor(private readonly pool: Pool) {}

  async record(input: {
    teamId: string
    taskId: string
    accepted: boolean
    foreignOwnerTeamId: string | null
    artifact: string | null
    answer: string
    submitterUserId: string
  }): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      await client.query(
        `INSERT INTO attempts (id, team_id, task_id, accepted, artifact, answer, submitter_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          randomUUID(),
          input.teamId,
          input.taskId,
          input.accepted,
          input.artifact,
          input.answer,
          input.submitterUserId,
        ],
      )
      if (input.foreignOwnerTeamId) {
        await client.query(
          `INSERT INTO foreign_answer_incidents
             (id, task_id, submitter_team_id, owner_team_id)
           VALUES ($1, $2, $3, $4)`,
          [randomUUID(), input.taskId, input.teamId, input.foreignOwnerTeamId],
        )
      }
    })
  }

  async countAccepted(teamId: string, taskIds: string[]): Promise<number> {
    if (taskIds.length === 0) return 0
    const result = await this.pool.query<{ solved: number }>(
      `SELECT COUNT(DISTINCT task_id)::int AS solved
       FROM attempts
       WHERE team_id = $1 AND accepted = true AND task_id = ANY($2::text[])`,
      [teamId, taskIds],
    )
    return Number(result.rows[0]?.solved ?? 0)
  }

  async outcomes(teamId: string, taskIds: string[]): Promise<{ taskId: string; accepted: boolean }[]> {
    if (taskIds.length === 0) return []
    const result = await this.pool.query<{ task_id: string; accepted: boolean }>(
      `SELECT task_id, bool_or(accepted) AS accepted
       FROM attempts
       WHERE team_id = $1 AND task_id = ANY($2::text[])
       GROUP BY task_id`,
      [teamId, taskIds],
    )
    return result.rows.map((row) => ({ taskId: row.task_id, accepted: row.accepted }))
  }

  async countFor(teamId: string, taskId: string): Promise<number> {
    const result = await this.pool.query<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM attempts WHERE team_id = $1 AND task_id = $2`,
      [teamId, taskId],
    )
    return Number(result.rows[0]?.total ?? 0)
  }

  async listArtifacts(): Promise<
    { taskId: string; teamId: string; teamName: string; artifact: string; grading: 'преподаватель' }[]
  > {
    const result = await this.pool.query<{
      task_id: string
      team_id: string
      team_name: string
      artifact: string
    }>(
      `SELECT a.task_id, a.team_id, t.name AS team_name, a.artifact
       FROM attempts a
       JOIN teams t ON t.id = a.team_id
       WHERE a.artifact IS NOT NULL
       ORDER BY a.created_at`,
    )
    return result.rows.map((row) => ({
      taskId: row.task_id,
      teamId: row.team_id,
      teamName: row.team_name,
      artifact: row.artifact,
      grading: 'преподаватель' as const,
    }))
  }

  async listJournal(teamIds: string[] | null): Promise<JournalEntry[]> {
    if (teamIds && teamIds.length === 0) return []
    const result = await this.pool.query<JournalSql>(
      `SELECT a.id, a.task_id, a.team_id, t.name AS team_name, u.display_name AS submitter_name,
              a.accepted, a.artifact IS NOT NULL AS pending, a.created_at
       FROM attempts a
       JOIN teams t ON t.id = a.team_id
       LEFT JOIN users u ON u.id = a.submitter_user_id
       WHERE ($1::uuid[] IS NULL OR a.team_id = ANY($1::uuid[]))
       ORDER BY a.created_at DESC, a.id`,
      [teamIds],
    )
    return result.rows.map(journalFrom)
  }

  async findJournal(id: string): Promise<JournalDetail | null> {
    const result = await this.pool.query<JournalSql & { answer: string | null }>(
      `SELECT a.id, a.task_id, a.team_id, t.name AS team_name, u.display_name AS submitter_name,
              a.accepted, a.artifact IS NOT NULL AS pending, a.created_at, a.answer
       FROM attempts a
       JOIN teams t ON t.id = a.team_id
       LEFT JOIN users u ON u.id = a.submitter_user_id
       WHERE a.id = $1`,
      [id],
    )
    const row = result.rows[0]
    return row ? { ...journalFrom(row), answer: row.answer } : null
  }
}

interface JournalSql {
  id: string
  task_id: string
  team_id: string
  team_name: string
  submitter_name: string | null
  accepted: boolean
  pending: boolean
  created_at: Date
}

function journalFrom(row: JournalSql): JournalEntry {
  return {
    id: row.id,
    taskId: row.task_id,
    teamId: row.team_id,
    teamName: row.team_name,
    submitterName: row.submitter_name,
    accepted: row.accepted,
    pending: row.pending,
    submittedAt: row.created_at.toISOString(),
  }
}

export class PostgresIncidentRepository implements IncidentRepository {
  constructor(private readonly pool: Pool) {}

  async list(): Promise<ForeignAnswerIncident[]> {
    const result = await this.pool.query<{
      task_id: string
      submitter_team_id: string
      submitter_name: string
      owner_team_id: string
      owner_name: string
    }>(
      `SELECT i.task_id,
              i.submitter_team_id,
              s.name AS submitter_name,
              i.owner_team_id,
              o.name AS owner_name
       FROM foreign_answer_incidents i
       JOIN teams s ON s.id = i.submitter_team_id
       JOIN teams o ON o.id = i.owner_team_id
       ORDER BY i.created_at`,
    )
    return result.rows.map((row) => ({
      taskId: row.task_id,
      submitterTeamId: row.submitter_team_id,
      submitterName: row.submitter_name,
      ownerTeamId: row.owner_team_id,
      ownerName: row.owner_name,
    }))
  }
}
