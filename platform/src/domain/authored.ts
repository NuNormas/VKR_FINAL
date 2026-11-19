import { DomainError } from './errors.js'
import type { AuthUser } from './identity.js'
import type { AuthoredTask, PostgresAuthoredTaskRepository } from '../repository/accounts.js'

const FLAG = /^HITS\{[A-Za-z0-9_-]{4,64}\}$/

export interface AuthoredInput {
  title: string
  description: string
  flag: string
  instruction: string
  license: string
  link?: string
  fileName?: string
  fileText?: string
}

export class AuthoredTaskService {
  constructor(private readonly tasks: PostgresAuthoredTaskRepository) {}

  async submit(author: AuthUser, input: AuthoredInput): Promise<AuthoredTask> {
    const title = required(input.title, 'Название', 120)
    const description = required(input.description, 'Описание', 4000)
    const instruction = required(input.instruction, 'Инструкция', 4000)
    const license = required(input.license, 'Лицензия', 80)
    const flag = input.flag.normalize('NFC').trim()
    if (!FLAG.test(flag)) throw new DomainError('Флаг должен быть вида HITS{...}', 'bad_request')
    const link = optional(input.link)
    const fileName = optional(input.fileName)
    const fileText = optional(input.fileText)
    const hasLink = link !== null
    const hasFile = fileName !== null || fileText !== null
    if (hasLink === hasFile) {
      throw new DomainError('Нужна ссылка или файл, что-то одно', 'bad_request')
    }
    if (hasLink) {
      if (!/^https?:\/\/\S{1,280}$/.test(link)) throw new DomainError('Ссылка должна начинаться с http:// или https://', 'bad_request')
    }
    if (fileName === null || fileText === null) {
      if (hasFile) throw new DomainError('У файла нужны имя и текст', 'bad_request')
    }
    const safeName = hasFile ? cleanFileName(fileName!) : null
    const body = hasFile ? fileText : null
    if (body && body.length > 20_000) throw new DomainError('Файл длиннее 20000 знаков', 'bad_request')
    return this.tasks.insert({
      authorUserId: author.id,
      title,
      description,
      flag,
      instruction,
      license,
      link: hasLink ? link : null,
      fileName: safeName,
      fileText: body,
    })
  }

  async list(actor: AuthUser): Promise<AuthoredTask[]> {
    if (actor.role === 'преподаватель') return this.tasks.list()
    return this.tasks.listByAuthor(actor.id)
  }

  async read(actor: AuthUser, id: string): Promise<AuthoredTask> {
    const task = await this.tasks.findById(id)
    if (!task || (actor.role !== 'преподаватель' && task.authorUserId !== actor.id)) {
      throw new DomainError('Задача не найдена', 'not_found')
    }
    return task
  }
}

function required(value: string, label: string, max: number): string {
  const text = value.normalize('NFC').trim()
  if (text.length < 1 || text.length > max) {
    throw new DomainError(`${label}: от 1 до ${max} знаков`, 'bad_request')
  }
  return text
}

function optional(value: string | undefined): string | null {
  if (value === undefined) return null
  const text = value.normalize('NFC').trim()
  return text.length === 0 ? null : text
}

function cleanFileName(name: string): string {
  if (name.length > 80 || name.includes('/') || name.includes('\\') || name.includes('..')) {
    throw new DomainError('Имя файла без пути, до 80 знаков', 'bad_request')
  }
  return name
}
