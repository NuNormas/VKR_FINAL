// Шкала одной лабораторной из требований: 2, 3, 4 или 5.
// Итог курса — среднее, сумма и коэффициенты контрольных — здесь не считается.
// Источники не задают, сколько подсказок считать «несколькими» и что ставить,
// если дома решена только часть пула, а очная задача не сдана. Эти края
// остаются «не определено», пока курс сам не задал порог числа подсказок.

export type LabGrade = 2 | 3 | 4 | 5

export type InPersonLevel = 'простое' | 'среднее' | 'сложное'

export interface InPersonEvidence {
  level: InPersonLevel
  accepted: boolean
  hintCount: number
  hintIssuedAt: string[]
  correctPath: boolean
}

export interface LabEvidence {
  trainerTasksTotal: number
  trainerTasksSolved: number
  inPerson: InPersonEvidence | null
}

export interface GradeDecision {
  grade: LabGrade | null
  label: 'неудовлетворительно' | 'удовлетворительно' | 'хорошо' | 'отлично' | 'не определено'
}

const LABELS = {
  2: 'неудовлетворительно',
  3: 'удовлетворительно',
  4: 'хорошо',
  5: 'отлично',
} as const

function decided(grade: LabGrade): GradeDecision {
  return { grade, label: LABELS[grade] }
}

function unspecified(): GradeDecision {
  return { grade: null, label: 'не определено' }
}

export interface GradingPolicy {
  grade(evidence: LabEvidence): GradeDecision
}

export class OneLabPolicy implements GradingPolicy {
  constructor(private readonly hardHintThreshold?: number) {
    if (
      hardHintThreshold !== undefined &&
      (!Number.isInteger(hardHintThreshold) || hardHintThreshold < 1)
    ) {
      throw new Error('Порог подсказок для сложного задания задаётся целым числом от 1')
    }
  }

  grade(evidence: LabEvidence): GradeDecision {
    const { trainerTasksTotal, trainerTasksSolved, inPerson } = evidence
    if (!Number.isInteger(trainerTasksTotal) || trainerTasksTotal < 1) return unspecified()
    if (
      !Number.isInteger(trainerTasksSolved) ||
      trainerTasksSolved < 0 ||
      trainerTasksSolved > trainerTasksTotal
    ) {
      return unspecified()
    }

    const allHome = trainerTasksSolved === trainerTasksTotal
    const someHome = trainerTasksSolved > 0

    if (inPerson === null) {
      return allHome ? decided(2) : unspecified()
    }

    if (!this.inPersonIsConsistent(inPerson)) return unspecified()
    if (!someHome) return unspecified()

    if (inPerson.level === 'сложное' && inPerson.accepted) {
      return this.acceptedHard(inPerson.hintCount)
    }

    if (inPerson.level === 'сложное' && !inPerson.accepted && inPerson.correctPath) {
      return decided(4)
    }

    if (inPerson.level === 'среднее' && inPerson.accepted) {
      return decided(4)
    }

    if (inPerson.level === 'простое' && inPerson.accepted && allHome) {
      return decided(3)
    }

    return unspecified()
  }

  private acceptedHard(hintCount: number): GradeDecision {
    const threshold = this.hardHintThreshold
    if (threshold === undefined) {
      return hintCount === 0 ? decided(5) : unspecified()
    }
    return hintCount >= threshold ? decided(4) : decided(5)
  }

  private inPersonIsConsistent(inPerson: InPersonEvidence): boolean {
    const levels: readonly string[] = ['простое', 'среднее', 'сложное']
    if (!levels.includes(inPerson.level)) return false
    if (typeof inPerson.accepted !== 'boolean' || typeof inPerson.correctPath !== 'boolean') {
      return false
    }
    if (!Number.isInteger(inPerson.hintCount) || inPerson.hintCount < 0) return false
    if (!Array.isArray(inPerson.hintIssuedAt) || inPerson.hintIssuedAt.length !== inPerson.hintCount) {
      return false
    }
    return inPerson.hintIssuedAt.every((stamp) => typeof stamp === 'string' && stamp.length > 0)
  }
}
