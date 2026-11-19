import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import type { CheckerKind } from '../domain/checker.js'
import { DomainError } from '../domain/errors.js'
import type { AuthUser, Role } from '../domain/identity.js'
import type { TaskLevel, TaskMode } from '../domain/catalog.js'
import { requireTheme } from '../domain/themes.js'

export interface TaskPassport {
  id: string
  work: number
  themeKey: string
  title: string
  competency: string
  mode: TaskMode
  format: 'командное' | 'индивидуальное'
  level: TaskLevel
  generatorId: string
  checkerKind: CheckerKind
  attemptLimit: number
}

export interface OralSession {
  id: string
  themeKey: string
  level: TaskLevel
  code: string
  minutes: number
  expiresAt: string
}

export interface AuthoredTask {
  id: string
  authorUserId: string
  authorName: string
  title: string
  description: string
  flag: string
  instruction: string
  license: string
  link: string | null
  fileName: string | null
  fileText: string | null
  createdAt: string
}

interface PassportRow {
  id: string
  work: number
  theme_key: string
  title: string
  competency: string
  mode: string
  format: string
  level: string
  generator_id: string
  checker_kind: string
  attempt_limit: number
}

function passportFrom(row: PassportRow): TaskPassport {
  return {
    id: row.id,
    work: row.work,
    themeKey: row.theme_key,
    title: row.title,
    competency: row.competency,
    mode: row.mode as TaskPassport['mode'],
    format: row.format as TaskPassport['format'],
    level: row.level as TaskPassport['level'],
    generatorId: row.generator_id,
    checkerKind: row.checker_kind as TaskPassport['checkerKind'],
    attemptLimit: row.attempt_limit,
  }
}

const PASSPORT_SELECT = `id, work, theme_key, title, competency, mode, format, level, generator_id, checker_kind, attempt_limit`

export class PostgresUserRepository {
  constructor(private readonly pool: Pool) {}

