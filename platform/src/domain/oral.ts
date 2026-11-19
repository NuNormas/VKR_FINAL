import { DomainError } from './errors.js'
import type { TaskLevel } from './catalog.js'
import { requireTheme } from './themes.js'
import type { OralSession, PostgresOralSessionRepository } from '../repository/accounts.js'

const LEVELS: readonly TaskLevel[] = ['простое', 'среднее', 'сложное']

export class OralSessionService {
  constructor(private readonly sessions: PostgresOralSessionRepository) {}

  async open(input: { themeKey: string; level: string; minutes: number }): Promise<OralSession> {
    requireTheme(input.themeKey)
    if (!LEVELS.includes(input.level as TaskLevel)) {
      throw new DomainError('Уровень: простое, среднее или сложное', 'bad_request')
    }
    if (!Number.isInteger(input.minutes) || input.minutes < 10 || input.minutes > 20) {
      throw new DomainError('Таймер сессии от 10 до 20 минут', 'bad_request')
    }
    return this.sessions.create({
      themeKey: input.themeKey,
      level: input.level as TaskLevel,
      minutes: input.minutes,
    })
  }

  join(code: string, userId: string): Promise<OralSession> {
    const value = code.trim()
    if (!value) throw new DomainError('Нужен код сессии', 'bad_request')
    return this.sessions.join(value, userId)
  }
}
