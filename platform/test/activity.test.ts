import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createApp, createTeam, openWindow, teacherAuth } from './helpers.js'

test('подсказки, лимит попыток и журнал команды', async () => {
  const app = await createApp()
  await openWindow(app, 'intro')
  await openWindow(app, 'web')
  await openWindow(app, 'crypto')
  const created = await app.inject({
    method: 'POST',
    url: '/api/teacher-tasks',
    headers: teacherAuth(app),
    payload: {
      title: 'След со ступенями',
      themeKey: 'intro',
      competency: 'Открывает подсказку и сдаёт флаг',
      mode: 'тренажёр',
      level: 'простое',
      statement: 'Сдайте флаг из паспорта.',
      checker: 'флаг',
      secret: 'HITS{hint-flag-1}',
      attemptLimit: 2,
      hints: ['Сначала найдите запись.', 'Потом сверьте её с паспортом.'],
    },
  })
  assert.equal(created.statusCode, 201)
  const taskId = (created.json() as { id: string }).id
  const anya = await createTeam(app, 'Аня', ['Аня'])
  const borya = await createTeam(app, 'Боря', ['Боря'])

  const card = await app.inject({
    method: 'GET',
    url: `/api/teacher-tasks/${taskId}?teamId=${anya.id}`,
    headers: { authorization: `Bearer ${anya.token}` },
  })
  assert.equal(JSON.stringify(card.json()).includes('Сначала найдите запись'), false)

  const first = await app.inject({
    method: 'POST',
    url: `/api/tasks/${taskId}/hints`,
    payload: { teamId: anya.id },
  })
  assert.equal(first.statusCode, 200)
  const opened = first.json() as {
    hintsTotal: number
    opened: { step: number; body: string; openedAt: string }[]
    attemptLimit: number
    attemptsUsed: number
  }
  assert.equal(opened.hintsTotal, 2)
  assert.equal(opened.opened.length, 1)
  assert.equal(opened.opened[0]?.body, 'Сначала найдите запись.')
  assert.equal(Number.isNaN(Date.parse(opened.opened[0]!.openedAt)), false)
  assert.equal(JSON.stringify(first.json()).includes('Потом сверьте'), false)
  assert.equal(opened.attemptLimit, 2)

  const second = await app.inject({
    method: 'POST',
    url: `/api/tasks/${taskId}/hints`,
    payload: { teamId: anya.id },
  })
  assert.equal((second.json() as { opened: { body: string }[] }).opened[1]?.body, 'Потом сверьте её с паспортом.')
  const third = await app.inject({
    method: 'POST',
    url: `/api/tasks/${taskId}/hints`,
    payload: { teamId: anya.id },
  })
  assert.equal(third.statusCode, 409)

  const wrong = await app.inject({
    method: 'POST',
    url: `/api/teacher-tasks/${taskId}/submissions`,
    payload: { teamId: anya.id, answer: 'HITS{nope}' },
  })
  assert.equal((wrong.json() as { result: string }).result, 'не зачтено')
  const right = await app.inject({
    method: 'POST',
    url: `/api/teacher-tasks/${taskId}/submissions`,
    payload: { teamId: anya.id, answer: 'HITS{hint-flag-1}' },
  })
  assert.equal((right.json() as { result: string }).result, 'зачтено')
  const blocked = await app.inject({
    method: 'POST',
    url: `/api/teacher-tasks/${taskId}/submissions`,
    payload: { teamId: anya.id, answer: 'HITS{hint-flag-1}' },
  })
  assert.equal(blocked.statusCode, 409)

  await app.inject({
    method: 'POST',
    url: '/api/tasks/web-sqli/open',
    payload: { teamId: anya.id },
  })
  await app.inject({
    method: 'POST',
    url: '/api/tasks/crypto-caesar/open',
    payload: { teamId: anya.id },
  })

  const teacher = await app.inject({ method: 'GET', url: '/api/activity' })
  const events = (teacher.json() as { events: { teamName: string; taskTitle: string; kind: string; fast?: boolean }[] }).events
  const kinds = events.filter((event) => event.teamName === 'Аня' && event.taskTitle === 'След со ступенями').map((event) => event.kind)
  assert.deepEqual(kinds, ['открытие', 'подсказка', 'подсказка', 'попытка', 'попытка'])
  assert.equal(events.some((event) => event.kind === 'попытка' && event.fast === true && event.teamName === 'Аня'), true)
  assert.equal(events.some((event) => event.kind === 'стенд' && event.taskTitle === 'Стенд входа'), true)
  assert.equal(events.some((event) => event.kind === 'стенд' && event.taskTitle === 'Классический шифр Цезаря'), false)

  const own = await app.inject({
    method: 'GET',
    url: `/api/activity?teamId=${anya.id}`,
    headers: { authorization: `Bearer ${anya.token}` },
  })
  const ownBody = JSON.stringify(own.json())
  assert.equal(ownBody.includes('"fast"'), false)
  assert.equal(ownBody.includes('Боря'), false)

  const stolen = await app.inject({
    method: 'GET',
    url: `/api/activity?teamId=${anya.id}`,
    headers: { authorization: `Bearer ${borya.token}` },
  })
  assert.equal(stolen.statusCode, 403)
  assert.equal(stolen.body.includes('Сначала найдите запись'), false)
  assert.equal(stolen.body.includes('HITS{hint-flag-1}'), false)
  await app.close()
})
