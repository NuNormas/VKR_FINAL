import type { ThemeWindowRepository } from '../repository/interfaces.js'
import { requireTheme } from './themes.js'
import { ThemeWindow } from './theme-window.js'

export class ThemeWindowService {
  constructor(private readonly windows: ThemeWindowRepository) {}

  async get(themeKey: string): Promise<ThemeWindow> {
    requireTheme(themeKey)
    return this.windows.get(themeKey)
  }

  async transition(themeKey: string, action: 'открыть' | 'закончить'): Promise<ThemeWindow> {
    requireTheme(themeKey)
    const current = await this.windows.get(themeKey)
    const next = action === 'открыть' ? current.open() : current.end()
    await this.windows.save(themeKey, next)
    return next
  }
}
