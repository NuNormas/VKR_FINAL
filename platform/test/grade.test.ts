import assert from 'node:assert/strict'
import type { FastifyInstance } from 'fastify'
import { test } from 'node:test'
import { TASKS } from '../src/domain/catalog.js'
import { createApp, createTeam, openWindow, teacherAuth } from './helpers.js'

async function solve(app: FastifyInstance, teamId: string, taskId: string, answer?: string) {
  const opened = await app.inject({
    method: 'POST',
    url: `/api/tasks/${taskId}/open`,
    payload: { teamId },
  })
  assert.equal(opened.statusCode, 200, opened.body)
  const secret = answer ?? (await stored(app, teamId, taskId))
  const submitted = await app.inject({
    method: 'POST',
    url: `/api/tasks/${taskId}/submissions`,
    payload: { teamId, answer: secret },
  })
  assert.equal((submitted.json() as { result: string }).result, 'зачтено')
}

async function stored(app: FastifyInstance, teamId: string, taskId: string): Promise<string> {
  const result = await app.pool.query<{ secret: string }>(
    'SELECT secret FROM task_issues WHERE team_id = $1 AND task_id = $2',
    [teamId, taskId],
  )
  const secret = result.rows[0]?.secret
  assert.ok(secret)
  return secret
}

async function joinOral(app: FastifyInstance, teamId: string, themeKey: string, level: string) {
  const opened = await app.inject({
    method: 'POST',
    url: '/api/oral-sessions',
    headers: teacherAuth(app),
    payload: { themeKey, level, minutes: 15 },
  })
  assert.equal(opened.statusCode, 201, opened.body)
  const code = (opened.json() as { code: string }).code
  const joined = await app.inject({
    method: 'POST',
    url: '/api/oral-sessions/join',
    payload: { teamId, code },
  })
  assert.equal(joined.statusCode, 200, joined.body)
}

async function gradeOf(app: FastifyInstance, themeKey: string, teamId: string): Promise<number | null> {
  const response = await app.inject({ method: 'GET', url: `/api/themes/${themeKey}/grade?teamId=${teamId}` })
  assert.equal(response.statusCode, 200, response.body)
  return (response.json() as { grade: number | null }).grade
}

test('очный результат подставляется в шкалу одной лабы', async () => {
  const app = await createApp()
  await openWindow(app, 'intro')
  await openWindow(app, 'crypto')
  const team = await createTeam(app, 'Лаба', ['Даша'])
  const introHome = TASKS.filter((task) => task.themeKey === 'intro' && task.mode === 'тренажёр')

  await solve(app, team.id, introHome[0]!.id)
  await joinOral(app, team.id, 'intro', 'простое')
  await solve(app, team.id, 'intro-headers')
  assert.equal(await gradeOf(app, 'intro', team.id), null)

  await solve(app, team.id, introHome[1]!.id)
  assert.equal(await gradeOf(app, 'intro', team.id), 3)

  await solve(app, team.id, 'crypto-caesar')
  await joinOral(app, team.id, 'crypto', 'среднее')
  await solve(app, team.id, 'crypto-ecb-oral')
  assert.equal(await gradeOf(app, 'crypto', team.id), 4)
  await app.close()
})

test('сданное сложное без нескольких подсказок — пятёрка, провал не становится двойкой', async () => {
  const app = await createApp()
  await openWindow(app, 'crypto')
  await app.pool.query(
    `INSERT INTO task_hints (task_id, step, body) VALUES
       ('crypto-rsa-oral', 1, 'Сверьте длину модуля.'),
       ('crypto-rsa-oral', 2, 'Сверьте общий показатель.')`,
  )
  const hinted = await createTeam(app, 'Подсказки', ['Нина'])
  await solve(app, hinted.id, 'crypto-caesar')
  await joinOral(app, hinted.id, 'crypto', 'сложное')
  const hintedOpen = await app.inject({
    method: 'POST',
    url: '/api/tasks/crypto-rsa-oral/open',
    payload: { teamId: hinted.id },
  })
  assert.equal(hintedOpen.statusCode, 200, hintedOpen.body)
  for (let step = 0; step < 2; step += 1) {
    const hint = await app.inject({
      method: 'POST',
      url: '/api/tasks/crypto-rsa-oral/hints',
      payload: { teamId: hinted.id },
    })
    assert.equal(hint.statusCode, 200, hint.body)
  }
  await solve(app, hinted.id, 'crypto-rsa-oral')
  assert.equal(await gradeOf(app, 'crypto', hinted.id), 4)

  const team = await createTeam(app, 'Пятёрка', ['Ира'])
  await solve(app, team.id, 'crypto-caesar')
  await joinOral(app, team.id, 'crypto', 'сложное')
  await solve(app, team.id, 'crypto-rsa-oral')
  assert.equal(await gradeOf(app, 'crypto', team.id), 5)

  const full = await createTeam(app, 'Провал', ['Оля'])
  for (const task of TASKS.filter((item) => item.themeKey === 'crypto' && item.mode === 'тренажёр')) {
    await solve(app, full.id, task.id)
  }
  assert.equal(await gradeOf(app, 'crypto', full.id), 2)
  await joinOral(app, full.id, 'crypto', 'сложное')
  const opened = await app.inject({
    method: 'POST',
    url: '/api/tasks/crypto-rsa-oral/open',
    payload: { teamId: full.id },
  })
  assert.equal(opened.statusCode, 200, opened.body)
  const missed = await app.inject({
    method: 'POST',
    url: '/api/tasks/crypto-rsa-oral/submissions',
    payload: { teamId: full.id, answer: 'не тот ответ' },
  })
  assert.equal((missed.json() as { result: string }).result, 'не зачтено')
  assert.equal(await gradeOf(app, 'crypto', full.id), null)

  const listed = await app.inject({ method: 'GET', url: '/api/solutions' })
  const row = (listed.json() as { solutions: { id: string; teamName: string; verdict: string }[] }).solutions.find(
    (item) => item.teamName === 'Провал' && item.verdict === 'не зачтено',
  )
  assert.ok(row)
  const denied = await app.inject({
    method: 'POST',
    url: `/api/solutions/${row.id}/correct-path`,
    headers: { authorization: `Bearer ${full.token}` },
  })
  assert.equal(denied.statusCode, 403)
  const marked = await app.inject({
    method: 'POST',
    url: `/api/solutions/${row.id}/correct-path`,
    headers: teacherAuth(app),
  })
  assert.equal(marked.statusCode, 200)
  assert.equal(await gradeOf(app, 'crypto', full.id), 4)
  await app.close()
})
