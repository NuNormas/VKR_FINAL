import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { bankGenerators } from '../src/domain/bank.js'
import { BehaviorChecker } from '../src/domain/behavior-checker.js'
import { caesarGenerator } from '../src/domain/caesar.js'
import { TASKS, trainerTaskIds } from '../src/domain/catalog.js'
import { THEMES } from '../src/domain/themes.js'

const generators = new Map(
  [caesarGenerator, ...bankGenerators].map((generator) => [generator.id, generator]),
)

const BANNED = ['portswigger', 'tryhackme', 'picoctf', 'hackerdom', 'cybber.ru', 'hackthebox', "' or", '1=1', '<script']

test('у каждой темы есть домашний пул и очный вариант на другом материале', () => {
  assert.deepEqual(
    THEMES.map((theme) => theme.name),
    [
      'Введение в кибербезопасность',
      'Основы современной криптографии и методов защиты информации',
      'Механизмы авторизации, аутентификации и контроля доступа',
      'Классические клиентские и серверные уязвимости',
      'Продвинутые методы атаки и защиты веб-приложений',
      'Принципы безопасной разработки ПО по OWASP',
      'Код-ревью и анализ рисков информационной безопасности',
      'Безопасное развертывание и мониторинг (методология DevSecOps)',
    ],
  )
  for (const theme of THEMES) {
    assert.ok(trainerTaskIds(theme.key).length >= 1, theme.key)
    assert.ok(TASKS.some((task) => task.themeKey === theme.key && task.mode === 'очное'), theme.key)
  }
  assert.equal(TASKS.some((task) => task.id === 'author-jeopardy'), false)
  assert.ok(TASKS.filter((task) => task.work === 8).every((task) => task.format === 'индивидуальное'))
  assert.ok(TASKS.filter((task) => task.work < 8).every((task) => task.format === 'командное'))
  for (const id of ['crypto-xor', 'crypto-ecb', 'crypto-rsa', 'crypto-pad', 'crypto-jwt']) {
    assert.equal(TASKS.find((task) => task.id === id)?.mode, 'тренажёр')
  }
  assert.notEqual(
    generators.get('ecb-sample')!.generate('alpha').condition.statement,
    generators.get('ecb-cookie')!.generate('alpha').condition.statement,
  )
})

test('условия не отдают секрет и не зовут на чужие площадки', () => {
  for (const task of TASKS) {
    const generator = generators.get(task.generatorId)
    assert.ok(generator, task.id)
    assert.deepEqual(generator.generate('same-seed'), generator.generate('same-seed'))
    const secrets = new Set(
      Array.from({ length: 8 }, (_, index) => generator.generate(`probe-${index}`).secret),
    )
    assert.ok(secrets.size > 1, task.id)
    const variant = generator.generate('same-seed')
    const published = JSON.stringify(variant.condition).toLowerCase()
    for (const banned of BANNED) assert.equal(published.includes(banned), false, `${task.id} ${banned}`)
    if (task.checkerKind === 'string' || task.checkerKind === 'stand-flag') {
      assert.equal(published.includes(variant.secret.toLowerCase()), false, task.id)
    }
  }
})

test('повтор ключа, малый RSA и сканер сборки проверяются по поведению', () => {
  const xor = generators.get('xor-repeat')!.generate('alpha')
  const lines = Object.fromEntries(
    xor.condition.statement.split('\n').map((line) => {
      const split = line.indexOf(': ')
      return [line.slice(0, split), line.slice(split + 2)]
    }),
  )
  const known = Buffer.from(lines['Известный текст'] ?? '', 'utf8')
  const first = Buffer.from(lines['Первый шифртекст'] ?? '', 'hex')
  const second = Buffer.from(lines['Второй шифртекст'] ?? '', 'hex')
  const recovered = Buffer.alloc(known.length)
  for (let index = 0; index < known.length; index += 1) {
    recovered[index] = known[index]! ^ first[index]! ^ second[index]!
  }
  assert.equal(recovered.toString('utf8'), xor.secret)

  const rsa = generators.get('rsa-small-e')!.generate('alpha')
  const ciphertext = BigInt(rsa.condition.statement.match(/c = (\d+)/)?.[1] ?? '0')
  let low = 0n
  let high = ciphertext
  while (low < high) {
    const mid = (low + high) / 2n
    if (mid * mid * mid < ciphertext) low = mid + 1n
    else high = mid
  }
  const flag = Buffer.from(low.toString(16), 'hex').toString('utf8')
  assert.equal(flag, rsa.secret)

  const pipeline = generators.get('devsecops-pipeline')!.generate('alpha')
  const checker = new BehaviorChecker()
  const spec = JSON.parse(pipeline.secret) as { banned: string[]; required: string[] }
  assert.equal(checker.check(pipeline.secret, pipeline.condition.statement).accepted, false)
  assert.equal(checker.check(pipeline.secret, spec.required.join('\n')).accepted, true)
})

test('исправление кода проходит, исходный вариант нет', () => {
  const review = generators.get('review-code')!.generate('alpha')
  const checker = new BehaviorChecker()
  const original = `function ${review.condition.statement.split('function ')[1]?.split('\nПоле')[0] ?? ''}`
  assert.equal(checker.check(review.secret, original).accepted, false)
  const spec = JSON.parse(review.secret) as { owner: string }
  const fixed = [
    'function readRecord(user, key, records) {',
    '  return records.find((row) => row.id === key && row.' + spec.owner + ' === user) ?? null',
    '}',
  ].join('\n')
  assert.equal(checker.check(review.secret, fixed).accepted, true)

  const reset = generators.get('auth-reset')!.generate('alpha')
  const time = reset.condition.statement.match(/time=(\d+)/)?.[1]
  const token = createHash('sha256').update(`admin|${time}`).digest('hex').slice(0, 16)
  assert.equal(reset.secret, `HITS{${token}}`)
})
