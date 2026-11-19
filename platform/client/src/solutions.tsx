import { useEffect, useState } from 'react'
import { Api, type SolutionDetail, type SolutionSummary } from './api'

function when(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function SolutionList({ api, onOpen }: { api: Api; onOpen: (id: string) => void }) {
  const [solutions, setSolutions] = useState<SolutionSummary[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    void api
      .request<{ solutions: SolutionSummary[] }>('/api/solutions')
      .then((result) => setSolutions(result.solutions))
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Список не открылся'))
  }, [api])

  return (
    <section className="stack">
      <h2>Решения</h2>
      {error && <p className="error">{error}</p>}
      {solutions.length === 0 && <p className="meta">Сдач пока нет.</p>}
      {solutions.map((solution) => (
        <button key={solution.id} className="card" onClick={() => onOpen(solution.id)}>
          <strong>{solution.who}</strong>
          <div>{solution.taskTitle}</div>
          <div className="meta">
            {solution.verdict}, {when(solution.submittedAt)}
          </div>
        </button>
      ))}
    </section>
  )
}

export function SolutionCard({
  api,
  id,
  teacher,
  onBack,
}: {
  api: Api
  id: string
  teacher: boolean
  onBack: () => void
}) {
  const [solution, setSolution] = useState<SolutionDetail | null>(null)
  const [error, setError] = useState('')
  const [path, setPath] = useState('')

  useEffect(() => {
    void api
      .request<SolutionDetail>(`/api/solutions/${id}`)
      .then(setSolution)
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Сдача не открылась'))
  }, [api, id])

  if (!solution) return error ? <p className="error">{error}</p> : <p className="meta">Загрузка</p>
  return (
    <article className="stack">
      <button className="quiet" onClick={onBack}>
        К списку
      </button>
      <h2>{solution.taskTitle}</h2>
      <p>
        Кто: {solution.who}, команда {solution.teamName}
      </p>
      <p className={solution.verdict === 'зачтено' ? 'ok' : 'bad'}>{solution.verdict}</p>
      <p className="meta">{when(solution.submittedAt)}</p>
      <pre className="condition">{solution.answer ?? 'Текст сдачи не сохранён.'}</pre>
      {teacher && solution.verdict !== 'зачтено' && (
        <button
          onClick={async () => {
            setError('')
            try {
              await api.request(`/api/solutions/${id}/correct-path`, { method: 'POST' })
              setPath('Отмечен верный путь')
            } catch (caught) {
              setError(caught instanceof Error ? caught.message : 'Отметка не сохранилась')
            }
          }}
        >
          Верный путь
        </button>
      )}
      {path && <p className="ok">{path}</p>}
      {error && <p className="error">{error}</p>}
    </article>
  )
}
