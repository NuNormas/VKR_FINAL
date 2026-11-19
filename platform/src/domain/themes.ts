import { DomainError } from './errors.js'

export const THEMES = [
  { key: 'intro', name: 'Введение в кибербезопасность' },
  { key: 'crypto', name: 'Основы современной криптографии и методов защиты информации' },
  { key: 'access', name: 'Механизмы авторизации, аутентификации и контроля доступа' },
  { key: 'web', name: 'Классические клиентские и серверные уязвимости' },
  { key: 'web-advanced', name: 'Продвинутые методы атаки и защиты веб-приложений' },
  { key: 'owasp', name: 'Принципы безопасной разработки ПО по OWASP' },
  { key: 'review', name: 'Код-ревью и анализ рисков информационной безопасности' },
  { key: 'devsecops', name: 'Безопасное развертывание и мониторинг (методология DevSecOps)' },
] as const

export type ThemeKey = (typeof THEMES)[number]['key']

export interface Theme {
  key: ThemeKey
  name: string
}

export function themeByKey(key: string): Theme | undefined {
  return THEMES.find((theme) => theme.key === key)
}

export function requireTheme(key: string): Theme {
  const theme = themeByKey(key)
  if (!theme) {
    throw new DomainError('Тема не найдена', 'not_found')
  }
  return theme
}
