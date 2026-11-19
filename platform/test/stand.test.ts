import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { test } from 'node:test'
import { DockerStandRuntime } from '../src/stands/runtime.js'
import { createApp, createTeam, openWindow } from './helpers.js'

test('стенд входа поднимается отдельно на команду и не показывает флаг', async (t) => {
  const app = await createApp(new DockerStandRuntime())
  t.after(async () => {
    await removeStands()
    await app.close()
  })

  const first = await createTeam(app, 'Первые', ['Аня'])
  const second = await createTeam(app, 'Вторые', ['Боря'])
  await openWindow(app, 'web')

  const leftStarted = Date.now()
  const left = await app.inject({
    method: 'POST',
    url: '/api/tasks/web-sqli/open',
    payload: { teamId: first.id },
  })
  assert.ok(Date.now() - leftStarted < 30_000)
  assert.equal(left.statusCode, 200, left.body)
  const rightStarted = Date.now()
  const right = await app.inject({
    method: 'POST',
    url: '/api/tasks/web-sqli/open',
    payload: { teamId: second.id },
  })
  assert.ok(Date.now() - rightStarted < 30_000)
  assert.equal(right.statusCode, 200, right.body)

  const leftUrl = (left.json() as { condition: { standUrl?: string; statement: string } }).condition.standUrl
  const rightUrl = (right.json() as { condition: { standUrl?: string } }).condition.standUrl
  assert.ok(leftUrl && rightUrl && leftUrl !== rightUrl)
  const leftFlag = await flagOf(app.pool, first.id)
  const rightFlag = await flagOf(app.pool, second.id)
  assert.equal(JSON.stringify(left.json()).includes(leftFlag), false)
  assert.equal((left.json() as { condition: { statement: string } }).condition.statement.includes('Адрес стенда'), true)

  const plain = await fetch(`${leftUrl}?name=student`)
  const plainText = await plain.text()
  assert.equal(plainText.includes(leftFlag), false)
  assert.equal(plainText.includes('обычная запись'), true)

  const crypto = await app.inject({
    method: 'POST',
    url: '/api/tasks/crypto-caesar/open',
    payload: { teamId: first.id },
  })
  assert.equal(crypto.statusCode, 409)

  await openWindow(app, 'crypto')
  const caesar = await app.inject({
    method: 'POST',
    url: '/api/tasks/crypto-caesar/open',
    payload: { teamId: first.id },
  })
  assert.equal(caesar.statusCode, 200)
  assert.equal((caesar.json() as { condition: { standUrl?: string } }).condition.standUrl, undefined)

  await killByPort(new URL(leftUrl).port)
  await assert.rejects(fetch(leftUrl, { signal: AbortSignal.timeout(1000) }))
  const still = await fetch(rightUrl)
  assert.equal(still.status, 200)
  assert.equal((await still.text()).includes(rightFlag), false)

  const accepted = await app.inject({
    method: 'POST',
    url: '/api/tasks/web-sqli/submissions',
    payload: { teamId: second.id, answer: rightFlag },
  })
  assert.deepEqual(accepted.json(), { result: 'зачтено' })
  const rejected = await app.inject({
    method: 'POST',
    url: '/api/tasks/web-sqli/submissions',
    payload: { teamId: second.id, answer: 'HITS{not-the-flag}' },
  })
  assert.deepEqual(rejected.json(), { result: 'не зачтено' })
})

