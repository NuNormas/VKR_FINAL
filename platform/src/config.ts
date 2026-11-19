export interface AppConfig {
  host: string
  port: number
  databaseUrl: string
  teacherLogin?: string
  teacherPassword?: string
  teacherName: string
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const port = Number(env.PORT ?? 3000)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT должен быть целым числом от 1 до 65535')
  }
  const databaseUrl = env.DATABASE_URL ?? 'postgres://trainer:trainer@127.0.0.1:5432/trainer'
  return {
    host: env.HOST ?? '0.0.0.0',
    port,
    databaseUrl,
    teacherLogin: env.TEACHER_LOGIN,
    teacherPassword: env.TEACHER_PASSWORD,
    teacherName: env.TEACHER_NAME ?? 'Преподаватель',
  }
}
