import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createApp, createTeam, openWindow, teacherAuth } from './helpers.js'

const FLAG = 'HITS{own-flag-1}'

test('преподаватель собирает задание, студент видит только свой вердикт', async () => {
  const app = await createApp()
  const created = await app.inject({
    method: 'POST',
    url: '/api/teacher-tasks',
    headers: teacherAuth(app),
    payload: {
      title: 'Свой след',
      themeKey: 'intro',
      competency: 'Читает условие и сдаёт секрет паспорта',
      mode: 'тренажёр',
      level: 'простое',
      statement: 'Секрет лежит в паспорте и в условие не входит. Сдайте его.',
      checker: 'флаг',
      secret: FLAG,
    },
  })
  assert.equal(created.statusCode, 201)
  const id = (created.json() as { id: string }).id

  const owner = await createTeam(app, 'Аня', ['Аня'])
  const other = await createTeam(app, 'Боря', ['Боря'])

  const hidden = await app.inject({
    method: 'GET',
    url: `/api/teacher-tasks/${id}`,
    headers: { authorization: `Bearer ${owner.token}` },
  })
  assert.equal(hidden.statusCode, 200)
  assert.equal((hidden.json() as { statement: string | null }).statement, null)
  assert.equal(JSON.stringify(hidden.json()).includes(FLAG), false)

  const before = await app.inject({ method: 'GET', url: `/api/themes/intro/grade?teamId=${owner.id}` })
  const total = (before.json() as { trainerTasksTotal: number }).trainerTasksTotal
  const solved = (before.json() as { trainerTasksSolved: number }).trainerTasksSolved

  await openWindow(app, 'intro')
  const card = await app.inject({
    method: 'GET',
    url: `/api/teacher-tasks/${id}`,
    headers: { authorization: `Bearer ${owner.token}` },
  })
  assert.equal(card.statusCode, 200)
  const body = JSON.stringify(card.json())
  assert.equal(body.includes('Секрет лежит в паспорте'), true)
  assert.equal(body.includes(FLAG), false)
  assert.equal((card.json() as { secret?: string }).secret, undefined)

  const teacherCard = await app.inject({ method: 'GET', url: `/api/teacher-tasks/${id}` })
  assert.equal((teacherCard.json() as { secret: string }).secret, FLAG)

  const wrong = await app.inject({
    method: 'POST',
    url: `/api/teacher-tasks/${id}/submissions`,
    payload: { teamId: owner.id, answer: 'HITS{other-flag}' },
  })
  assert.equal((wrong.json() as { result: string }).result, 'не зачтено')
  const right = await app.inject({
    method: 'POST',
    url: `/api/teacher-tasks/${id}/submissions`,
    payload: { teamId: owner.id, answer: FLAG },
  })
  assert.equal((right.json() as { result: string }).result, 'зачтено')

  const ownList = await app.inject({ method: 'GET', url: `/api/teacher-tasks?teamId=${owner.id}` })
  const ownVerdict = (ownList.json() as { tasks: { id: string; verdict: string | null }[] }).tasks.find(
    (task) => task.id === id,
  )
  assert.equal(ownVerdict?.verdict, 'зачтено')
  assert.equal(JSON.stringify(ownList.json()).includes(FLAG), false)

  const otherList = await app.inject({
    method: 'GET',
    url: `/api/teacher-tasks?teamId=${other.id}`,
    headers: { authorization: `Bearer ${other.token}` },
  })
  const otherVerdict = (otherList.json() as { tasks: { id: string; verdict: string | null }[] }).tasks.find(
    (task) => task.id === id,
  )
  assert.equal(otherVerdict?.verdict, null)
  const stolen = await app.inject({
    method: 'GET',
    url: `/api/teacher-tasks?teamId=${owner.id}`,
    headers: { authorization: `Bearer ${other.token}` },
  })
  assert.equal(stolen.statusCode, 403)

  const after = await app.inject({ method: 'GET', url: `/api/themes/intro/grade?teamId=${owner.id}` })
  assert.equal((after.json() as { trainerTasksTotal: number }).trainerTasksTotal, total)
  assert.equal((after.json() as { trainerTasksSolved: number }).trainerTasksSolved, solved)

  const generated = await app.inject({
    method: 'POST',
    url: '/api/tasks/intro-protocol/open',
    payload: { teamId: owner.id },
  })
  assert.equal(generated.statusCode, 200)
  const issue = await app.pool.query<{ seed: string; secret: string }>(
    `SELECT seed, secret FROM task_issues WHERE team_id = $1 AND task_id = 'intro-protocol'`,
    [owner.id],
  )
  assert.equal(issue.rows[0]?.seed.length, 32)
  assert.equal(JSON.stringify(generated.json()).includes(issue.rows[0]!.secret), false)
  const customIssues = await app.pool.query(`SELECT 1 FROM task_issues WHERE task_id = $1`, [id])
  assert.equal(customIssues.rowCount, 0)

  const denied = await app.inject({
    method: 'POST',
    url: '/api/teacher-tasks',
    headers: { authorization: `Bearer ${owner.token}` },
    payload: {
      title: 'Чужое',
      themeKey: 'intro',
      competency: 'Не должно сохраниться',
      mode: 'тренажёр',
      level: 'простое',
      statement: 'Студент задание не собирает.',
      checker: 'строка',
      secret: 'текст',
    },
  })
  assert.equal(denied.statusCode, 403)
  await app.close()
})

