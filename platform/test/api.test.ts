import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { TASKS } from '../src/domain/catalog.js'
import { THEMES } from '../src/domain/themes.js'
import { createApp, createTeam, openWindow } from './helpers.js'

const SECRET_KEYS = new Set(['seed', 'secret', 'flag', 'shift', 'plaintext', 'answer', 'expected', 'writeup'])

function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys)
    return keys
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      keys.add(key)
      collectKeys(child, keys)
    }
  }
  return keys
}

async function storedSecret(pool: Pool, teamId: string, taskId: string): Promise<{ seed: string; secret: string }> {
  const result = await pool.query<{ seed: string; secret: string }>(
    'SELECT seed, secret FROM task_issues WHERE team_id = $1 AND task_id = $2',
    [teamId, taskId],
  )
  const row = result.rows[0]
  assert.ok(row)
  return row
}

async function openTask(app: FastifyInstance, taskId: string, teamId: string) {
  const response = await app.inject({
    method: 'POST',
    url: `/api/tasks/${taskId}/open`,
    payload: { teamId },
  })
  assert.equal(response.statusCode, 200, response.body)
  return response.json() as {
    taskId: string
    condition: { statement: string; ciphertext?: string; standLabel?: string }
  }
}

describe('http', { concurrency: false }, () => {
test('команда из одного человека получает условие без секрета и тот же вариант по seed', async (t) => {
  const app = await createApp()
  t.after(() => app.close())

  const solo = await createTeam(app, 'Один', ['Аня'])
  assert.deepEqual(solo.members, ['Аня'])

  const themes = await app.inject({ method: 'GET', url: '/api/themes' })
  const themeNames = (themes.json() as { themes: { name: string }[] }).themes.map((theme) => theme.name)
  for (const theme of THEMES) assert.ok(themeNames.includes(theme.name))

  const closed = await app.inject({
    method: 'POST',
    url: '/api/tasks/crypto-caesar/open',
    payload: { teamId: solo.id },
  })
  assert.equal(closed.statusCode, 409)

  await openWindow(app, 'crypto')
  const first = await openTask(app, 'crypto-caesar', solo.id)
  const second = await openTask(app, 'crypto-caesar', solo.id)
  assert.deepEqual(second.condition, first.condition)

  const issue = await storedSecret(app.pool, solo.id, 'crypto-caesar')
  const again = await app.pool.query<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM task_issues WHERE team_id = $1 AND task_id = $2',
    [solo.id, 'crypto-caesar'],
  )
  assert.equal(again.rows[0]?.count, '1')

  const body = JSON.stringify(first)
  assert.equal(body.includes(issue.secret), false)
  assert.equal(body.includes(issue.seed), false)
  for (const key of collectKeys(first)) assert.equal(SECRET_KEYS.has(key), false, key)

  const other = await createTeam(app, 'Другие', ['Боря'])
  const otherOpen = await openTask(app, 'crypto-caesar', other.id)
  const otherIssue = await storedSecret(app.pool, other.id, 'crypto-caesar')
  assert.notEqual(otherIssue.seed, issue.seed)
  assert.notEqual(otherIssue.secret, issue.secret)
  assert.notEqual(otherOpen.condition.ciphertext, first.condition.ciphertext)
})

test('чужой флаг и чужой открытый текст не зачитываются и оставляют инцидент с двумя именами', async (t) => {
  const app = await createApp()
  t.after(() => app.close())

  const owner = await createTeam(app, 'Хозяева', ['Вера'])
  const submitter = await createTeam(app, 'Чужие', ['Глеб'])
  await openWindow(app, 'web')
  await openWindow(app, 'crypto')
  await openTask(app, 'web-sqli', owner.id)
  await openTask(app, 'web-sqli', submitter.id)
  await openTask(app, 'crypto-caesar', owner.id)
  await openTask(app, 'crypto-caesar', submitter.id)

  const ownerFlag = await storedSecret(app.pool, owner.id, 'web-sqli')
  const ownFlag = await storedSecret(app.pool, submitter.id, 'web-sqli')
  const ownerText = await storedSecret(app.pool, owner.id, 'crypto-caesar')

  const foreignFlag = await app.inject({
    method: 'POST',
    url: '/api/tasks/web-sqli/submissions',
    payload: { teamId: submitter.id, answer: ownerFlag.secret },
  })
  assert.equal(foreignFlag.statusCode, 200)
  assert.deepEqual(foreignFlag.json(), { result: 'не зачтено' })

  const foreignText = await app.inject({
    method: 'POST',
    url: '/api/tasks/crypto-caesar/submissions',
    payload: { teamId: submitter.id, answer: ownerText.secret },
  })
  assert.deepEqual(foreignText.json(), { result: 'не зачтено' })

  const noise = await app.inject({
    method: 'POST',
    url: '/api/tasks/web-sqli/submissions',
    payload: { teamId: submitter.id, answer: 'HITS{deadbeefdeadbeef00}' },
  })
  assert.deepEqual(noise.json(), { result: 'не зачтено' })

  const own = await app.inject({
    method: 'POST',
    url: '/api/tasks/web-sqli/submissions',
    payload: { teamId: submitter.id, answer: ownFlag.secret },
  })
  assert.deepEqual(own.json(), { result: 'зачтено' })

  const incidents = await app.inject({ method: 'GET', url: '/api/incidents' })
  const listed = incidents.json() as {
    incidents: { taskId: string; submitterName: string; ownerName: string; submitterTeamId: string; ownerTeamId: string }[]
  }
  assert.equal(listed.incidents.length, 2)
  for (const incident of listed.incidents) {
    assert.equal(incident.submitterName, 'Чужие')
    assert.equal(incident.ownerName, 'Хозяева')
    assert.equal(incident.submitterTeamId, submitter.id)
    assert.equal(incident.ownerTeamId, owner.id)
    assert.equal(JSON.stringify(incident).includes(ownerFlag.secret), false)
    assert.equal(JSON.stringify(incident).includes(ownerText.secret), false)
  }
  assert.deepEqual(
    listed.incidents.map((incident) => incident.taskId).sort(),
    ['crypto-caesar', 'web-sqli'],
  )
})

test('полный тренажёр темы без очной части — двойка, часть и пустая тема — не определено', async (t) => {
  const app = await createApp()
  t.after(() => app.close())

  const team = await createTeam(app, 'Лаба', ['Даша'])
  const before = await app.inject({
    method: 'GET',
    url: `/api/themes/crypto/grade?teamId=${team.id}`,
  })
  assert.equal(before.statusCode, 200)
  assert.equal((before.json() as { grade: number | null }).grade, null)

  const intro = await app.inject({
    method: 'GET',
    url: `/api/themes/intro/grade?teamId=${team.id}`,
  })
  assert.equal((intro.json() as { grade: number | null; label: string }).grade, null)
  assert.equal((intro.json() as { label: string }).label, 'не определено')

  await openWindow(app, 'crypto')
  const cryptoTasks = TASKS.filter((task) => task.themeKey === 'crypto' && task.mode === 'тренажёр')
  assert.ok(cryptoTasks.length >= 1)
  for (const task of cryptoTasks) {
    await openTask(app, task.id, team.id)
    const issue = await storedSecret(app.pool, team.id, task.id)
    const submitted = await app.inject({
      method: 'POST',
      url: `/api/tasks/${task.id}/submissions`,
      payload: { teamId: team.id, answer: issue.secret },
    })
    assert.deepEqual(submitted.json(), { result: 'зачтено' })
  }

  const grade = await app.inject({
    method: 'GET',
    url: `/api/themes/crypto/grade?teamId=${team.id}`,
  })
  assert.deepEqual(grade.json(), {
    theme: 'Основы современной криптографии и методов защиты информации',
    trainerTasksTotal: cryptoTasks.length,
    trainerTasksSolved: cryptoTasks.length,
    grade: 2,
    label: 'неудовлетворительно',
  })

  const web = await app.inject({
    method: 'GET',
    url: `/api/themes/web/grade?teamId=${team.id}`,
  })
  assert.equal((web.json() as { grade: number | null }).grade, null)

  const ended = await app.inject({
    method: 'POST',
    url: '/api/themes/crypto/window',
    payload: { action: 'закончить' },
  })
  assert.equal((ended.json() as { phase: string }).phase, 'закончилась')

  const late = await app.inject({
    method: 'POST',
    url: '/api/tasks/crypto-caesar/submissions',
    payload: { teamId: team.id, answer: 'уже поздно' },
  })
  assert.equal(late.statusCode, 409)

  const reopened = await app.inject({
    method: 'POST',
    url: '/api/themes/crypto/window',
    payload: { action: 'открыть' },
  })
  assert.equal(reopened.statusCode, 409)
})

test('правка кода принимается, исходный текст и чужая сборка нет, DevSecOps только один', async (t) => {
  const app = await createApp()
  t.after(() => app.close())

  const pair = await createTeam(app, 'Пара', ['Аня', 'Боря'])
  await openWindow(app, 'devsecops')
  const denied = await app.inject({
    method: 'POST',
    url: '/api/tasks/devsecops-pipeline/open',
    payload: { teamId: pair.id },
  })
  assert.equal(denied.statusCode, 409)

  await openWindow(app, 'review')
  const opened = await openTask(app, 'review-code', pair.id)
  const spec = JSON.parse(await storedSecret(app.pool, pair.id, 'review-code').then((row) => row.secret)) as {
    owner: string
  }
  const lines = opened.condition.statement.split('\n')
  const start = lines.findIndex((line) => line.startsWith('function '))
  const broken = lines.slice(start, start + 3).join('\n')
  const brokenSubmit = await app.inject({
    method: 'POST',
    url: '/api/tasks/review-code/submissions',
    payload: { teamId: pair.id, answer: broken },
  })
  assert.deepEqual(brokenSubmit.json(), { result: 'не зачтено' })
  const fixed = [
    'function readRecord(user, key, records) {',
    `  return records.find((row) => row.id === key && row.${spec.owner} === user) ?? null`,
    '}',
  ].join('\n')
  const accepted = await app.inject({
    method: 'POST',
    url: '/api/tasks/review-code/submissions',
    payload: { teamId: pair.id, answer: fixed },
  })
  assert.deepEqual(accepted.json(), { result: 'зачтено' })

  const solo = await createTeam(app, 'Один', ['Варя'])
  await openTask(app, 'devsecops-pipeline', solo.id)
  const pipeline = JSON.parse(
    (await storedSecret(app.pool, solo.id, 'devsecops-pipeline')).secret,
  ) as { required: string[] }
  const built = await app.inject({
    method: 'POST',
    url: '/api/tasks/devsecops-pipeline/submissions',
    payload: { teamId: solo.id, answer: pipeline.required.join('\n') },
  })
  assert.deepEqual(built.json(), { result: 'зачтено' })
})

test('проверка живости базы', async (t) => {
  const app = await createApp()
  t.after(() => app.close())
  const health = await app.inject({ method: 'GET', url: '/health' })
  assert.deepEqual(health.json(), { status: 'ok' })
})
})
