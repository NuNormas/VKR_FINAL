import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DomainError } from '../domain/errors.js'

const IMAGE = 'trainer-web-stand:local'
const CONTEXT = join(dirname(fileURLToPath(import.meta.url)), '../../stands/web')

// Живой контейнер у веб-заданий, где навык — сервис. Шифры и проверка исправления сюда не входят.
export const LIVE_STANDS = [
  'web-sqli',
  'web-xss',
  'web-csrf',
  'web-idor',
  'web-traversal',
  'web-sqli-oral',
  'web-ssrf',
  'web-deser',
  'web-command',
  'web-ssrf-oral',
] as const

const liveStands = new Set<string>(LIVE_STANDS)

export function isLiveStand(taskId: string): boolean {
  return liveStands.has(taskId)
}

export interface StandRequest {
  teamId: string
  taskId: string
  flag: string
}

export interface StandLease {
  url: string
  started: boolean
}

export interface StandRuntime {
  ensure(input: StandRequest): Promise<StandLease | null>
}

export class DockerStandRuntime implements StandRuntime {
  private imageReady = false

  async ensure(input: StandRequest): Promise<StandLease | null> {
    if (!isLiveStand(input.taskId)) return null
    await this.prepareImage()
    const name = containerName(input.taskId, input.teamId)
    const existing = await runningUrl(name)
    if (existing && (await answers(existing, input.flag))) return { url: existing, started: false }
    await remove(name)
    const port = await freePort()
    const url = `http://127.0.0.1:${port}/`
    const started = Date.now()
    const run = await docker([
      'run',
      '-d',
      '--name',
      name,
      '--rm',
      '--memory',
      '128m',
      '--pids-limit',
      '64',
      '--network',
      'bridge',
      '-p',
      `127.0.0.1:${port}:8080`,
      '-e',
      `FLAG=${input.flag}`,
      '-e',
      `STAND=${input.taskId}`,
      IMAGE,
    ])
    if (run.code !== 0) throw new DomainError('Стенд не поднялся', 'internal')
    const deadline = started + 30_000
    while (Date.now() < deadline) {
      if (await answers(url, input.flag)) return { url, started: true }
      await delay(200)
    }
    await remove(name)
    throw new DomainError('Стенд не поднялся', 'internal')
  }

  private async prepareImage(): Promise<void> {
    if (this.imageReady) return
    const inspect = await docker(['image', 'inspect', IMAGE])
    if (inspect.code !== 0) {
      const built = await docker(['build', '-t', IMAGE, CONTEXT])
      if (built.code !== 0) throw new DomainError('Стенд не поднялся', 'internal')
    }
    this.imageReady = true
  }
}

export function containerName(taskId: string, teamId: string): string {
  const hash = createHash('sha256').update(teamId).digest('hex').slice(0, 16)
  return `trainer-${taskId}-${hash}`
}

async function runningUrl(name: string): Promise<string | null> {
  const info = await docker([
    'inspect',
    '--format',
    '{{if .State.Running}}{{(index (index .NetworkSettings.Ports "8080/tcp") 0).HostPort}}{{end}}',
    name,
  ])
  const port = info.stdout.trim()
  if (info.code !== 0 || !port) return null
  return `http://127.0.0.1:${port}/`
}

async function answers(url: string, flag: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1000) })
    if (!response.ok) return false
    const text = await response.text()
    return !text.includes(flag)
  } catch {
    return false
  }
}

async function remove(name: string): Promise<void> {
  await docker(['rm', '-f', name])
}

function docker(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.on('error', () => reject(new DomainError('Стенд не поднялся', 'internal')))
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }))
  })
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolve(port))
    })
    server.on('error', reject)
  })
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
