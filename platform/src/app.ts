import Fastify, { type FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { bankGenerators } from './domain/bank.js'
import { BehaviorChecker } from './domain/behavior-checker.js'
import { CheckerRegistry, StandFlagChecker, StringCompareChecker, TeacherChecker } from './domain/checker.js'
import { caesarGenerator } from './domain/caesar.js'
import { GeneratorFactory } from './domain/generator.js'
import { SubmissionFacade } from './domain/submission-facade.js'
import { ThemeAssessment } from './domain/theme-assessment.js'
import { ThemeWindowService } from './domain/theme-window-service.js'
import { AccountService } from './domain/accounts.js'
import { AuthoredTaskService } from './domain/authored.js'
import { OralSessionService } from './domain/oral.js'
import { ActivityService } from './domain/activity.js'
import { SolutionService } from './domain/solutions.js'
import { TeacherTaskService } from './domain/teacher-task.js'
import { ensurePassports } from './db/passports.js'
import { migrate } from './db/migrate.js'
import { DockerStandRuntime, type StandRuntime } from './stands/runtime.js'
import { registerClient } from './http/static.js'
import { registerRoutes } from './http/routes.js'
import {
  PostgresAuthoredTaskRepository,
  PostgresAuthSessionRepository,
  PostgresOralSessionRepository,
  PostgresOralPathRepository,
  PostgresPassportRepository,
  PostgresUserRepository,
} from './repository/accounts.js'
import { PostgresActivityRepository } from './repository/activity.js'
import { PostgresTeacherTaskRepository } from './repository/teacher-tasks.js'
import {
  PostgresAttemptRepository,
  PostgresIncidentRepository,
  PostgresIssueRepository,
  PostgresTeamRepository,
  PostgresThemeWindowRepository,
} from './repository/postgres.js'

declare module 'fastify' {
  interface FastifyInstance {
    pool: Pool
  }
}

export interface BuildAppOptions {
  databaseUrl: string
  logger?: boolean
  passwordCost?: number
  bootstrapTeacher?: { login: string; password: string; displayName: string }
  stands?: StandRuntime
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const pool = new Pool({ connectionString: options.databaseUrl, max: 10 })
  try {
    await migrate(pool)
    await ensurePassports(pool)
  } catch (error) {
    await pool.end()
    throw error
  }

  const teams = new PostgresTeamRepository(pool)
  const windows = new PostgresThemeWindowRepository(pool)
  const issues = new PostgresIssueRepository(pool)
  const attempts = new PostgresAttemptRepository(pool)
  const incidents = new PostgresIncidentRepository(pool)
  const users = new PostgresUserRepository(pool)
  const authSessions = new PostgresAuthSessionRepository(pool)
  const passports = new PostgresPassportRepository(pool)
  const oralSessions = new PostgresOralSessionRepository(pool)
  const authoredTasks = new PostgresAuthoredTaskRepository(pool)
  const accounts = new AccountService(users, authSessions, options.passwordCost ?? 10)
  if (options.bootstrapTeacher) await accounts.ensureTeacher(options.bootstrapTeacher)
  const generators = new GeneratorFactory([caesarGenerator, ...bankGenerators])
  const checkers = new CheckerRegistry([
    new StringCompareChecker(),
    new StandFlagChecker(),
    new TeacherChecker(),
    new BehaviorChecker(),
  ])
  const stands = options.stands ?? new DockerStandRuntime()
  const teacherTaskRepository = new PostgresTeacherTaskRepository(pool)
  const activity = new ActivityService(
    new PostgresActivityRepository(pool),
    teams,
    attempts,
    passports,
    teacherTaskRepository,
    new ThemeWindowService(windows),
    oralSessions,
  )
  const submissions = new SubmissionFacade(
    teams,
    windows,
    issues,
    attempts,
    generators,
    checkers,
    passports,
    oralSessions,
    stands,
    activity,
  )

  const app = Fastify({ logger: options.logger ?? false })
  app.decorate('pool', pool)
  app.addHook('onClose', async () => {
    await pool.end()
  })
  const themeWindows = new ThemeWindowService(windows)
  registerRoutes(app, {
    teams,
    windows: themeWindows,
    submissions,
    assessment: new ThemeAssessment(
      teams,
      attempts,
      passports,
      new PostgresActivityRepository(pool),
      new PostgresOralPathRepository(pool),
    ),
    incidents,
    attempts,
    accounts,
    passports,
    oral: new OralSessionService(oralSessions),
    authored: new AuthoredTaskService(authoredTasks),
    teacherTasks: new TeacherTaskService(
      teacherTaskRepository,
      teams,
      themeWindows,
      oralSessions,
      attempts,
      activity,
    ),
    activity,
    solutions: new SolutionService(attempts, teams, passports, new PostgresTeacherTaskRepository(pool)),
  })
  registerClient(app)
  return app
}
