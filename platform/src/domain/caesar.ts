import { createHash } from 'node:crypto'
import type { TaskGenerator, Variant } from './generator.js'

export const ALPHABET = 'абвгдежзийклмнопрстуфхцчшщъыьэюя'

export function shiftText(text: string, shift: number): string {
  const size = ALPHABET.length
  const normalized = ((shift % size) + size) % size
  let out = ''
  for (const ch of text) {
    const index = ALPHABET.indexOf(ch)
    if (index < 0) {
      out += ch
      continue
    }
    out += ALPHABET[(index + normalized) % size] ?? ch
  }
  return out
}

function bytesFromSeed(seed: string, size: number): Buffer {
  const chunks: Buffer[] = []
  let counter = 0
  while (Buffer.concat(chunks).length < size) {
    chunks.push(createHash('sha256').update(`${seed}:${counter}`).digest())
    counter += 1
  }
  return Buffer.concat(chunks).subarray(0, size)
}

export const caesarGenerator: TaskGenerator = {
  id: 'caesar',
  generate(seed: string): Variant {
    const bytes = bytesFromSeed(seed, 16)
    const first = bytes[0]
    if (first === undefined) {
      throw new Error('Пустой seed-поток')
    }
    const shift = (first % (ALPHABET.length - 1)) + 1
    let token = ''
    for (let i = 0; i < 10; i += 1) {
      const byte = bytes[i + 1]
      if (byte === undefined) {
        throw new Error('Пустой seed-поток')
      }
      token += ALPHABET[byte % ALPHABET.length] ?? ''
    }
    const secret = `вариант ${token}`
    const ciphertext = shiftText(secret, shift)
    const statement = [
      'Задание по теме «Основы современной криптографии и методов защиты информации».',
      `Алфавит: ${ALPHABET}.`,
      'Шифр Цезаря: один сдвиг для всех букв, пробел остаётся пробелом.',
      'Сдайте открытый текст в нижнем регистре.',
      `Шифртекст: ${ciphertext}`,
    ].join('\n')
    return { secret, condition: { statement, ciphertext } }
  },
}
