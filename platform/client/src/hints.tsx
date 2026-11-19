import { useEffect, useState } from 'react'
import { Api } from './api'

interface HintState {
  hintsTotal: number
  opened: { step: number; body: string; openedAt: string }[]
  attemptLimit: number
  attemptsUsed: number
}

function when(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function HintBox({ api, taskId, teamId }: { api: Api; taskId: string; teamId: string }) {
  const [state, setState] = useState<HintState | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    void api
      .request<HintState>(`/api/tasks/${taskId}/hints?teamId=${teamId}`)
      .then(setState)
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Подсказки не открылись'))
  }, [api, taskId, teamId])

  async function openNext() {
    setError('')
    try {
      setState(await api.request<HintState>(`/api/tasks/${taskId}/hints`, { method: 'POST', body: { teamId } }))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Подсказка не открылась')
    }
  }

  if (!state) return error ? <p className="error">{error}</p> : null
  const left = state.attemptLimit - state.attemptsUsed
  return (
    <div className="stack">
      <p className="meta">Попыток осталось: {left < 0 ? 0 : left}</p>
      {state.opened.map((hint) => (
        <p key={hint.step}>
          Ступень {hint.step}, {when(hint.openedAt)}: {hint.body}
        </p>
      ))}
      {state.opened.length < state.hintsTotal && <button onClick={() => void openNext()}>Открыть подсказку</button>}
      {error && <p className="error">{error}</p>}
    </div>
  )
}
