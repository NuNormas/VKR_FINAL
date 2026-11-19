import type { Pool } from 'pg'
import { TASKS } from '../domain/catalog.js'

const COLUMNS = [
  'id',
  'work',
  'theme_key',
  'title',
  'competency',
  'mode',
  'format',
  'level',
  'generator_id',
  'checker_kind',
] as const

function values(task: (typeof TASKS)[number]): unknown[] {
  return [
    task.id,
    task.work,
    task.themeKey,
    task.title,
    task.competency,
    task.mode,
    task.format,
    task.level,
    task.generatorId,
    task.checkerKind,
  ]
}

async function writePassport(pool: Pool, task: (typeof TASKS)[number], overwrite: boolean): Promise<void> {
  const placeholders = COLUMNS.map((_, index) => `$${index + 1}`).join(', ')
  const updates = COLUMNS.filter((column) => column !== 'id')
    .map((column) => `${column} = EXCLUDED.${column}`)
    .join(', ')
  const conflict = overwrite ? `DO UPDATE SET ${updates}` : 'DO NOTHING'
  await pool.query(
    `INSERT INTO task_passports (${COLUMNS.join(', ')})
     VALUES (${placeholders})
     ON CONFLICT (id) ${conflict}`,
    values(task),
  )
}

export async function ensurePassports(pool: Pool): Promise<void> {
  for (const task of TASKS) await writePassport(pool, task, false)
}

export async function resetPassports(pool: Pool): Promise<void> {
  for (const task of TASKS) await writePassport(pool, task, true)
  await pool.query('DELETE FROM task_passports WHERE NOT (id = ANY($1::text[]))', [
    TASKS.map((task) => task.id),
  ])
}
