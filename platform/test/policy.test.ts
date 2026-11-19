import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  OneLabPolicy,
  type InPersonEvidence,
  type LabEvidence,
} from '../src/domain/grading-policy.js'

function inPerson(patch: Partial<InPersonEvidence> & Pick<InPersonEvidence, 'level' | 'accepted'>): InPersonEvidence {
  const hintCount = patch.hintCount ?? 0
  return {
    level: patch.level,
    accepted: patch.accepted,
    hintCount,
    hintIssuedAt: patch.hintIssuedAt ?? Array.from({ length: hintCount }, (_, index) => `t${index}`),
    correctPath: patch.correctPath ?? false,
  }
}

function evidence(patch: Partial<LabEvidence> = {}): LabEvidence {
  return {
    trainerTasksTotal: patch.trainerTasksTotal ?? 3,
    trainerTasksSolved: patch.trainerTasksSolved ?? 3,
    inPerson: patch.inPerson === undefined ? null : patch.inPerson,
  }
}

test('все задания тренажёра сданы, очной части нет — двойка', () => {
  const decision = new OneLabPolicy().grade(evidence())
  assert.deepEqual(decision, { grade: 2, label: 'неудовлетворительно' })
})

test('дома решена только часть, очной нет — оценку не ставим', () => {
  const decision = new OneLabPolicy().grade(evidence({ trainerTasksSolved: 1 }))
  assert.deepEqual(decision, { grade: null, label: 'не определено' })
})

test('дома ничего не сдано и очной нет — оценку не ставим', () => {
  const decision = new OneLabPolicy().grade(evidence({ trainerTasksSolved: 0 }))
  assert.equal(decision.grade, null)
})

test('пустой пул тренажёра не считается двойкой', () => {
  const decision = new OneLabPolicy().grade(evidence({ trainerTasksTotal: 0, trainerTasksSolved: 0 }))
  assert.equal(decision.grade, null)
})

test('все дома и простое очное — тройка', () => {
  const decision = new OneLabPolicy().grade(
    evidence({ inPerson: inPerson({ level: 'простое', accepted: true }) }),
  )
  assert.deepEqual(decision, { grade: 3, label: 'удовлетворительно' })
})

test('простое очное при частично решённом тренажёре источники не оценивают', () => {
  const decision = new OneLabPolicy().grade(
    evidence({
      trainerTasksSolved: 1,
      inPerson: inPerson({ level: 'простое', accepted: true }),
    }),
  )
  assert.equal(decision.grade, null)
})

test('среднее очное и хотя бы часть дома — четвёрка', () => {
  const decision = new OneLabPolicy().grade(
    evidence({
      trainerTasksSolved: 1,
      inPerson: inPerson({ level: 'среднее', accepted: true }),
    }),
  )
  assert.deepEqual(decision, { grade: 4, label: 'хорошо' })
})

test('сложное очное без подсказок и хотя бы часть дома — пятёрка', () => {
  const decision = new OneLabPolicy().grade(
    evidence({
      trainerTasksSolved: 1,
      inPerson: inPerson({ level: 'сложное', accepted: true, hintCount: 0 }),
    }),
  )
  assert.deepEqual(decision, { grade: 5, label: 'отлично' })
})

test('сложное не сдано, но отмечен верный путь — четвёрка', () => {
  const decision = new OneLabPolicy().grade(
    evidence({
      trainerTasksSolved: 2,
      inPerson: inPerson({ level: 'сложное', accepted: false, correctPath: true }),
    }),
  )
  assert.equal(decision.grade, 4)
})

test('сложное сдано с подсказками, порог не задан — оценку не угадываем', () => {
  const decision = new OneLabPolicy().grade(
    evidence({
      trainerTasksSolved: 1,
      inPerson: inPerson({ level: 'сложное', accepted: true, hintCount: 2 }),
    }),
  )
  assert.equal(decision.grade, null)
})

test('курс задал порог подсказок: сложное с этим числом — четвёрка, меньше — пятёрка', () => {
  const policy = new OneLabPolicy(2)
  const withHints = policy.grade(
    evidence({
      trainerTasksSolved: 1,
      inPerson: inPerson({ level: 'сложное', accepted: true, hintCount: 2 }),
    }),
  )
  const below = policy.grade(
    evidence({
      trainerTasksSolved: 1,
      inPerson: inPerson({ level: 'сложное', accepted: true, hintCount: 1 }),
    }),
  )
  assert.equal(withHints.grade, 4)
  assert.equal(below.grade, 5)
})

test('очная без домашнего допуска не поднимает оценку', () => {
  const decision = new OneLabPolicy().grade(
    evidence({
      trainerTasksSolved: 0,
      inPerson: inPerson({ level: 'сложное', accepted: true }),
    }),
  )
  assert.equal(decision.grade, null)
})

test('проваленная очная при полном тренажёре не превращается в двойку', () => {
  const decision = new OneLabPolicy().grade(
    evidence({
      inPerson: inPerson({ level: 'простое', accepted: false }),
    }),
  )
  assert.equal(decision.grade, null)
})