  async insert(input: {
    login: string
    passwordHash: string
    role: Role
    displayName: string
  }): Promise<AuthUser> {
    const id = randomUUID()
    try {
      await this.pool.query(
        `INSERT INTO users (id, login, password_hash, role, display_name)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, input.login, input.passwordHash, input.role, input.displayName],
      )
    } catch (error) {
      if (isUniqueViolation(error)) throw new DomainError('Такой логин уже есть', 'conflict')
      throw error
    }
    return { id, login: input.login, role: input.role, displayName: input.displayName }
  }

  async insertMany(
    rows: { login: string; passwordHash: string; role: Role; displayName: string }[],
  ): Promise<AuthUser[]> {
    const client = await this.pool.connect()
    const created: AuthUser[] = []
    try {
      await client.query('BEGIN')
      for (const input of rows) {
        const id = randomUUID()
        await client.query(
          `INSERT INTO users (id, login, password_hash, role, display_name)
           VALUES ($1, $2, $3, $4, $5)`,
          [id, input.login, input.passwordHash, input.role, input.displayName],
        )
        created.push({ id, login: input.login, role: input.role, displayName: input.displayName })
      }
      await client.query('COMMIT')
      return created
    } catch (error) {
      await client.query('ROLLBACK')
      if (isUniqueViolation(error)) throw new DomainError('Такой логин уже есть', 'conflict')
      throw error
    } finally {
      client.release()
    }
  }

  async findByLogin(login: string): Promise<(AuthUser & { passwordHash: string }) | null> {
    const result = await this.pool.query<{
      id: string
      login: string
      password_hash: string
      role: Role
      display_name: string
    }>('SELECT id, login, password_hash, role, display_name FROM users WHERE login = $1', [login])
    const row = result.rows[0]
    if (!row) return null
    return {
      id: row.id,
      login: row.login,
      role: row.role,
      displayName: row.display_name,
      passwordHash: row.password_hash,
    }
  }

  async findByLogins(logins: string[]): Promise<AuthUser[]> {
    if (logins.length === 0) return []
    const result = await this.pool.query<{
      id: string
      login: string
      role: Role
      display_name: string
    }>('SELECT id, login, role, display_name FROM users WHERE login = ANY($1::text[])', [logins])
    return result.rows.map((row) => ({
      id: row.id,
      login: row.login,
      role: row.role,
      displayName: row.display_name,
    }))
  }
}

export class PostgresAuthSessionRepository {
  constructor(private readonly pool: Pool) {}

  async create(userId: string): Promise<string> {
    const token = randomBytes(32).toString('hex')
    await this.pool.query('INSERT INTO auth_sessions (token_hash, user_id) VALUES ($1, $2)', [
      hashToken(token),
      userId,
    ])
    return token
  }

  async findUser(token: string): Promise<AuthUser | null> {
    const result = await this.pool.query<{
      id: string
      login: string
      role: Role
      display_name: string
    }>(
      `SELECT u.id, u.login, u.role, u.display_name
       FROM auth_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1`,
      [hashToken(token)],
    )
    const row = result.rows[0]
    if (!row) return null
    return { id: row.id, login: row.login, role: row.role, displayName: row.display_name }
  }
}

export class PostgresPassportRepository {
  constructor(private readonly pool: Pool) {}

  async list(): Promise<TaskPassport[]> {
    const result = await this.pool.query<PassportRow>(
      `SELECT ${PASSPORT_SELECT} FROM task_passports ORDER BY work, id`,
    )
    return result.rows.map(passportFrom)
  }

  async findById(id: string): Promise<TaskPassport | null> {
    const result = await this.pool.query<PassportRow>(
      `SELECT ${PASSPORT_SELECT} FROM task_passports WHERE id = $1`,
      [id],
    )
    const row = result.rows[0]
    return row ? passportFrom(row) : null
  }

  async trainerIds(themeKey: string): Promise<string[]> {
    const result = await this.pool.query<{ id: string }>(
      `SELECT id FROM task_passports WHERE theme_key = $1 AND mode = 'тренажёр' ORDER BY id`,
      [themeKey],
    )
    return result.rows.map((row) => row.id)
  }

  async oralOf(themeKey: string): Promise<{ id: string; level: TaskLevel }[]> {
    const result = await this.pool.query<{ id: string; level: TaskLevel }>(
      `SELECT id, level FROM task_passports WHERE theme_key = $1 AND mode = 'очное' ORDER BY id`,
      [themeKey],
    )
    return result.rows
  }
}

export class PostgresOralPathRepository {
  constructor(private readonly pool: Pool) {}

  async mark(teamId: string, taskId: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO oral_path_marks (team_id, task_id) VALUES ($1, $2)
       ON CONFLICT (team_id, task_id) DO NOTHING`,
      [teamId, taskId],
    )
  }

  async markedIds(teamId: string, taskIds: string[]): Promise<string[]> {
    if (taskIds.length === 0) return []
    const result = await this.pool.query<{ task_id: string }>(
      `SELECT task_id FROM oral_path_marks
       WHERE team_id = $1 AND task_id = ANY($2::text[])`,
      [teamId, taskIds],
    )
    return result.rows.map((row) => row.task_id)
  }
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export class PostgresOralSessionRepository {
  constructor(private readonly pool: Pool) {}

  async create(input: { themeKey: string; level: TaskLevel; minutes: number }): Promise<OralSession> {
    requireTheme(input.themeKey)
    const id = randomUUID()
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = accessCode()
      try {
        const result = await this.pool.query<{ expires_at: Date }>(
          `INSERT INTO oral_sessions (id, theme_key, level, code, minutes, expires_at)
           VALUES ($1, $2, $3, $4, $5, now() + make_interval(mins => $5))
           RETURNING expires_at`,
          [id, input.themeKey, input.level, code, input.minutes],
        )
        return {
          id,
          themeKey: input.themeKey,
          level: input.level,
          code,
          minutes: input.minutes,
          expiresAt: result.rows[0]!.expires_at.toISOString(),
        }
      } catch (error) {
        if (!isUniqueViolation(error)) throw error
      }
    }
    throw new DomainError('Не удалось выдать код сессии', 'internal')
  }

  async join(code: string, userId: string): Promise<OralSession> {
    const found = await this.pool.query<{
      id: string
      theme_key: string
      level: TaskLevel
      code: string
      minutes: number
      expires_at: Date
      active: boolean
    }>(
      `SELECT id, theme_key, level, code, minutes, expires_at, expires_at > now() AS active
       FROM oral_sessions WHERE code = $1`,
      [code],
    )
    const row = found.rows[0]
    if (!row) throw new DomainError('Сессия не найдена', 'not_found')
    if (!row.active) throw new DomainError('Сессия закончилась', 'conflict')
    await this.pool.query(
      `INSERT INTO oral_session_joins (session_id, user_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [row.id, userId],
    )
    return {
      id: row.id,
      themeKey: row.theme_key,
      level: row.level,
      code: row.code,
      minutes: row.minutes,
      expiresAt: row.expires_at.toISOString(),
    }
  }

  async hasActiveJoin(userId: string, themeKey: string, level: TaskLevel): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT 1
       FROM oral_session_joins j
       JOIN oral_sessions s ON s.id = j.session_id
       WHERE j.user_id = $1 AND s.theme_key = $2 AND s.level = $3 AND s.expires_at > now()
       LIMIT 1`,
      [userId, themeKey, level],
    )
    return (result.rowCount ?? 0) > 0
  }
}

export class PostgresAuthoredTaskRepository {
  constructor(private readonly pool: Pool) {}

