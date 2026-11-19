import { DomainError } from './errors.js'
import { timingSafeEqual } from 'node:crypto'

export type CheckerKind = 'string' | 'stand-flag' | 'teacher' | 'behavior'

export interface Verdict {
  accepted: boolean
  pendingTeacher?: boolean
}

export interface Checker {
  readonly kind: CheckerKind
  check(secret: string, answer: string): Verdict
}

function normalized(value: string): string {
  return value.normalize('NFC').trim()
}

export class StringCompareChecker implements Checker {
  readonly kind = 'string' as const

  check(secret: string, answer: string): Verdict {
    return { accepted: normalized(secret) === normalized(answer) }
  }
}

export class StandFlagChecker implements Checker {
  readonly kind = 'stand-flag' as const

  check(secret: string, answer: string): Verdict {
    const expected = Buffer.from(normalized(secret), 'utf8')
    const given = Buffer.from(normalized(answer), 'utf8')
    if (expected.length === 0 || expected.length !== given.length) {
      return { accepted: false }
    }
    return { accepted: timingSafeEqual(expected, given) }
  }
}

export class TeacherChecker implements Checker {
  readonly kind = 'teacher' as const

  check(_secret: string, answer: string): Verdict {
    if (answer.normalize('NFC').trim().length === 0) {
      return { accepted: false }
    }
    return { accepted: false, pendingTeacher: true }
  }
}

export class CheckerRegistry {
  private readonly byKind: Map<CheckerKind, Checker>

  constructor(checkers: Checker[]) {
    this.byKind = new Map(checkers.map((checker) => [checker.kind, checker]))
  }

  forKind(kind: CheckerKind): Checker {
    const checker = this.byKind.get(kind)
    if (!checker) {
      throw new DomainError(`Проверка «${kind}» не подключена`, 'internal')
    }
    return checker
  }
}
