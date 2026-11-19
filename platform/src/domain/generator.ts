import { DomainError } from './errors.js'

export interface TaskCondition {
  statement: string
  ciphertext?: string
  standLabel?: string
  standUrl?: string
}

export interface Variant {
  condition: TaskCondition
  secret: string
}

export interface TaskGenerator {
  readonly id: string
  generate(seed: string): Variant
}

export class GeneratorFactory {
  private readonly byId: Map<string, TaskGenerator>

  constructor(generators: TaskGenerator[]) {
    this.byId = new Map(generators.map((generator) => [generator.id, generator]))
  }

  create(generatorId: string): TaskGenerator {
    const generator = this.byId.get(generatorId)
    if (!generator) {
      throw new DomainError(`Генератор «${generatorId}» не найден`, 'internal')
    }
    return generator
  }
}