  async insert(input: {
    authorUserId: string
    title: string
    description: string
    flag: string
    instruction: string
    license: string
    link: string | null
    fileName: string | null
    fileText: string | null
  }): Promise<AuthoredTask> {
    const id = randomUUID()
    const result = await this.pool.query<{ created_at: Date; display_name: string }>(
      `WITH inserted AS (
         INSERT INTO authored_tasks (
           id, author_user_id, title, description, flag, instruction, license, link, file_name, file_body
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING created_at, author_user_id
       )
       SELECT inserted.created_at, users.display_name
       FROM inserted
       JOIN users ON users.id = inserted.author_user_id`,
      [
        id,
        input.authorUserId,
        input.title,
        input.description,
        input.flag,
        input.instruction,
        input.license,
        input.link,
        input.fileName,
        input.fileText,
      ],
    )
    const row = result.rows[0]
    if (!row) throw new DomainError('Задача не сохранилась', 'internal')
    return {
      id,
      authorUserId: input.authorUserId,
      authorName: row.display_name,
      title: input.title,
      description: input.description,
      flag: input.flag,
      instruction: input.instruction,
      license: input.license,
      link: input.link,
      fileName: input.fileName,
      fileText: input.fileText,
      createdAt: row.created_at.toISOString(),
    }
  }

  async list(): Promise<AuthoredTask[]> {
    return this.query('TRUE', [])
  }

  async listByAuthor(authorUserId: string): Promise<AuthoredTask[]> {
    return this.query('a.author_user_id = $1', [authorUserId])
  }

  async findById(id: string): Promise<AuthoredTask | null> {
    const rows = await this.query('a.id = $1', [id])
    return rows[0] ?? null
  }

  private async query(where: string, params: unknown[]): Promise<AuthoredTask[]> {
    const result = await this.pool.query<{
      id: string
      author_user_id: string
      author_name: string
      title: string
      description: string
      flag: string
      instruction: string
      license: string
      link: string | null
      file_name: string | null
      file_body: string | null
      created_at: Date
    }>(
      `SELECT a.id, a.author_user_id, u.display_name AS author_name, a.title, a.description,
              a.flag, a.instruction, a.license, a.link, a.file_name, a.file_body, a.created_at
       FROM authored_tasks a
       JOIN users u ON u.id = a.author_user_id
       WHERE ${where}
       ORDER BY a.created_at`,
      params,
    )
    return result.rows.map((row) => ({
      id: row.id,
      authorUserId: row.author_user_id,
      authorName: row.author_name,
      title: row.title,
      description: row.description,
      flag: row.flag,
      instruction: row.instruction,
      license: row.license,
      link: row.link,
      fileName: row.file_name,
      fileText: row.file_body,
      createdAt: row.created_at.toISOString(),
    }))
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function accessCode(): string {
  const bytes = randomBytes(6)
  return [...bytes].map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('')
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'
}
