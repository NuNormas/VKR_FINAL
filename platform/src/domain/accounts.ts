import { DomainError } from './errors.js'
import type { AuthUser, Role } from './identity.js'
import { isRole } from './identity.js'
import { parseGroupCsv } from './group-csv.js'
import { hashPassword, verifyPassword } from './passwords.js'
import type { PostgresAuthSessionRepository, PostgresUserRepository } from '../repository/accounts.js'

const LOGIN = /^[a-z0-9._-]{3,40}$/i

export class AccountService {
  constructor(
    private readonly users: PostgresUserRepository,
    private readonly sessions: PostgresAuthSessionRepository,
    private readonly passwordCost: number,
  ) {}

  async ensureTeacher(input: { login: string; password: string; displayName: string }): Promise<void> {
    const login = normalizeLogin(input.login)
    const existing = await this.users.findByLogin(login)
    if (existing) return
    await this.users.insert({
      login,
      passwordHash: await hashPassword(input.password, this.passwordCost),
      role: 'преподаватель',
      displayName: cleanName(input.displayName),
    })
  }

  async createUser(
    actor: AuthUser,
    input: { login: string; password: string; role: string; displayName: string },
  ): Promise<AuthUser> {
    if (actor.role !== 'преподаватель') {
      throw new DomainError('Это действие доступно преподавателю', 'forbidden')
    }
    if (!isRole(input.role)) throw new DomainError('Неизвестная роль', 'bad_request')
    if (input.password.length < 8 || input.password.length > 200) {
      throw new DomainError('Пароль должен быть от 8 до 200 знаков', 'bad_request')
    }
    const role: Role = input.role
    return this.users.insert({
      login: normalizeLogin(input.login),
      passwordHash: await hashPassword(input.password, this.passwordCost),
      role,
      displayName: cleanName(input.displayName),
    })
  }

  async importGroup(actor: AuthUser, csv: string): Promise<{ count: number; users: AuthUser[] }> {
    if (actor.role !== 'преподаватель') {
      throw new DomainError('Группу загружает преподаватель', 'forbidden')
    }
    const rows = parseGroupCsv(csv)
    const users = await this.users.insertMany(
      await Promise.all(
        rows.map(async (row) => ({
          login: row.login,
          passwordHash: await hashPassword(row.password, this.passwordCost),
          role: row.role,
          displayName: row.displayName,
        })),
      ),
    )
    return { count: users.length, users }
  }

  async login(login: string, password: string): Promise<{ token: string; user: AuthUser }> {
    const user = await this.users.findByLogin(login.trim().normalize('NFC'))
    const matches = user ? await verifyPassword(password, user.passwordHash) : false
    if (!user || !matches) throw new DomainError('Неверный логин или пароль', 'unauthorized')
    const token = await this.sessions.create(user.id)
    return {
      token,
      user: { id: user.id, login: user.login, role: user.role, displayName: user.displayName },
    }
  }

  async authenticate(token: string): Promise<AuthUser> {
    const user = await this.sessions.findUser(token)
    if (!user) throw new DomainError('Нужен вход', 'unauthorized')
    return user
  }

  async membersByLogins(actor: AuthUser, logins: string[]): Promise<AuthUser[]> {
    const unique = [...new Set(logins.map((login) => login.trim().normalize('NFC')))]
    if (unique.length !== logins.length) throw new DomainError('Участник указан дважды', 'bad_request')
    const found = await this.users.findByLogins(unique)
    if (found.length !== unique.length) throw new DomainError('Участник не найден', 'not_found')
    const byLogin = new Map(found.map((user) => [user.login, user]))
    const members = unique.map((login) => byLogin.get(login)!)
    if (members.some((member) => member.role !== 'студент')) {
      throw new DomainError('В команду входят только студенты', 'bad_request')
    }
    if (actor.role === 'студент' && !members.some((member) => member.id === actor.id)) {
      throw new DomainError('Студент собирает только свою команду', 'forbidden')
    }
    return members
  }
}

function normalizeLogin(login: string): string {
  const value = login.trim().normalize('NFC')
  if (!LOGIN.test(value)) throw new DomainError('Логин: 3–40 знаков, латиница, цифры, точка, _ или -', 'bad_request')
  return value
}

function cleanName(name: string): string {
  const value = name.trim().normalize('NFC')
  if (value.length < 1 || value.length > 80) {
    throw new DomainError('Имя должно быть от 1 до 80 знаков', 'bad_request')
  }
  return value
}
