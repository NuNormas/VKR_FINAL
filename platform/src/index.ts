import { buildApp } from './app.js'
import { loadConfig } from './config.js'

const config = loadConfig()
const app = await buildApp({
  databaseUrl: config.databaseUrl,
  logger: true,
  bootstrapTeacher:
    config.teacherLogin && config.teacherPassword
      ? {
          login: config.teacherLogin,
          password: config.teacherPassword,
          displayName: config.teacherName,
        }
      : undefined,
})

try {
  await app.listen({ port: config.port, host: config.host })
} catch (error) {
  app.log.error(error)
  await app.close()
  process.exit(1)
}
