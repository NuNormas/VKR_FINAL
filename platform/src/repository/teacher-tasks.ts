import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import type { TaskLevel, TaskMode } from '../domain/catalog.js'

export type TeacherCheckerName = 'флаг' | 'строка' | 'патч'
export type TaskVerdict = 'зачтено' | 'не зачтено'

export interface TeacherTaskRecord {
  id: string
  title: string
  themeKey: string
  competency: string
  mode: TaskMode
  level: TaskLevel
  statement: string
  checker: TeacherCheckerName
  secret: string
  attemptLimit: number
}

interface TaskRow {
  id: string
  title: string
  theme_key: string
  competency: string
  mode: string
  level: string
  statement: string
  checker: string
  secret: string
  attempt_limit: number
}

const COLUMNS = `id, title, theme_key, competency, mode, level, statement, checker, secret, attempt_limit`

function fromRow(row: TaskRow): TeacherTaskRecord {
  return {
    id: row.id,
    title: row.title,
    themeKey: row.theme_key,
    competency: row.competency,
    mode: row.mode as TaskMode,
    level: row.level as TaskLevel,
    statement: row.statement,
    checker: row.checker as TeacherCheckerName,
    secret: row.secret,
    attemptLimit: row.attempt_limit,
  }
}

export class PostgresTeacherTaskRepository {
  constructor(private readonly pool: Pool) {}

  async insert(input: Omit<TeacherTaskRecord, 'id'> & { authorUserId: string }): Promise<TeacherTaskRecord> {
    const id = randomUUID()
    await this.pool.query(
      `INSERT INTO teacher_tasks
         (id, title, theme_key, competency, mode, level, statement, checker, secret, attempt_limit, author_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        id,
        input.title,
        input.themeKey,
        input.competency,
        input.mode,
        input.level,
        input.statement,
        input.checker,
        input.secret,
        input.attemptLimit,
        input.authorUserId,
      ],
    )
    return { ...input, id }
  }

  async list(): Promise<TeacherTaskRecord[]> {
    const result = await this.pool.query<TaskRow>(
      `SELECT ${COLUMNS} FROM teacher_tasks ORDER BY created_at DESC, id`,
    )
    return result.rows.map(fromRow)
  }

  async findById(id: string): Promise<TeacherTaskRecord | null> {
    const result = await this.pool.query<TaskRow>(`SELECT ${COLUMNS} FROM teacher_tasks WHERE id = $1`, [id])
    const row = result.rows[0]
    return row ? fromRow(row) : null
  }

  async verdicts(teamId: string, taskIds: string[]): Promise<Map<string, TaskVerdict>> {
    const verdicts = new Map<string, TaskVerdict>()
    if (taskIds.length === 0) return verdicts
    const result = await this.pool.query<{ task_id: string; accepted: boolean }>(
      `SELECT task_id, BOOL_OR(accepted) AS accepted
       FROM attempts
       WHERE team_id = $1 AND task_id = ANY($2::text[])
       GROUP BY task_id`,
      [teamId, taskIds],
    )
    for (const row of result.rows) {
      verdicts.set(row.task_id, row.accepted ? 'зачтено' : 'не зачтено')
    }
    return verdicts
  }
}
