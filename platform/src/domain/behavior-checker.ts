import { runInNewContext } from 'node:vm'
import type { Checker, Verdict } from './checker.js'

interface ReviewSpec {
  type: 'review-owner'
  fn: string
  id: string
  owner: string
}

interface QuerySpec {
  type: 'owasp-query'
}

interface RenderSpec {
  type: 'owasp-render'
}

interface PipelineSpec {
  type: 'pipeline'
  banned: string[]
  required: string[]
}

interface ConfigSpec {
  type: 'config'
  mustHave: string[]
  mustNot: string[]
}

interface PathSpec {
  type: 'path'
  prefix: string
}

type BehaviorSpec = ReviewSpec | QuerySpec | RenderSpec | PipelineSpec | ConfigSpec | PathSpec

function rejected(): Verdict {
  return { accepted: false }
}

function loadFunction(source: string, name: string): (...args: unknown[]) => unknown {
  const sandbox = { Array, Object, String, Number, JSON }
  const fn = runInNewContext(`${source}\n${name}`, sandbox, { timeout: 50 })
  if (typeof fn !== 'function') throw new Error('not a function')
  return fn as (...args: unknown[]) => unknown
}

function reviewOwner(spec: ReviewSpec, answer: string): boolean {
  const fn = loadFunction(answer, spec.fn)
  const records = [
    { [spec.id]: '1', [spec.owner]: 'a', title: 'own' },
    { [spec.id]: '2', [spec.owner]: 'b', title: 'other' },
  ]
  const own = fn('a', '1', records) as { title?: string } | null
  const other = fn('a', '2', records)
  const missing = fn('a', '9', records)
  return own?.title === 'own' && other == null && missing == null
}

function owaspQuery(answer: string): boolean {
  const fn = loadFunction(answer, 'findUser')
  const users = [
    { name: 'ann', note: 'a' },
    { name: 'bob', note: 'b' },
  ]
  const ann = fn('ann', users) as { name?: string } | null
  const bob = fn('bob', users) as { name?: string } | null
  const hostile = fn("ann'", users) as { name?: string } | null
  return ann?.name === 'ann' && bob?.name === 'bob' && hostile == null
}

function owaspRender(answer: string): boolean {
  const fn = loadFunction(answer, 'render')
  const plain = String(fn('ok'))
  const marked = String(fn('a<b>'))
  const ampersand = String(fn('a&b'))
  return (
    plain.includes('ok') &&
    !marked.includes('<b>') &&
    !ampersand.includes('a&b') &&
    ampersand.includes('a')
  )
}

function pipeline(spec: PipelineSpec, answer: string): boolean {
  const text = answer.normalize('NFC')
  if (spec.banned.some((line) => text.includes(line))) return false
  return spec.required.every((line) => text.includes(line))
}

function configFix(spec: ConfigSpec, answer: string): boolean {
  const text = answer.normalize('NFC')
  if (spec.mustNot.some((line) => text.includes(line))) return false
  return spec.mustHave.every((line) => text.includes(line))
}

function pathBypass(spec: PathSpec, answer: string): boolean {
  const path = answer.normalize('NFC').trim()
  if (!path.startsWith('/') || path.length > 80) return false
  const brokenAllows = !path.startsWith(spec.prefix) && path.toLowerCase().includes(spec.prefix.slice(1))
  const fixedDenies = path.toLowerCase().startsWith(spec.prefix)
  return brokenAllows && fixedDenies
}

export class BehaviorChecker implements Checker {
  readonly kind = 'behavior' as const

  check(secret: string, answer: string): Verdict {
    let spec: BehaviorSpec
    try {
      spec = JSON.parse(secret) as BehaviorSpec
    } catch {
      return rejected()
    }
    try {
      if (spec.type === 'review-owner') return { accepted: reviewOwner(spec, answer) }
      if (spec.type === 'owasp-query') return { accepted: owaspQuery(answer) }
      if (spec.type === 'owasp-render') return { accepted: owaspRender(answer) }
      if (spec.type === 'pipeline') return { accepted: pipeline(spec, answer) }
      if (spec.type === 'config') return { accepted: configFix(spec, answer) }
      if (spec.type === 'path') return { accepted: pathBypass(spec, answer) }
    } catch {
      return rejected()
    }
    return rejected()
  }
}
