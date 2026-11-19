import type { FastifyInstance, FastifyRequest } from 'fastify'
import { AccountService } from '../domain/accounts.js'
import { AuthoredTaskService } from '../domain/authored.js'
import { DomainError } from '../domain/errors.js'
import type { AuthUser } from '../domain/identity.js'
import { canOpenOral } from '../domain/identity.js'
import { OralSessionService } from '../domain/oral.js'
import { SubmissionFacade } from '../domain/submission-facade.js'
import { ThemeAssessment } from '../domain/theme-assessment.js'
import { ActivityService } from '../domain/activity.js'
import { SolutionService } from '../domain/solutions.js'
import { TeacherTaskService } from '../domain/teacher-task.js'
import { ThemeWindowService } from '../domain/theme-window-service.js'
import { THEMES } from '../domain/themes.js'
import type { AuthoredTask, PostgresPassportRepository } from '../repository/accounts.js'
import type { AttemptRepository, IncidentRepository, TeamRepository } from '../repository/interfaces.js'

declare module 'fastify' {
  interface FastifyRequest {
    authUser: AuthUser | null
  }
}

function isValidationError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'validation' in error && Boolean(error.validation)
}

const STATUS: Record<DomainError['code'], number> = {
  not_found: 404,
  conflict: 409,
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  internal: 500,
}

export interface AppServices {
  accounts: AccountService
  teams: TeamRepository
  windows: ThemeWindowService
  submissions: SubmissionFacade
  assessment: ThemeAssessment
  incidents: IncidentRepository
  attempts: AttemptRepository
  passports: PostgresPassportRepository
  oral: OralSessionService
  authored: AuthoredTaskService
  teacherTasks: TeacherTaskService
  solutions: SolutionService
  activity: ActivityService
}

