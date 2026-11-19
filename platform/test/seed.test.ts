import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, sep } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { ALPHABET, caesarGenerator, shiftText } from '../src/domain/caesar.js'
import { StandFlagChecker, StringCompareChecker } from '../src/domain/checker.js'
import { GeneratorFactory } from '../src/domain/generator.js'
import { standFlagGenerator } from '../src/domain/stand-flag.js'
import { ThemeWindow } from '../src/domain/theme-window.js'

const factory = new GeneratorFactory([caesarGenerator, standFlagGenerator])

function recoversByBruteForce(ciphertext: string, secret: string): boolean {
  let hits = 0
  for (let shift = 1; shift < ALPHABET.length; shift += 1) {
    if (shiftText(ciphertext, shift) === secret) hits += 1
  }
  return hits === 1
}

test('один и тот же seed собирает тот же вариант', () => {
  assert.deepEqual(caesarGenerator.generate('alpha'), caesarGenerator.generate('alpha'))
  assert.deepEqual(standFlagGenerator.generate('alpha'), standFlagGenerator.generate('alpha'))
  assert.deepEqual(
    factory.create('caesar').generate('alpha'),
    caesarGenerator.generate('alpha'),
  )
})

test('разные seed дают разные секреты, и секрет не попадает в условие', () => {
  const seen = new Set<string>()
  for (let i = 0; i < 24; i += 1) {
    const caesar = caesarGenerator.generate(`crypto-${i}`)
    const stand = standFlagGenerator.generate(`stand-${i}`)
    assert.equal(seen.has(caesar.secret), false)
    assert.equal(seen.has(stand.secret), false)
    seen.add(caesar.secret)
    seen.add(stand.secret)

    const caesarPublic = JSON.stringify(caesar.condition)
    const standPublic = JSON.stringify(stand.condition)
    assert.equal(caesarPublic.includes(caesar.secret), false)
    assert.equal(standPublic.includes(stand.secret), false)
    assert.equal(caesar.condition.ciphertext?.includes(caesar.secret), false)
    assert.match(stand.secret, /^HITS\{[0-9a-f]{20}\}$/)
    assert.equal(recoversByBruteForce(caesar.condition.ciphertext ?? '', caesar.secret), true)
  }

  assert.notEqual(
    caesarGenerator.generate('alpha').secret,
    caesarGenerator.generate('beta').secret,
  )
  assert.notEqual(
    standFlagGenerator.generate('alpha').secret,
    standFlagGenerator.generate('beta').secret,
  )
})

test('чекер сравнивает строку и флаг и не принимает чужой секрет', () => {
  const own = standFlagGenerator.generate('own')
  const other = standFlagGenerator.generate('other')
  const flags = new StandFlagChecker()
  const strings = new StringCompareChecker()

  assert.deepEqual(flags.check(own.secret, own.secret), { accepted: true })
  assert.deepEqual(flags.check(own.secret, other.secret), { accepted: false })
  assert.deepEqual(flags.check(own.secret, 'HITS{deadbeef}'), { accepted: false })
  assert.equal(Object.keys(flags.check(own.secret, other.secret)).join(','), 'accepted')

  const ownText = caesarGenerator.generate('own')
  const otherText = caesarGenerator.generate('other')
  assert.equal(strings.check(ownText.secret, `  ${ownText.secret}  `).accepted, true)
  assert.equal(strings.check(ownText.secret, otherText.secret).accepted, false)
})

test('окно темы не открывается заново после конца недели', () => {
  const open = ThemeWindow.closed().open()
  assert.equal(open.phase, 'открыта')
  assert.doesNotThrow(() => open.assertAcceptsWork())

  const ended = open.end()
  assert.equal(ended.phase, 'закончилась')
  assert.throws(() => ended.assertAcceptsWork(), /Неделя темы закончилась/)
  assert.throws(() => ended.open(), /нельзя открыть/)
  assert.throws(() => ThemeWindow.closed().end(), /нельзя закончить/)
  assert.throws(() => ThemeWindow.closed().assertAcceptsWork(), /Окно темы закрыто/)
})

test('docker вызывается только из рантайма стенда', () => {
  const src = fileURLToPath(new URL('../src', import.meta.url))
  const files: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else files.push(path)
    }
  }
  walk(src)
  const forbidden = /docker|child_process|spawn\(|exec\(/
  for (const path of files) {
    const text = readFileSync(path, 'utf8')
    if (path.endsWith(`${sep}stands${sep}runtime.ts`)) {
      assert.equal(/exec\(/.test(text), false, path)
      assert.equal(/shell:\s*true/.test(text), false, path)
      continue
    }
    assert.equal(forbidden.test(text), false, path)
  }
})