test('остальные веб-стенды поднимаются отдельно, шифр и патч без контейнера', async (t) => {
  const app = await createApp(new DockerStandRuntime())
  t.after(async () => {
    await removeStands()
    await app.close()
  })

  const first = await createTeam(app, 'Первые', ['Аня'])
  const second = await createTeam(app, 'Вторые', ['Боря'])
  await openWindow(app, 'web')
  await openWindow(app, 'web-advanced')
  await openWindow(app, 'crypto')
  await openWindow(app, 'owasp')
  await openWindow(app, 'review')
  await openWindow(app, 'devsecops')
  await openWindow(app, 'access')

  const home: Record<string, { path: string; marker: string }> = {
    'web-xss': { path: '/?name=student', marker: 'Привет, student' },
    'web-csrf': { path: '/', marker: 'Текущая почта' },
    'web-idor': { path: '/?id=7', marker: 'ваша карточка' },
    'web-traversal': { path: '/?file=readme.txt', marker: 'заметка команды' },
    'web-ssrf': { path: '/?url=http://example.test/doc', marker: 'Внешний адрес' },
    'web-deser': { path: '/', marker: 'сессия студента' },
    'web-command': { path: '/?title=otchet', marker: '<pre>otchet</pre>' },
  }

  const urls = new Map<string, string>()
  for (const [taskId, spec] of Object.entries(home)) {
    const opened = await openLive(app, taskId, first.id)
    const url = opened.condition.standUrl
    assert.ok(url, taskId)
    urls.set(taskId, url)
    const flag = await flagOfTask(app.pool, first.id, taskId)
    assert.equal(JSON.stringify(opened).includes(flag), false, taskId)
    const response = await fetch(url + spec.path.slice(1))
    const text = await response.text()
    assert.equal(response.status, 200, taskId)
    assert.equal(text.includes(flag), false, taskId)
    assert.equal(text.includes(spec.marker), true, taskId)
    const accepted = await app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/submissions`,
      payload: { teamId: first.id, answer: flag },
    })
    assert.deepEqual(accepted.json(), { result: 'зачтено' })
  }

  const other = await openLive(app, 'web-xss', second.id)
  assert.notEqual(other.condition.standUrl, urls.get('web-xss'))

  await joinOral(app, 'web', 'среднее', first.token)
  const orders = await openLive(app, 'web-sqli-oral', first.id)
  const orderFlag = await flagOfTask(app.pool, first.id, 'web-sqli-oral')
  const orderPage = await fetch(`${orders.condition.standUrl}?q=own`)
  const orderText = await orderPage.text()
  assert.equal(orderText.includes(orderFlag), false)
  assert.equal(orderText.includes('свой заказ'), true)

  await joinOral(app, 'web-advanced', 'сложное', first.token)
  const avatars = await openLive(app, 'web-ssrf-oral', first.id)
  const avatarFlag = await flagOfTask(app.pool, first.id, 'web-ssrf-oral')
  const avatarPage = await fetch(`${avatars.condition.standUrl}?avatar=http://example.test/pic`)
  const avatarText = await avatarPage.text()
  assert.equal(avatarText.includes(avatarFlag), false)
  assert.equal(avatarText.includes('Внешний адрес'), true)
  assert.equal(JSON.stringify(avatars).includes(avatarFlag), false)

  await killByPort(new URL(urls.get('web-xss')!).port)
  await assert.rejects(fetch(urls.get('web-xss')!, { signal: AbortSignal.timeout(1000) }))
  const still = await fetch(urls.get('web-csrf')!)
  assert.equal(still.status, 200)
  const otherStill = await fetch(other.condition.standUrl!)
  assert.equal(otherStill.status, 200)

  for (const taskId of ['crypto-caesar', 'owasp-query', 'review-code', 'devsecops-pipeline', 'auth-reset']) {
    const opened = await app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/open`,
      payload: { teamId: first.id },
    })
    assert.equal(opened.statusCode, 200, opened.body)
    assert.equal((opened.json() as { condition: { standUrl?: string } }).condition.standUrl, undefined, taskId)
  }
})

async function openLive(
  app: { inject: Function },
  taskId: string,
  teamId: string,
): Promise<{ condition: { standUrl?: string } }> {
  const started = Date.now()
  const response = await app.inject({
    method: 'POST',
    url: `/api/tasks/${taskId}/open`,
    payload: { teamId },
  })
  assert.ok(Date.now() - started < 30_000, taskId)
  assert.equal(response.statusCode, 200, response.body)
  return response.json() as { condition: { standUrl?: string } }
}

async function flagOfTask(pool: { query: Function }, teamId: string, taskId: string): Promise<string> {
  const result = await pool.query('SELECT secret FROM task_issues WHERE team_id = $1 AND task_id = $2', [
    teamId,
    taskId,
  ])
  return result.rows[0].secret as string
}

async function joinOral(
  app: { inject: Function },
  themeKey: string,
  level: string,
  token: string,
): Promise<void> {
  const opened = await app.inject({
    method: 'POST',
    url: '/api/oral-sessions',
    payload: { themeKey, level, minutes: 15 },
  })
  assert.equal(opened.statusCode, 201, opened.body)
  const joined = await app.inject({
    method: 'POST',
    url: '/api/oral-sessions/join',
    headers: { authorization: `Bearer ${token}` },
    payload: { code: (opened.json() as { code: string }).code },
  })
  assert.equal(joined.statusCode, 200, joined.body)
}

async function flagOf(pool: { query: Function }, teamId: string): Promise<string> {
  const result = await pool.query('SELECT secret FROM task_issues WHERE team_id = $1 AND task_id = $2', [
    teamId,
    'web-sqli',
  ])
  return result.rows[0].secret as string
}

function killByPort(port: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['ps', '--filter', 'name=trainer-web-', '--format', '{{.Names}}\t{{.Ports}}'])
    let stdout = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.on('error', reject)
    child.on('close', () => {
      const name = stdout
        .split('\n')
        .map((line) => line.split('\t'))
        .find((parts) => parts[1]?.includes(`:${port}->`))?.[0]
      if (!name) {
        reject(new Error(`контейнер на порту ${port} не найден`))
        return
      }
      const kill = spawn('docker', ['kill', name])
      kill.on('error', reject)
      kill.on('close', (code) => (code === 0 ? resolve() : reject(new Error('kill'))))
    })
  })
}

function removeStands(): Promise<void> {
  return new Promise((resolve) => {
    const list = spawn('docker', ['ps', '-aq', '--filter', 'name=trainer-web-'])
    let ids = ''
    list.stdout.setEncoding('utf8')
    list.stdout.on('data', (chunk: string) => {
      ids += chunk
    })
    list.on('close', () => {
      const names = ids.split('\n').map((line) => line.trim()).filter(Boolean)
      if (names.length === 0) {
        resolve()
        return
      }
      const rm = spawn('docker', ['rm', '-f', ...names])
      rm.on('close', () => resolve())
    })
    list.on('error', () => resolve())
  })
}
