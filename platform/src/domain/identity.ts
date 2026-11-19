export type Role = 'студент' | 'ассистент' | 'автор заданий' | 'преподаватель'

export interface AuthUser {
  id: string
  login: string
  role: Role
  displayName: string
}

const ROLES: readonly Role[] = ['студент', 'ассистент', 'автор заданий', 'преподаватель']

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value)
}

export function canOpenOral(role: Role): boolean {
  return role === 'ассистент' || role === 'преподаватель'
}

export function canAuthorTask(role: Role): boolean {
  return role === 'автор заданий' || role === 'преподаватель'
}
