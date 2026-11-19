import { randomBytes } from 'node:crypto'
import type { FastifyInstance, InjectOptions } from 'fastify'
import type { Pool } from 'pg'
import { buildApp } from '../src/app.js'
import { resetPassports } from '../src/db/passports.js'
import { isLiveStand, type StandRequest, type StandRuntime } from '../src/stands/runtime.js'

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://trainer:trainer@127.0.0.1:5432/trainer_test'

const TEACHER = { login: 'teacher', password: 'teacher-pass-1', displayName: 'Преподаватель' }
const STUDENT_PASSWORD = 'student-pass-1'

const teacherTokens = new WeakMap<FastifyInstance, string>()
const teamTokens = new Map<string, string>()

export async function createApp(stands: StandRuntime = fakeStand()): Promise<FastifyInstance> {
  const app = await buildApp({
    databaseUrl: TEST_DATABASE_URL,
    logger: false,
    passwordCost: 4,
    bootstrapTeacher: TEACHER,
    stands,
  })
  await reset(app.pool)
  const login = await app.inject({
    method: 'POST',
    url: '/api/login',
    payload: TEACHER,
  })
  if (login.statusCode !== 200) {
    throw new Error(`Преподаватель не вошёл: ${login.statusCode} ${login.body}`)
  }
  teacherTokens.set(app, (login.json() as { token: string }).token)
  installAuth(app)
  return app
}

export async function reset(pool: Pool): Promise<void> {
  await pool.query(`
    TRUNCATE oral_session_joins, oral_sessions, oral_path_marks, authored_tasks, teacher_tasks, task_hints, hint_opens, activity_log, auth_sessions,
      foreign_answer_incidents, attempts, task_issues, team_members, teams
    RESTART IDENTITY CASCADE
  `)
  await pool.query(`DELETE FROM users WHERE login <> 'teacher'`)
  await pool.query(`UPDATE theme_windows SET phase = 'закрыта'`)
  await resetPassports(pool)
}

export function teacherAuth(app: FastifyInstance): { authorization: string } {
  const token = teacherTokens.get(app)
  if (!token) throw new Error('нет входа преподавателя')
  return { authorization: `Bearer ${token}` }
}

export function teamAuth(teamId: string): { authorization: string } {
  const token = teamTokens.get(teamId)
  if (!token) throw new Error('нет входа команды')
  return { authorization: `Bearer ${token}` }
}

export async function createStudent(
  app: FastifyInstance,
  displayName: string,
): Promise<{ login: string; token: string; displayName: string }> {
  const login = `s${randomBytes(4).toString('hex')}`
  const created = await app.inject({
    method: 'POST',
    url: '/api/users',
    headers: teacherAuth(app),
    payload: { login, password: STUDENT_PASSWORD, role: 'студент', displayName },
  })
  if (created.statusCode !== 201) {
    throw new Error(`Студент не создан: ${created.statusCode} ${created.body}`)
  }
  const session = await app.inject({
    method: 'POST',
    url: '/api/login',
    payload: { login, password: STUDENT_PASSWORD },
  })
  if (session.statusCode !== 200) {
    throw new Error(`Студент не вошёл: ${session.statusCode} ${session.body}`)
  }
  return { login, token: (session.json() as { token: string }).token, displayName }
}

export async function createTeam(
  app: FastifyInstance,
  name: string,
  members: string[],
): Promise<{ id: string; name: string; members: string[]; token: string; tokens: string[] }> {
  const students = []
  for (const displayName of members) students.push(await createStudent(app, displayName))
  const token = students[0]!.token
  const response = await app.inject({
    method: 'POST',
    url: '/api/teams',
    headers: { authorization: `Bearer ${token}` },
    payload: { name, memberLogins: students.map((student) => student.login) },
  })
  if (response.statusCode !== 201) {
    throw new Error(`Команда не создана: ${response.statusCode} ${response.body}`)
  }
  const team = response.json() as { id: string; name: string; members: string[] }
  teamTokens.set(team.id, token)
  return { ...team, token, tokens: students.map((student) => student.token) }
}

export async function openWindow(app: FastifyInstance, themeKey: string): Promise<void> {
  const response = await app.inject({
    method: 'POST',
    url: `/api/themes/${themeKey}/window`,
    headers: teacherAuth(app),
    payload: { action: 'открыть' },
  })
  if (response.statusCode !== 200) {
    throw new Error(`Окно не открылось: ${response.statusCode} ${response.body}`)
  }
}

function installAuth(app: FastifyInstance): void {
  const raw = app.inject.bind(app)
  app.inject = (async (opts: InjectOptions) => {
    const url = requestUrl(typeof opts === 'string' ? opts : opts.url)
    const path = url.split('?')[0]
    if (typeof opts !== 'string' && path !== '/health' && path !== '/api/login') {
      const teamId = teamIdOf(opts)
      const auto =
        teamId && teamTokens.has(teamId) ? teamAuth(teamId) : teacherAuth(app)
      opts = { ...opts, headers: { ...auto, ...opts.headers } }
    }
    return raw(opts)
  }) as FastifyInstance['inject']
}

function fakeStand(): StandRuntime {
  return {
    async ensure(input: StandRequest): Promise<{ url: string; started: boolean } | null> {
      if (!isLiveStand(input.taskId)) return null
      return { url: 'http://127.0.0.1:3999/', started: true }
    },
  }
}

function requestUrl(url: InjectOptions['url']): string {
  if (typeof url === 'string') return url
  if (!url) return ''
  const query = typeof url.query === 'string' ? url.query : ''
  return `${url.pathname}${query ? `?${query}` : ''}`
}

function teamIdOf(opts: InjectOptions): string | undefined {
  const payload = opts.payload
  if (payload && typeof payload === 'object' && !Buffer.isBuffer(payload) && 'teamId' in payload) {
    const teamId = (payload as { teamId?: unknown }).teamId
    if (typeof teamId === 'string') return teamId
  }
  const query = requestUrl(opts.url).split('?')[1]
  if (!query) return undefined
  return new URLSearchParams(query).get('teamId') ?? undefined
}