export function registerRoutes(app: FastifyInstance, services: AppServices): void {
  app.decorateRequest('authUser', null)

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof DomainError) {
      return reply.status(STATUS[error.code]).send({ error: error.message })
    }
    if (isValidationError(error)) {
      return reply.status(400).send({ error: 'Некорректный запрос' })
    }
    request.log.error({ err: error }, 'request failed')
    return reply.status(500).send({ error: 'Внутренняя ошибка' })
  })

  app.addHook('onRequest', async (request) => {
    const path = request.url.split('?')[0] ?? '/'
    if (path === '/health' || path === '/api/login' || !path.startsWith('/api')) return
    const header = request.headers.authorization
    if (!header?.startsWith('Bearer ')) throw new DomainError('Нужен вход', 'unauthorized')
    request.authUser = await services.accounts.authenticate(header.slice('Bearer '.length).trim())
  })

  app.get('/health', async () => {
    await app.pool.query('SELECT 1')
    return { status: 'ok' }
  })

  app.post<{ Body: { login: string; password: string } }>('/api/login', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['login', 'password'],
        properties: {
          login: { type: 'string', minLength: 1, maxLength: 40 },
          password: { type: 'string', minLength: 1, maxLength: 200 },
        },
      },
    },
  }, async (request) => {
    const session = await services.accounts.login(request.body.login, request.body.password)
    return { token: session.token, role: session.user.role, displayName: session.user.displayName }
  })

  app.post<{
    Body: { login: string; password: string; role: string; displayName: string }
  }>('/api/users', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['login', 'password', 'role', 'displayName'],
        properties: {
          login: { type: 'string', minLength: 1, maxLength: 40 },
          password: { type: 'string', minLength: 1, maxLength: 200 },
          role: { type: 'string', minLength: 1, maxLength: 40 },
          displayName: { type: 'string', minLength: 1, maxLength: 80 },
        },
      },
    },
  }, async (request, reply) => {
    const user = await services.accounts.createUser(teacher(request), request.body)
    return reply.status(201).send({
      id: user.id,
      login: user.login,
      role: user.role,
      displayName: user.displayName,
    })
  })

  app.post<{ Body: { csv: string } }>('/api/groups', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['csv'],
        properties: { csv: { type: 'string', minLength: 1, maxLength: 100000 } },
      },
    },
  }, async (request, reply) => {
    const imported = await services.accounts.importGroup(teacher(request), request.body.csv)
    return reply.status(201).send({
      count: imported.count,
      users: imported.users.map((person) => ({
        id: person.id,
        login: person.login,
        role: person.role,
        displayName: person.displayName,
      })),
    })
  })

  app.get('/api/themes', async () => {
    return { themes: THEMES.map((theme) => ({ key: theme.key, name: theme.name })) }
  })

  app.get('/api/tasks', async () => {
    const tasks = await services.passports.list()
    return {
      tasks: tasks.map((task) => {
        const theme = THEMES.find((item) => item.key === task.themeKey)
        return {
          id: task.id,
          work: task.work,
          title: task.title,
          theme: theme?.name,
          competency: task.competency,
          mode: task.mode,
          format: task.format,
          level: task.level,
          checker: task.checkerKind,
        }
      }),
    }
  })

  app.post<{ Body: { name: string; memberLogins: string[] } }>('/api/teams', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'memberLogins'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 200 },
          memberLogins: {
            type: 'array',
            minItems: 1,
            maxItems: 4,
            items: { type: 'string', minLength: 1, maxLength: 40 },
          },
        },
      },
    },
  }, async (request, reply) => {
    const actor = user(request)
    const members = await services.accounts.membersByLogins(actor, request.body.memberLogins)
    const team = await services.teams.create({
      name: request.body.name,
      members: members.map((member) => ({ userId: member.id, displayName: member.displayName })),
    })
    return reply.status(201).send(team)
  })

  app.get<{ Params: { id: string } }>('/api/teams/:id', async (request) => {
    await assertCanReadTeam(services.teams, user(request), request.params.id)
    const team = await services.teams.findById(request.params.id)
    if (!team) throw new DomainError('Команда не найдена', 'not_found')
    return team
  })

  app.get<{ Params: { themeKey: string } }>('/api/themes/:themeKey/window', async (request) => {
    const window = await services.windows.get(request.params.themeKey)
    return { themeKey: request.params.themeKey, phase: window.phase }
  })

  app.post<{ Params: { themeKey: string }; Body: { action: 'открыть' | 'закончить' } }>(
    '/api/themes/:themeKey/window',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['action'],
          properties: {
            action: { type: 'string', enum: ['открыть', 'закончить'] },
          },
        },
      },
    },
    async (request) => {
      teacher(request)
      const window = await services.windows.transition(request.params.themeKey, request.body.action)
      return { themeKey: request.params.themeKey, phase: window.phase }
    },
  )

  app.post<{ Body: { themeKey: string; level: string; minutes: number } }>('/api/oral-sessions', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['themeKey', 'level', 'minutes'],
        properties: {
          themeKey: { type: 'string', minLength: 1, maxLength: 40 },
          level: { type: 'string', minLength: 1, maxLength: 20 },
          minutes: { type: 'integer', minimum: 10, maximum: 20 },
        },
      },
    },
  }, async (request, reply) => {
    const actor = user(request)
    if (!canOpenOral(actor.role)) throw new DomainError('Сессию открывает ассистент', 'forbidden')
    const session = await services.oral.open(request.body)
    return reply.status(201).send(session)
  })

  app.post<{ Body: { code: string } }>('/api/oral-sessions/join', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['code'],
        properties: { code: { type: 'string', minLength: 1, maxLength: 20 } },
      },
    },
  }, async (request) => {
    const actor = user(request)
    if (actor.role !== 'студент') throw new DomainError('Сессию проходит студент', 'forbidden')
    const session = await services.oral.join(request.body.code, actor.id)
    return { themeKey: session.themeKey, level: session.level, minutes: session.minutes, expiresAt: session.expiresAt }
  })

  app.post<{ Params: { taskId: string }; Body: { teamId: string } }>(
    '/api/tasks/:taskId/open',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['teamId'],
          properties: { teamId: { type: 'string', minLength: 1 } },
        },
      },
    },
    async (request) => {
      return services.submissions.openTask(user(request).id, request.body.teamId, request.params.taskId)
    },
  )

  app.post<{ Params: { taskId: string }; Body: { teamId: string; answer: string } }>(
    '/api/tasks/:taskId/submissions',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['teamId', 'answer'],
          properties: {
            teamId: { type: 'string', minLength: 1 },
            answer: { type: 'string', minLength: 1, maxLength: 8000 },
          },
        },
      },
    },
    async (request) => {
      return services.submissions.submit(
        user(request).id,
        request.body.teamId,
        request.params.taskId,
        request.body.answer,
      )
    },
  )

  app.get<{ Params: { themeKey: string }; Querystring: { teamId?: string } }>(
    '/api/themes/:themeKey/grade',
    async (request) => {
      const teamId = request.query.teamId
      if (!teamId) throw new DomainError('Нужен teamId', 'bad_request')
      await assertCanReadTeam(services.teams, user(request), teamId)
      return services.assessment.assess(teamId, request.params.themeKey)
    },
  )

  app.post<{ Params: { id: string } }>('/api/solutions/:id/correct-path', async (request) => {
    return services.assessment.markCorrectPath(user(request), request.params.id)
  })

  app.get('/api/incidents', async (request) => {
    teacher(request)
    return { incidents: await services.incidents.list() }
  })

  app.get('/api/artifacts', async (request) => {
    teacher(request)
    return { artifacts: await services.attempts.listArtifacts() }
  })

  app.post<{
    Body: {
      title: string
      description: string
      flag: string
      instruction: string
      license: string
      link?: string
      fileName?: string
      fileText?: string
    }
  }>('/api/authored-tasks', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'description', 'flag', 'instruction', 'license'],
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 120 },
          description: { type: 'string', minLength: 1, maxLength: 4000 },
          flag: { type: 'string', minLength: 1, maxLength: 80 },
          instruction: { type: 'string', minLength: 1, maxLength: 4000 },
          license: { type: 'string', minLength: 1, maxLength: 80 },
          link: { type: 'string', maxLength: 300 },
          fileName: { type: 'string', maxLength: 80 },
          fileText: { type: 'string', maxLength: 20000 },
        },
      },
    },
  }, async (request, reply) => {
    const saved = await services.authored.submit(user(request), request.body)
    return reply.status(201).send(detail(saved))
  })

  app.get('/api/authored-tasks', async (request) => {
    const tasks = await services.authored.list(user(request))
    return { tasks: tasks.map(summary) }
  })

  app.get<{ Params: { id: string } }>('/api/authored-tasks/:id', async (request) => {
    return detail(await services.authored.read(user(request), request.params.id))
  })

  app.post<{
    Body: {
      title: string
      themeKey: string
      competency: string
      mode: string
      level: string
      statement: string
      checker: string
      secret?: string
      mustHave?: string[]
      mustNot?: string[]
      attemptLimit?: number
      hints?: string[]
    }
  }>('/api/teacher-tasks', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'themeKey', 'competency', 'mode', 'level', 'statement', 'checker'],
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 120 },
          themeKey: { type: 'string', minLength: 1, maxLength: 40 },
          competency: { type: 'string', minLength: 1, maxLength: 300 },
          mode: { type: 'string', enum: ['тренажёр', 'очное'] },
          level: { type: 'string', enum: ['простое', 'среднее', 'сложное'] },
          statement: { type: 'string', minLength: 1, maxLength: 4000 },
          checker: { type: 'string', enum: ['флаг', 'строка', 'патч'] },
          secret: { type: 'string', maxLength: 500 },
          mustHave: { type: 'array', maxItems: 12, items: { type: 'string', minLength: 1, maxLength: 120 } },
          mustNot: { type: 'array', maxItems: 12, items: { type: 'string', minLength: 1, maxLength: 120 } },
          attemptLimit: { type: 'integer', minimum: 1, maximum: 50 },
          hints: { type: 'array', maxItems: 3, items: { type: 'string', minLength: 1, maxLength: 500 } },
        },
      },
    },
  }, async (request, reply) => {
    const created = await services.teacherTasks.create(user(request), request.body)
    return reply.status(201).send(created)
  })

  app.get<{ Querystring: { teamId?: string } }>('/api/teacher-tasks', async (request) => {
    const tasks = await services.teacherTasks.list(user(request), request.query.teamId)
    return { tasks }
  })

  app.get<{ Params: { id: string }; Querystring: { teamId?: string } }>('/api/teacher-tasks/:id', async (request) => {
    return services.teacherTasks.read(user(request), request.params.id, request.query.teamId)
  })

  app.post<{ Params: { id: string }; Body: { teamId: string; answer: string } }>(
    '/api/teacher-tasks/:id/submissions',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['teamId', 'answer'],
          properties: {
            teamId: { type: 'string', minLength: 1 },
            answer: { type: 'string', minLength: 1, maxLength: 8000 },
          },
        },
      },
    },
    async (request) => {
      return services.teacherTasks.submit(
        user(request),
        request.params.id,
        request.body.teamId,
        request.body.answer,
      )
    },
  )

  app.get<{ Querystring: { teamId?: string } }>('/api/activity', async (request) => {
    return { events: await services.activity.list(user(request), request.query.teamId) }
  })

  app.get<{ Params: { taskId: string }; Querystring: { teamId?: string } }>(
    '/api/tasks/:taskId/hints',
    async (request) => {
      const teamId = request.query.teamId
      if (!teamId) throw new DomainError('Нужна команда', 'bad_request')
      return services.activity.hints(user(request), request.params.taskId, teamId)
    },
  )

  app.post<{ Params: { taskId: string }; Body: { teamId: string } }>(
    '/api/tasks/:taskId/hints',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['teamId'],
          properties: { teamId: { type: 'string', minLength: 1 } },
        },
      },
    },
    async (request) => {
      return services.activity.openHint(user(request), request.params.taskId, request.body.teamId)
    },
  )

  app.get('/api/solutions', async (request) => {
    return { solutions: await services.solutions.list(user(request)) }
  })

  app.get<{ Params: { id: string } }>('/api/solutions/:id', async (request) => {
    return services.solutions.read(user(request), request.params.id)
  })
}

function user(request: FastifyRequest): AuthUser {
  if (!request.authUser) throw new DomainError('Нужен вход', 'unauthorized')
  return request.authUser
}

function teacher(request: FastifyRequest): AuthUser {
  const actor = user(request)
  if (actor.role !== 'преподаватель') {
    throw new DomainError('Это действие доступно преподавателю', 'forbidden')
  }
  return actor
}

async function assertCanReadTeam(teams: TeamRepository, actor: AuthUser, teamId: string): Promise<void> {
  if (actor.role === 'преподаватель') return
  if (!(await teams.hasMember(teamId, actor.id))) {
    throw new DomainError('Чужой результат недоступен', 'forbidden')
  }
}

function summary(task: AuthoredTask) {
  return {
    id: task.id,
    title: task.title,
    license: task.license,
    link: task.link,
    fileName: task.fileName,
    authorName: task.authorName,
    createdAt: task.createdAt,
  }
}

function detail(task: AuthoredTask) {
  return {
    ...summary(task),
    description: task.description,
    flag: task.flag,
    instruction: task.instruction,
    fileText: task.fileText,
  }
}
