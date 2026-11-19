export type Role = 'студент' | 'ассистент' | 'автор заданий' | 'преподаватель'

export interface Session {
  token: string
  role: Role
  displayName: string
  login: string
  teamId?: string
}

export interface Theme {
  key: string
  name: string
  phase?: string
}

export interface TaskCard {
  id: string
  title: string
  theme?: string
  competency: string
  mode: 'тренажёр' | 'очное'
  level: string
  checker: string
}

export interface OpenedTask {
  taskId: string
  condition: {
    statement: string
    ciphertext?: string
    standLabel?: string
    standUrl?: string
  }
}

export interface AuthoredSummary {
  id: string
  title: string
  license: string
  link: string | null
  fileName: string | null
  authorName: string
}

export interface SolutionSummary {
  id: string
  who: string
  teamName: string
  taskId: string
  taskTitle: string
  verdict: 'зачтено' | 'не зачтено' | 'на проверке у преподавателя'
  submittedAt: string
}

export interface SolutionDetail extends SolutionSummary {
  answer: string | null
}

export interface TeacherTaskSummary {
  id: string
  title: string
  theme: string
  themeKey: string
  competency: string
  mode: 'тренажёр' | 'очное'
  level: string
  checker: 'флаг' | 'строка' | 'патч'
  statement: string | null
  verdict?: 'зачтено' | 'не зачтено' | null
}

export interface TeacherTaskDetail extends TeacherTaskSummary {
  closed: string | null
  secret?: string
  mustHave?: string[]
  mustNot?: string[]
}

export interface AuthoredDetail extends AuthoredSummary {
  description: string
  flag: string
  instruction: string
  fileText: string | null
}

export class Api {
  constructor(private token: string | null) {}

  async request<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
    const response = await fetch(path, {
      method: init?.method ?? 'GET',
      headers: {
        ...(init?.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    })
    const data = (await response.json().catch(() => ({}))) as { error?: string }
    if (!response.ok) throw new Error(data.error ?? 'Ошибка запроса')
    return data as T
  }
}
