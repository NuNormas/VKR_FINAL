import { DomainError } from './errors.js'
import type { Role } from './identity.js'

export interface GroupRow {
  login: string
  password: string
  displayName: string
  role: Role
}

const LOGIN = /^[a-z0-9._-]{3,40}$/i
const HEADERS: Record<string, 'login' | 'password' | 'name' | 'role'> = {
  логин: 'login',
  login: 'login',
  пароль: 'password',
  password: 'password',
  имя: 'name',
  name: 'name',
  фио: 'name',
  роль: 'role',
  role: 'role',
}

export function parseGroupCsv(csv: string): GroupRow[] {
  const source = csv.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
  if (!source) throw new DomainError('Файл группы пуст', 'bad_request')
  const lines = source.split('\n').filter((line) => line.trim().length > 0)
  const delimiter = delimiterOf(lines[0] ?? '')
  const header = splitCsv(lines[0] ?? '', delimiter).map((cell) => cell.trim().toLowerCase())
  const columns = header.map((cell) => HEADERS[cell])
  if (!columns.includes('login') || !columns.includes('password') || !columns.includes('name')) {
    throw new DomainError('В заголовке нужны логин, пароль и имя', 'bad_request')
  }
  const rows = lines.slice(1).map((line, index) => rowFrom(splitCsv(line, delimiter), columns, index + 2))
  if (rows.length === 0) throw new DomainError('В файле нет людей', 'bad_request')
  if (rows.length > 200) throw new DomainError('В файле не больше 200 человек', 'bad_request')
  const seen = new Set<string>()
  for (const row of rows) {
    if (seen.has(row.login)) throw new DomainError('Логин повторяется в файле', 'bad_request')
    seen.add(row.login)
  }
  return rows
}

function delimiterOf(header: string): ',' | ';' {
  return header.split(';').length > header.split(',').length ? ';' : ','
}

function rowFrom(cells: string[], columns: (('login' | 'password' | 'name' | 'role') | undefined)[], line: number): GroupRow {
  const value = (key: 'login' | 'password' | 'name' | 'role') => {
    const index = columns.indexOf(key)
    return index === -1 ? '' : (cells[index] ?? '').trim()
  }
  const login = value('login').normalize('NFC')
  if (!LOGIN.test(login)) throw new DomainError(`Строка ${line}: логин из 3–40 знаков`, 'bad_request')
  const password = value('password')
  if (password.length < 8 || password.length > 200) {
    throw new DomainError(`Строка ${line}: пароль от 8 до 200 знаков`, 'bad_request')
  }
  const displayName = value('name').normalize('NFC')
  if (displayName.length < 1 || displayName.length > 80) {
    throw new DomainError(`Строка ${line}: имя от 1 до 80 знаков`, 'bad_request')
  }
  return { login, password, displayName, role: roleOf(value('role'), line) }
}

function roleOf(value: string, line: number): Role {
  const role = value.normalize('NFC').toLowerCase()
  if (role === '' || role === 'студент') return 'студент'
  if (role === 'ассистент') return 'ассистент'
  if (role === 'автор' || role === 'автор заданий') return 'автор заданий'
  if (role === 'преподаватель') return 'преподаватель'
  throw new DomainError(`Строка ${line}: неизвестная роль`, 'bad_request')
}

function splitCsv(line: string, delimiter: ',' | ';'): string[] {
  const cells: string[] = []
  let current = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (char === delimiter && !quoted) {
      cells.push(current)
      current = ''
    } else {
      current += char
    }
  }
  if (quoted) throw new DomainError('В файле не закрыта кавычка', 'bad_request')
  cells.push(current)
  return cells
}
