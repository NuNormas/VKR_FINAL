import type { CheckerKind } from './checker.js'
import { DomainError } from './errors.js'
import { THEMES, type ThemeKey } from './themes.js'

export type TaskMode = 'тренажёр' | 'очное'
export type TaskFormat = 'командное' | 'индивидуальное'
export type TaskLevel = 'простое' | 'среднее' | 'сложное'

export interface TaskDefinition {
  id: string
  work: number
  themeKey: ThemeKey
  title: string
  competency: string
  mode: TaskMode
  format: TaskFormat
  level: TaskLevel
  generatorId: string
  checkerKind: CheckerKind
}

function task(
  id: string,
  work: number,
  themeKey: ThemeKey,
  title: string,
  competency: string,
  mode: TaskMode,
  level: TaskLevel,
  generatorId: string,
  checkerKind: CheckerKind,
): TaskDefinition {
  return {
    id,
    work,
    themeKey,
    title,
    competency,
    mode,
    format: work === 8 ? 'индивидуальное' : 'командное',
    level,
    generatorId,
    checkerKind,
  }
}

// Восемь работ. Лимит команды задан на тему: у DevSecOps ровно один человек, у остальных до четырёх.
// Авторская задача Jeopardy в эти восемь работ не входит.
export const TASKS: readonly TaskDefinition[] = [
  task('intro-protocol', 1, 'intro', 'Протокол и след', 'Собирает флаг по следу из полей протокола', 'тренажёр', 'простое', 'intro-protocol', 'string'),
  task('intro-trace', 1, 'intro', 'Запись обмена', 'Собирает флаг по телу нужной реплики', 'тренажёр', 'простое', 'intro-trace', 'string'),
  task('intro-headers', 1, 'intro', 'Заголовки запроса', 'Собирает флаг по заголовкам запроса', 'очное', 'простое', 'intro-headers', 'string'),

  task('crypto-caesar', 2, 'crypto', 'Классический шифр Цезаря', 'Читает текст классического шифра', 'тренажёр', 'простое', 'caesar', 'string'),
  task('crypto-xor', 2, 'crypto', 'Повтор ключа', 'Восстанавливает текст при повторе ключа', 'тренажёр', 'среднее', 'xor-repeat', 'string'),
  task('crypto-ecb', 2, 'crypto', 'Картинка из блоков ECB', 'Читает текст по повторяющимся блокам', 'тренажёр', 'среднее', 'ecb-sample', 'string'),
  task('crypto-rsa', 2, 'crypto', 'RSA с малой экспонентой', 'Восстанавливает текст RSA с малой экспонентой', 'тренажёр', 'сложное', 'rsa-small-e', 'string'),
  task('crypto-pad', 2, 'crypto', 'Дополнение PKCS#7', 'Снимает дополнение и читает текст', 'тренажёр', 'сложное', 'pkcs7-pad', 'string'),
  task('crypto-jwt', 2, 'crypto', 'JWT со слабым секретом', 'Собирает токен со слабым секретом', 'тренажёр', 'сложное', 'jwt-weak', 'string'),
  task('crypto-ecb-oral', 2, 'crypto', 'Cookie в режиме ECB', 'Читает cookie по повторяющимся блокам', 'очное', 'среднее', 'ecb-cookie', 'string'),
  task('crypto-rsa-oral', 2, 'crypto', 'Общий модуль RSA', 'Восстанавливает целое RSA с общим модулем', 'очное', 'сложное', 'rsa-common', 'string'),

  task('auth-reset', 3, 'access', 'Токен сброса', 'Достаёт флаг из предсказуемого токена сброса', 'тренажёр', 'среднее', 'auth-reset', 'stand-flag'),
  task('auth-session', 3, 'access', 'Сессия из журнала', 'Достаёт флаг из сессии, собранной по журналу', 'тренажёр', 'среднее', 'auth-session', 'stand-flag'),
  task('auth-path', 3, 'access', 'Обход проверки пути', 'Находит путь, который обходит проверку регистра', 'очное', 'среднее', 'auth-path', 'behavior'),

  task('web-sqli', 4, 'web', 'Стенд входа', 'Достаёт флаг из сервиса, где имя склеивается с запросом', 'тренажёр', 'простое', 'web-sqli', 'stand-flag'),
  task('web-xss', 4, 'web', 'Стенд приветствия', 'Достаёт флаг из сервиса, где имя попадает в разметку', 'тренажёр', 'простое', 'web-xss', 'stand-flag'),
  task('web-csrf', 4, 'web', 'Стенд смены почты', 'Достаёт флаг из сервиса без секрета запроса', 'тренажёр', 'среднее', 'web-csrf', 'stand-flag'),
  task('web-idor', 4, 'web', 'Стенд карточек', 'Достаёт флаг из чужой карточки по номеру', 'тренажёр', 'среднее', 'web-idor', 'stand-flag'),
  task('web-traversal', 4, 'web', 'Стенд документов', 'Достаёт флаг из файла вне каталога документов', 'тренажёр', 'среднее', 'web-traversal', 'stand-flag'),
  task('web-sqli-oral', 4, 'web', 'Стенд поиска заказов', 'Достаёт флаг из поиска, где текст склеивается с запросом', 'очное', 'среднее', 'web-sqli-oral', 'stand-flag'),

  task('web-ssrf', 5, 'web-advanced', 'Стенд превью', 'Достаёт флаг через сервис, который сам забирает адрес', 'тренажёр', 'сложное', 'web-ssrf', 'stand-flag'),
  task('web-deser', 5, 'web-advanced', 'Стенд сессии из байтов', 'Достаёт флаг из объекта, собранного из присланных байтов', 'тренажёр', 'сложное', 'web-deser', 'stand-flag'),
  task('web-command', 5, 'web-advanced', 'Стенд отчётов', 'Достаёт флаг через подстановку в вызов программы', 'тренажёр', 'сложное', 'web-command', 'stand-flag'),
  task('web-ssrf-oral', 5, 'web-advanced', 'Стенд аватаров', 'Достаёт флаг через сервис, который сам забирает адрес картинки', 'очное', 'сложное', 'web-ssrf-oral', 'stand-flag'),

  task('owasp-query', 6, 'owasp', 'Склейка запроса', 'Исправляет склейку так, что кавычка не меняет выборку', 'тренажёр', 'среднее', 'owasp-query', 'behavior'),
  task('owasp-render', 6, 'owasp', 'Сборка страницы', 'Исправляет сборку так, что знаки текста не становятся разметкой', 'очное', 'среднее', 'owasp-render', 'behavior'),

  task('review-code', 7, 'review', 'Чужая запись', 'Исправляет выдачу чужой записи', 'тренажёр', 'среднее', 'review-code', 'behavior'),
  task('review-config', 7, 'review', 'Листинг каталога', 'Выключает листинг, сохраняя сервис и корень', 'тренажёр', 'простое', 'review-config', 'behavior'),
  task('review-doc', 7, 'review', 'Чужой документ', 'Исправляет выдачу чужого документа', 'очное', 'среднее', 'review-doc', 'behavior'),

  task('devsecops-pipeline', 8, 'devsecops', 'Сборка со сканером', 'Правит описание сборки так, что проверка проходит', 'тренажёр', 'среднее', 'devsecops-pipeline', 'behavior'),
  task('devsecops-job', 8, 'devsecops', 'Задание публикации', 'Правит описание публикации так, что проверка проходит', 'очное', 'сложное', 'devsecops-job', 'behavior'),
]

export function teamLimit(themeKey: string): { min: number; max: number } {
  if (themeKey === 'devsecops') return { min: 1, max: 1 }
  return { min: 1, max: 4 }
}

const themeKeys = new Set<string>(THEMES.map((theme) => theme.key))

for (const item of TASKS) {
  if (!themeKeys.has(item.themeKey)) {
    throw new Error(`Задание ${item.id} ссылается на неизвестную тему`)
  }
}

for (const theme of THEMES) {
  const home = TASKS.some((item) => item.themeKey === theme.key && item.mode === 'тренажёр')
  const oral = TASKS.some((item) => item.themeKey === theme.key && item.mode === 'очное')
  if (!home || !oral) throw new Error(`У темы ${theme.key} нет домашней или очной пары`)
}

export function taskById(id: string): TaskDefinition | undefined {
  return TASKS.find((item) => item.id === id)
}

export function requireTask(id: string): TaskDefinition {
  const found = taskById(id)
  if (!found) throw new DomainError('Задание не найдено', 'not_found')
  return found
}

export function trainerTaskIds(themeKey: string): string[] {
  return TASKS.filter((item) => item.themeKey === themeKey && item.mode === 'тренажёр').map(
    (item) => item.id,
  )
}
