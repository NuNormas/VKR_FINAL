import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { TASKS } from '../src/domain/catalog.js'
import { createApp, createTeam, openWindow } from './helpers.js'

const PACKAGE = {
  title: 'Свой след',
  description: 'Короткий сервис с одним флагом.',
  flag: 'HITS{own-task}',
  instruction: 'Поднять сервис и сдать флаг.',
  license: 'MIT',
}

describe('срез доступа', { concurrency: false }, () => {
  test('паспорт читается из базы и правится без кода генератора', async (t) => {
    const app = await createApp()
    t.after(() => app.close())

    const listed = await app.inject({ method: 'GET', url: '/api/tasks' })
    const tasks = (listed.json() as { tasks: { id: string; competency: string; level: string; checker: string }[] }).tasks
    assert.equal(tasks.length, TASKS.length)
    const protocol = tasks.find((task) => task.id === 'intro-protocol')
    assert.equal(protocol?.competency, 'Собирает флаг по следу из полей протокола')
    assert.equal(protocol?.level, 'простое')
    assert.equal(protocol?.checker, 'string')
    assert.equal(tasks.some((task) => task.id === 'author-jeopardy'), false)

    await app.pool.query(`UPDATE task_passports SET competency = 'Формулировка из базы' WHERE id = 'intro-protocol'`)
    const again = await app.inject({ method: 'GET', url: '/api/tasks' })
    const updated = (again.json() as { tasks: { id: string; competency: string }[] }).tasks.find(
      (task) => task.id === 'intro-protocol',
    )
    assert.equal(updated?.competency, 'Формулировка из базы')
  })

  test('студент не читает чужие результаты, пароль в базе не лежит открытым текстом', async (t) => {
    const app = await createApp()
    t.after(() => app.close())

    const own = await createTeam(app, 'Свои', ['Аня'])
    const other = await createTeam(app, 'Чужие', ['Боря'])
    const hash = await app.pool.query<{ password_hash: string }>(
      `SELECT password_hash FROM users WHERE display_name = 'Аня'`,
    )
    assert.notEqual(hash.rows[0]?.password_hash, 'student-pass-1')
    assert.match(hash.rows[0]?.password_hash ?? '', /^\$2[aby]\$/)

    const wrong = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { login: 'teacher', password: 'not-the-password' },
    })
    assert.equal(wrong.statusCode, 401)

    const missing = await app.inject({
      method: 'GET',
      url: '/api/incidents',
      headers: { authorization: 'Bearer nope' },
    })
    assert.equal(missing.statusCode, 401)

    const incidents = await app.inject({
      method: 'GET',
      url: '/api/incidents',
      headers: { authorization: `Bearer ${own.token}` },
    })
    assert.equal(incidents.statusCode, 403)

    const grade = await app.inject({
      method: 'GET',
      url: `/api/themes/intro/grade?teamId=${other.id}`,
      headers: { authorization: `Bearer ${own.token}` },
    })
    assert.equal(grade.statusCode, 403)
    assert.equal(JSON.stringify(grade.json()).includes('Чужие'), false)

    const ownGrade = await app.inject({
      method: 'GET',
      url: `/api/themes/intro/grade?teamId=${own.id}`,
      headers: { authorization: `Bearer ${own.token}` },
    })
    assert.equal(ownGrade.statusCode, 200)

    const window = await app.inject({
      method: 'POST',
      url: '/api/themes/intro/window',
      headers: { authorization: `Bearer ${own.token}` },
      payload: { action: 'открыть' },
    })
    assert.equal(window.statusCode, 403)
  })

  test('очное задание молчит вне сессии своего уровня и после таймера', async (t) => {
    const app = await createApp()
    t.after(() => app.close())

    const team = await createTeam(app, 'Пара', ['Аня', 'Боря'])
    await openWindow(app, 'intro')
    const closed = await app.inject({
      method: 'POST',
      url: '/api/tasks/intro-headers/open',
      payload: { teamId: team.id },
    })
    assert.equal(closed.statusCode, 409)

    const short = await app.inject({
      method: 'POST',
      url: '/api/oral-sessions',
      payload: { themeKey: 'intro', level: 'простое', minutes: 9 },
    })
    assert.equal(short.statusCode, 400)

    const opened = await app.inject({
      method: 'POST',
      url: '/api/oral-sessions',
      payload: { themeKey: 'intro', level: 'простое', minutes: 15 },
    })
    assert.equal(opened.statusCode, 201)
    const code = (opened.json() as { code: string; minutes: number }).code
    assert.equal((opened.json() as { minutes: number }).minutes, 15)

    const beforeJoin = await app.inject({
      method: 'POST',
      url: '/api/tasks/intro-headers/open',
      payload: { teamId: team.id },
    })
    assert.equal(beforeJoin.statusCode, 409)

    const joined = await app.inject({
      method: 'POST',
      url: '/api/oral-sessions/join',
      headers: { authorization: `Bearer ${team.token}` },
      payload: { code },
    })
    assert.equal(joined.statusCode, 200)
    assert.equal('code' in (joined.json() as object), false)

    const task = await app.inject({
      method: 'POST',
      url: '/api/tasks/intro-headers/open',
      payload: { teamId: team.id },
    })
    assert.equal(task.statusCode, 200, task.body)

    const mateOpen = await app.inject({
      method: 'POST',
      url: '/api/tasks/intro-headers/open',
      headers: { authorization: `Bearer ${team.tokens[1]}` },
      payload: { teamId: team.id },
    })
    assert.equal(mateOpen.statusCode, 409)

    await openWindow(app, 'crypto')
    const otherLevel = await app.inject({
      method: 'POST',
      url: '/api/oral-sessions',
      payload: { themeKey: 'crypto', level: 'простое', minutes: 10 },
    })
    const otherCode = (otherLevel.json() as { code: string }).code
    await app.inject({
      method: 'POST',
      url: '/api/oral-sessions/join',
      headers: { authorization: `Bearer ${team.token}` },
      payload: { code: otherCode },
    })
    const mismatch = await app.inject({
      method: 'POST',
      url: '/api/tasks/crypto-rsa-oral/open',
      payload: { teamId: team.id },
    })
    assert.equal(mismatch.statusCode, 409)

    await app.pool.query(`UPDATE oral_sessions SET expires_at = now() - interval '1 second' WHERE code = $1`, [code])
    const late = await app.inject({
      method: 'POST',
      url: '/api/tasks/intro-headers/open',
      payload: { teamId: team.id },
    })
    assert.equal(late.statusCode, 409)
  })

  test('пакет своей задачи не входит в лабу и не виден другому студенту', async (t) => {
    const app = await createApp()
    t.after(() => app.close())

    const author = await createTeam(app, 'Автор', ['Аня'])
    const reader = await createTeam(app, 'Читатель', ['Боря'])
    const before = await app.inject({
      method: 'GET',
      url: `/api/themes/intro/grade?teamId=${author.id}`,
    })
    const total = (before.json() as { trainerTasksTotal: number }).trainerTasksTotal

    const both = await app.inject({
      method: 'POST',
      url: '/api/authored-tasks',
      headers: { authorization: `Bearer ${author.token}` },
      payload: { ...PACKAGE, link: 'https://example.test/task', fileName: 'task.txt', fileText: 'текст' },
    })
    assert.equal(both.statusCode, 400)

    const saved = await app.inject({
      method: 'POST',
      url: '/api/authored-tasks',
      headers: { authorization: `Bearer ${author.token}` },
      payload: { ...PACKAGE, link: 'https://example.test/task' },
    })
    assert.equal(saved.statusCode, 201, saved.body)
    const id = (saved.json() as { id: string; flag: string }).id
    assert.equal((saved.json() as { flag: string }).flag, PACKAGE.flag)

    const file = await app.inject({
      method: 'POST',
      url: '/api/authored-tasks',
      headers: { authorization: `Bearer ${author.token}` },
      payload: { ...PACKAGE, flag: 'HITS{file-task}', fileName: 'readme.txt', fileText: 'как поднять' },
    })
    assert.equal(file.statusCode, 201, file.body)

    const ownList = await app.inject({
      method: 'GET',
      url: '/api/authored-tasks',
      headers: { authorization: `Bearer ${author.token}` },
    })
    assert.equal((ownList.json() as { tasks: unknown[] }).tasks.length, 2)
    assert.equal(JSON.stringify(ownList.json()).includes(PACKAGE.flag), false)

    const foreign = await app.inject({
      method: 'GET',
      url: `/api/authored-tasks/${id}`,
      headers: { authorization: `Bearer ${reader.token}` },
    })
    assert.equal(foreign.statusCode, 404)
    assert.equal(foreign.body.includes(PACKAGE.flag), false)

    const teacherList = await app.inject({ method: 'GET', url: '/api/authored-tasks' })
    assert.equal((teacherList.json() as { tasks: unknown[] }).tasks.length, 2)

    const after = await app.inject({
      method: 'GET',
      url: `/api/themes/intro/grade?teamId=${author.id}`,
    })
    assert.equal((after.json() as { trainerTasksTotal: number }).trainerTasksTotal, total)
    assert.equal((after.json() as { grade: number | null }).grade, null)
    const home = TASKS.filter((task) => task.themeKey === 'intro' && task.mode === 'тренажёр')
    assert.equal(total, home.length)
  })

  test('адрес стенда есть у веб-задания, у шифра и патча его нет', async (t) => {
    const app = await createApp()
    t.after(() => app.close())
    const team = await createTeam(app, 'Стенд', ['Аня'])
    await openWindow(app, 'web')
    await openWindow(app, 'crypto')
    await openWindow(app, 'owasp')
    const web = await app.inject({
      method: 'POST',
      url: '/api/tasks/web-sqli/open',
      payload: { teamId: team.id },
    })
    const webBody = web.json() as { condition: { standUrl?: string; statement: string } }
    assert.equal(webBody.condition.standUrl, 'http://127.0.0.1:3999/')
    const secret = await app.pool.query<{ secret: string }>(
      `SELECT secret FROM task_issues WHERE team_id = $1 AND task_id = 'web-sqli'`,
      [team.id],
    )
    assert.equal(JSON.stringify(webBody).includes(secret.rows[0]!.secret), false)
    const greeting = await app.inject({
      method: 'POST',
      url: '/api/tasks/web-xss/open',
      payload: { teamId: team.id },
    })
    assert.equal((greeting.json() as { condition: { standUrl?: string } }).condition.standUrl, 'http://127.0.0.1:3999/')
    const crypto = await app.inject({
      method: 'POST',
      url: '/api/tasks/crypto-caesar/open',
      payload: { teamId: team.id },
    })
    assert.equal((crypto.json() as { condition: { standUrl?: string } }).condition.standUrl, undefined)
    const patch = await app.inject({
      method: 'POST',
      url: '/api/tasks/owasp-query/open',
      payload: { teamId: team.id },
    })
    assert.equal((patch.json() as { condition: { standUrl?: string } }).condition.standUrl, undefined)
  })
})