test('строка и патч сверяются по паспорту, очное ждёт сессию', async () => {
  const app = await createApp()
  await openWindow(app, 'crypto')
  const text = await app.inject({
    method: 'POST',
    url: '/api/teacher-tasks',
    payload: {
      title: 'Фраза',
      themeKey: 'crypto',
      competency: 'Сдаёт точную строку',
      mode: 'тренажёр',
      level: 'среднее',
      statement: 'Сдайте фразу из паспорта.',
      checker: 'строка',
      secret: 'открытый текст',
    },
  })
  const textId = (text.json() as { id: string }).id
  const team = await createTeam(app, 'Вера', ['Вера'])
  const textVerdict = await app.inject({
    method: 'POST',
    url: `/api/teacher-tasks/${textId}/submissions`,
    payload: { teamId: team.id, answer: '  открытый текст  ' },
  })
  assert.equal((textVerdict.json() as { result: string }).result, 'зачтено')

  const patch = await app.inject({
    method: 'POST',
    url: '/api/teacher-tasks',
    payload: {
      title: 'Правка',
      themeKey: 'crypto',
      competency: 'Правит текст так, что нужная строка есть, а лишняя нет',
      mode: 'тренажёр',
      level: 'среднее',
      statement: 'Оставьте отметку годности и уберите отметку брака.',
      checker: 'патч',
      mustHave: ['годность: да'],
      mustNot: ['брак: да'],
    },
  })
  assert.equal(patch.statusCode, 201)
  const patchId = (patch.json() as { id: string }).id
  const studentPatch = await app.inject({
    method: 'GET',
    url: `/api/teacher-tasks/${patchId}`,
    headers: { authorization: `Bearer ${team.token}` },
  })
  assert.equal(JSON.stringify(studentPatch.json()).includes('годность: да'), false)
  const broken = await app.inject({
    method: 'POST',
    url: `/api/teacher-tasks/${patchId}/submissions`,
    payload: { teamId: team.id, answer: 'годность: да\nбрак: да' },
  })
  assert.equal((broken.json() as { result: string }).result, 'не зачтено')
  const fixed = await app.inject({
    method: 'POST',
    url: `/api/teacher-tasks/${patchId}/submissions`,
    payload: { teamId: team.id, answer: 'годность: да' },
  })
  assert.equal((fixed.json() as { result: string }).result, 'зачтено')

  const oral = await app.inject({
    method: 'POST',
    url: '/api/teacher-tasks',
    payload: {
      title: 'Очная фраза',
      themeKey: 'crypto',
      competency: 'Сдаёт строку на паре',
      mode: 'очное',
      level: 'простое',
      statement: 'Сдайте фразу на паре.',
      checker: 'строка',
      secret: 'очная фраза',
    },
  })
  const oralId = (oral.json() as { id: string }).id
  const early = await app.inject({
    method: 'POST',
    url: `/api/teacher-tasks/${oralId}/submissions`,
    payload: { teamId: team.id, answer: 'очная фраза' },
  })
  assert.equal(early.statusCode, 409)
  const session = await app.inject({
    method: 'POST',
    url: '/api/oral-sessions',
    payload: { themeKey: 'crypto', level: 'простое', minutes: 15 },
  })
  const code = (session.json() as { code: string }).code
  const join = await app.inject({
    method: 'POST',
    url: '/api/oral-sessions/join',
    headers: { authorization: `Bearer ${team.token}` },
    payload: { code },
  })
  assert.equal(join.statusCode, 200)
  const oralVerdict = await app.inject({
    method: 'POST',
    url: `/api/teacher-tasks/${oralId}/submissions`,
    payload: { teamId: team.id, answer: 'очная фраза' },
  })
  assert.equal((oralVerdict.json() as { result: string }).result, 'зачтено')
  await app.close()
})
