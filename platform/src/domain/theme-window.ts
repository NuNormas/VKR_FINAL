import { DomainError } from './errors.js'

export const WINDOW_PHASES = ['закрыта', 'открыта', 'закончилась'] as const

export type WindowPhase = (typeof WINDOW_PHASES)[number]

function isPhase(value: string): value is WindowPhase {
  return (WINDOW_PHASES as readonly string[]).includes(value)
}

// Окно темы: закрыта → открыта → закончилась. Обратного перехода нет, дату здесь не смотрят.
export class ThemeWindow {
  private constructor(readonly phase: WindowPhase) {}

  static closed(): ThemeWindow {
    return new ThemeWindow('закрыта')
  }

  static from(phase: string): ThemeWindow {
    if (!isPhase(phase)) {
      throw new DomainError('Неизвестная фаза окна темы', 'internal')
    }
    return new ThemeWindow(phase)
  }

  open(): ThemeWindow {
    if (this.phase !== 'закрыта') {
      throw new DomainError('Окно темы нельзя открыть из текущей фазы', 'conflict')
    }
    return new ThemeWindow('открыта')
  }

  end(): ThemeWindow {
    if (this.phase !== 'открыта') {
      throw new DomainError('Неделю темы нельзя закончить из текущей фазы', 'conflict')
    }
    return new ThemeWindow('закончилась')
  }

  assertAcceptsWork(): void {
    if (this.phase === 'открыта') return
    if (this.phase === 'закончилась') {
      throw new DomainError('Неделя темы закончилась, пересдачи нет', 'conflict')
    }
    throw new DomainError('Окно темы закрыто', 'conflict')
  }
}
