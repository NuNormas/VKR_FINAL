import { createReadStream, existsSync, statSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../client/dist')

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
}

export function registerClient(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) => {
    const path = request.url.split('?')[0] ?? '/'
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return reply.status(404).send({ error: 'Не найдено' })
    }
    if (path.startsWith('/api') || path === '/health') {
      return reply.status(404).send({ error: 'Не найдено' })
    }
    if (!existsSync(ROOT)) {
      return reply.status(404).send({ error: 'Интерфейс не собран' })
    }
    return sendFile(request, reply, path)
  })
}

function sendFile(request: FastifyRequest, reply: FastifyReply, path: string) {
  const relative = path === '/' ? 'index.html' : path.replace(/^\/+/, '')
  if (relative.includes('..')) return reply.status(404).send({ error: 'Не найдено' })
  let file = join(ROOT, relative)
  if (!existsSync(file) || !statSync(file).isFile()) file = join(ROOT, 'index.html')
  const type = TYPES[extname(file)] ?? 'application/octet-stream'
  reply.header('content-type', type)
  if (request.method === 'HEAD') return reply.send()
  return reply.send(createReadStream(file))
}
