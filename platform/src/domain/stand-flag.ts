import { createHash } from 'node:crypto'
import type { TaskGenerator, Variant } from './generator.js'

function digest(prefix: string, seed: string, length: number): string {
  return createHash('sha256').update(`${prefix}:${seed}`).digest('hex').slice(0, length)
}

export const standFlagGenerator: TaskGenerator = {
  id: 'stand-flag',
  generate(seed: string): Variant {
    const secret = `HITS{${digest('stand-flag', seed, 20)}}`
    const standLabel = `стенд-${digest('stand-public', seed, 8)}`
    const statement = [
      'Задание по теме «Классические клиентские и серверные уязвимости».',
      `Вариант привязан к стенду ${standLabel}.`,
      'Контейнер в этом срезе не запускается: платформа сравнивает сданную строку с флагом варианта.',
      'Формат флага: HITS{...}. Сдайте флаг своего варианта.',
    ].join('\n')
    return { secret, condition: { statement, standLabel } }
  },
}
