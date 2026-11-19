import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createApp, createTeam, openWindow, teacherAuth } from './helpers.js'

function csvOf(rows: string[]): string {
  return ['логин,пароль,имя,роль', ...rows].join('\n')
}

test('преподаватель загружает группу из 30 человек, роли разделены', async () => {
  const app = await createApp()
  await openWindow(app, 'intro')
  const students = Array.from({ length: 28 }, (_, index) => {
    const number = String(index + 1).padStart(2, '0')
    return `stud${number},password-${number},Студент ${number},студент`
  })
  const imported = await app.inject({
    method: 'POST',
    url: '/api/groups',
    headers: teacherAuth(app),
    payload: {
      csv: csvOf([
        ...students,
        'assist1,password-as,Ассистент,ассистент',
        'author1,password-au,Автор,автор заданий',
      ]),
    },
  })
  assert.equal(imported.statusCode, 201, imported.body)
  const body = imported.json() as { count: number; users: { login: string; role: string }[] }
  assert.equal(body.count, 30)
  assert.equal(JSON.stringify(body).includes('password-'), false)

  for (const login of ['stud01', 'stud28', 'assist1', 'author1']) {
    const password = login.startsWith('stud') ? `password-${login.slice(4)}` : login === 'assist1' ? 'password-as' : 'password-au'
    const session = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { login, password },
    })
    assert.equal(session.statusCode, 200, session.body)
  }

  const assistant = await app.inject({
    method: 'POST',
    url: '/api/login',
    payload: { login: 'assist1', password: 'password-as' },
  })
  const assistantToken = (assistant.json() as { token: string }).token
  const oral = await app.inject({
    method: 'POST',
    url: '/api/oral-sessions',
    headers: { authorization: `Bearer ${assistantToken}` },
    payload: { themeKey: 'intro', level: 'простое', minutes: 15 },
  })
  assert.equal(oral.statusCode, 201, oral.body)
  const window = await app.inject({
    method: 'POST',
    url: '/api/themes/intro/window',
    headers: { authorization: `Bearer ${assistantToken}` },
    payload: { action: 'закончить' },
  })
  assert.equal(window.statusCode, 403)

  const author = await app.inject({
    method: 'POST',
    url: '/api/login',
    payload: { login: 'author1', password: 'password-au' },
  })
  const authorToken = (author.json() as { token: string }).token
  const created = await app.inject({
    method: 'POST',
    url: '/api/teacher-tasks',
    headers: { authorization: `Bearer ${authorToken}` },
    payload: {
      title: 'Задание автора',
      themeKey: 'intro',
      competency: 'Читает условие',
      mode: 'тренажёр',
      level: 'простое',
      statement: 'Сдайте флаг из паспорта.',
      checker: 'флаг',
      secret: 'HITS{author-flag}',
    },
  })
  assert.equal(created.statusCode, 201, created.body)
  const taskId = (created.json() as { id: string }).id
  const card = await app.inject({
    method: 'GET',
    url: `/api/teacher-tasks/${taskId}`,
    headers: { authorization: `Bearer ${authorToken}` },
  })
  assert.equal((card.json() as { secret?: string }).secret, 'HITS{author-flag}')
  const authorOral = await app.inject({
    method: 'POST',
    url: '/api/oral-sessions',
    headers: { authorization: `Bearer ${authorToken}` },
    payload: { themeKey: 'intro', level: 'простое', minutes: 15 },
  })
  assert.equal(authorOral.statusCode, 403)
  const assistantTask = await app.inject({
    method: 'POST',
    url: '/api/teacher-tasks',
    headers: { authorization: `Bearer ${assistantToken}` },
    payload: {
      title: 'Не его',
      themeKey: 'intro',
      competency: 'Не создаёт',
      mode: 'тренажёр',
      level: 'простое',
      statement: 'Студент это не видит.',
      checker: 'флаг',
      secret: 'HITS{nope-flag}',
    },
  })
  assert.equal(assistantTask.statusCode, 403)

  const anya = await createTeam(app, 'Аня', ['Аня'])
  const borya = await createTeam(app, 'Боря', ['Боря'])
  await app.inject({
    method: 'POST',
    url: `/api/teacher-tasks/${taskId}/submissions`,
    payload: { teamId: anya.id, answer: 'HITS{author-flag}' },
  })
  const stolen = await app.inject({
    method: 'GET',
    url: '/api/solutions',
    headers: { authorization: `Bearer ${borya.token}` },
  })
  assert.equal(stolen.statusCode, 200)
  assert.equal(JSON.stringify(stolen.json()).includes('Аня'), false)
  assert.equal(JSON.stringify(stolen.json()).includes('HITS{author-flag}'), false)
  const assistantList = await app.inject({
    method: 'GET',
    url: '/api/solutions',
    headers: { authorization: `Bearer ${assistantToken}` },
  })
  assert.equal(JSON.stringify(assistantList.json()).includes('HITS{author-flag}'), false)
  const studentImport = await app.inject({
    method: 'POST',
    url: '/api/groups',
    headers: { authorization: `Bearer ${borya.token}` },
    payload: { csv: 'логин,пароль,имя\nextra1,password-ex,Лишний' },
  })
  assert.equal(studentImport.statusCode, 403)

  const again = await app.inject({
    method: 'POST',
    url: '/api/groups',
    headers: teacherAuth(app),
    payload: { csv: 'логин;пароль;имя\nfresh1;password-zz;Новый\nstud01;password-zz;Повтор' },
  })
  assert.equal(again.statusCode, 409)
  const fresh = await app.inject({
    method: 'POST',
    url: '/api/login',
    payload: { login: 'fresh1', password: 'password-zz' },
  })
  assert.equal(fresh.statusCode, 401)
  const still = await app.inject({
    method: 'POST',
    url: '/api/login',
    payload: { login: 'stud01', password: 'password-01' },
  })
  assert.equal(still.statusCode, 200)
  await app.close()
})
