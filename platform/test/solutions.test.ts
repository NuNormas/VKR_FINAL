import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createApp, createTeam, openWindow, teacherAuth } from './helpers.js'

test('студент видит только свои сдачи, преподаватель видит текст и время', async () => {
  const app = await createApp()
  await openWindow(app, 'intro')
  const created = await app.inject({
    method: 'POST',
    url: '/api/teacher-tasks',
    headers: teacherAuth(app),
    payload: {
      title: 'Свой след',
      themeKey: 'intro',
      competency: 'Сдаёт флаг паспорта',
      mode: 'тренажёр',
      level: 'простое',
      statement: 'Сдайте флаг из паспорта.',
      checker: 'флаг',
      secret: 'HITS{own-flag-1}',
    },
  })
  const taskId = (created.json() as { id: string }).id
  const anya = await createTeam(app, 'Аня', ['Аня'])
  const borya = await createTeam(app, 'Боря', ['Боря'])

  const anyaSubmit = await app.inject({
    method: 'POST',
    url: `/api/teacher-tasks/${taskId}/submissions`,
    payload: { teamId: anya.id, answer: 'HITS{own-flag-1}' },
  })
  assert.equal((anyaSubmit.json() as { result: string }).result, 'зачтено')
  await app.inject({
    method: 'POST',
    url: `/api/teacher-tasks/${taskId}/submissions`,
    payload: { teamId: borya.id, answer: 'HITS{borya-flag}' },
  })
  await app.inject({
    method: 'POST',
    url: '/api/tasks/intro-protocol/open',
    payload: { teamId: anya.id },
  })
  await app.inject({
    method: 'POST',
    url: '/api/tasks/intro-protocol/submissions',
    payload: { teamId: anya.id, answer: 'не тот след' },
  })

  const secret = await app.pool.query<{ secret: string }>(
    `SELECT secret FROM task_issues WHERE team_id = $1 AND task_id = 'intro-protocol'`,
    [anya.id],
  )

  const teacherList = await app.inject({ method: 'GET', url: '/api/solutions' })
  assert.equal(teacherList.statusCode, 200)
  const teacherRows = (teacherList.json() as { solutions: { id: string; who: string; taskTitle: string; verdict: string; submittedAt: string }[] }).solutions
  assert.equal(teacherRows.some((row) => row.who === 'Аня' && row.taskTitle === 'Свой след' && row.verdict === 'зачтено'), true)
  assert.equal(teacherRows.some((row) => row.who === 'Боря' && row.verdict === 'не зачтено'), true)
  assert.equal(teacherRows.some((row) => row.who === 'Аня' && row.taskTitle === 'Протокол и след'), true)
  for (const row of teacherRows) assert.equal(Number.isNaN(Date.parse(row.submittedAt)), false)
  assert.equal(JSON.stringify(teacherList.json()).includes('answer'), false)

  const boryaRow = teacherRows.find((row) => row.who === 'Боря')
  const teacherCard = await app.inject({ method: 'GET', url: `/api/solutions/${boryaRow!.id}` })
  assert.equal(teacherCard.statusCode, 200)
  const card = teacherCard.json() as { who: string; teamName: string; taskTitle: string; verdict: string; answer: string; submittedAt: string }
  assert.equal(card.who, 'Боря')
  assert.equal(card.teamName, 'Боря')
  assert.equal(card.taskTitle, 'Свой след')
  assert.equal(card.verdict, 'не зачтено')
  assert.equal(card.answer, 'HITS{borya-flag}')
  assert.equal(Number.isNaN(Date.parse(card.submittedAt)), false)

  const anyaList = await app.inject({
    method: 'GET',
    url: '/api/solutions',
    headers: { authorization: `Bearer ${anya.token}` },
  })
  const anyaBody = JSON.stringify(anyaList.json())
  assert.equal(anyaBody.includes('Боря'), false)
  assert.equal(anyaBody.includes('HITS{borya-flag}'), false)
  assert.equal(anyaBody.includes(secret.rows[0]!.secret), false)
  const anyaRows = (anyaList.json() as { solutions: { id: string; who: string; taskTitle: string }[] }).solutions
  assert.equal(anyaRows.length, 2)
  assert.equal(anyaRows.every((row) => row.who === 'Аня'), true)

  const stolen = await app.inject({
    method: 'GET',
    url: `/api/solutions/${boryaRow!.id}`,
    headers: { authorization: `Bearer ${anya.token}` },
  })
  assert.equal(stolen.statusCode, 403)
  assert.equal(stolen.body.includes('HITS{borya-flag}'), false)
  assert.equal(stolen.body.includes(secret.rows[0]!.secret), false)

  const own = anyaRows.find((row) => row.taskTitle === 'Протокол и след')
  const ownCard = await app.inject({
    method: 'GET',
    url: `/api/solutions/${own!.id}`,
    headers: { authorization: `Bearer ${anya.token}` },
  })
  assert.equal((ownCard.json() as { answer: string }).answer, 'не тот след')
  assert.equal(JSON.stringify(ownCard.json()).includes(secret.rows[0]!.secret), false)
  await app.close()
})
