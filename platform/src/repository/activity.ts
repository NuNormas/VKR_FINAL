import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'

export type ActivityKind = 'открытие' | 'стенд' | 'попытка' | 'подсказка'

export interface ActivityEvent {
  id: string
  teamId: string
  teamName: string
  taskId: string
  kind: ActivityKind
  fast: boolean
  createdAt: string
}

export interface StoredHint {
  step: number
  body: string
}

export interface OpenedHint {
  step: number
  openedAt: string
}

export class PostgresActivityRepository {
  constructor(private readonly pool: Pool) {}

  async insert(teamId: string, taskId: string, kind: ActivityKind, fast: boolean): Promise<void> {
    await this.pool.query(
      `INSERT INTO activity_log (id, team_id, task_id, kind, fast) VALUES ($1, $2, $3, $4, $5)`,
      [randomUUID(), teamId, taskId, kind, fast],
    )
  }

  async list(teamIds: string[] | null): Promise<ActivityEvent[]> {
    if (teamIds && teamIds.length === 0) return []
    const result = await this.pool.query<{
      id: string
      team_id: string
      team_name: string
      task_id: string
      kind: ActivityKind
      fast: boolean
      created_at: Date
    }>(
      `SELECT a.id, a.team_id, t.name AS team_name, a.task_id, a.kind, a.fast, a.created_at
       FROM activity_log a
       JOIN teams t ON t.id = a.team_id
       WHERE ($1::uuid[] IS NULL OR a.team_id = ANY($1::uuid[]))
       ORDER BY a.seq`,
      [teamIds],
    )
    return result.rows.map((row) => ({
      id: row.id,
      teamId: row.team_id,
      teamName: row.team_name,
      taskId: row.task_id,
      kind: row.kind,
      fast: row.fast,
      createdAt: row.created_at.toISOString(),
    }))
  }

  async firstAt(teamId: string, taskId: string, kind: ActivityKind): Promise<Date | null> {
    const result = await this.pool.query<{ created_at: Date }>(
      `SELECT created_at FROM activity_log
       WHERE team_id = $1 AND task_id = $2 AND kind = $3
       ORDER BY created_at
       LIMIT 1`,
      [teamId, taskId, kind],
    )
    return result.rows[0]?.created_at ?? null
  }

  async replaceHints(taskId: string, bodies: string[]): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('DELETE FROM task_hints WHERE task_id = $1', [taskId])
      for (let index = 0; index < bodies.length; index += 1) {
        await client.query(
          `INSERT INTO task_hints (task_id, step, body) VALUES ($1, $2, $3)`,
          [taskId, index + 1, bodies[index]],
        )
      }
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async hints(taskId: string): Promise<StoredHint[]> {
    const result = await this.pool.query<{ step: number; body: string }>(
      `SELECT step, body FROM task_hints WHERE task_id = $1 ORDER BY step`,
      [taskId],
    )
    return result.rows
  }

  async opened(teamId: string, taskId: string): Promise<OpenedHint[]> {
    const result = await this.pool.query<{ step: number; opened_at: Date }>(
      `SELECT step, opened_at FROM hint_opens WHERE team_id = $1 AND task_id = $2 ORDER BY step`,
      [teamId, taskId],
    )
    return result.rows.map((row) => ({ step: row.step, openedAt: row.opened_at.toISOString() }))
  }

  async openHint(teamId: string, taskId: string, step: number): Promise<string> {
    const result = await this.pool.query<{ opened_at: Date }>(
      `INSERT INTO hint_opens (team_id, task_id, step) VALUES ($1, $2, $3)
       ON CONFLICT (team_id, task_id, step) DO UPDATE SET opened_at = hint_opens.opened_at
       RETURNING opened_at`,
      [teamId, taskId, step],
    )
    return result.rows[0]!.opened_at.toISOString()
  }
}
