import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Pool } from 'pg'
import { THEMES } from '../domain/themes.js'

export async function migrate(pool: Pool): Promise<void> {
  const sqlDir = join(dirname(fileURLToPath(import.meta.url)), '../../sql')
  const files = readdirSync(sqlDir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
  for (const name of files) {
    await pool.query(readFileSync(join(sqlDir, name), 'utf8'))
  }
  for (const theme of THEMES) {
    await pool.query(
      `INSERT INTO theme_windows (theme_key, phase)
       VALUES ($1, 'закрыта')
       ON CONFLICT (theme_key) DO NOTHING`,
      [theme.key],
    )
  }
}
