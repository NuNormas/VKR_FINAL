import { useEffect, useState } from 'react'
import { Api, type Session } from './api'

interface ActivityEvent {
  id: string
  teamName: string
  taskTitle: string
  kind: string
  createdAt: string
  fast?: boolean
}

function when(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function Journal({ api, session }: { api: Api; session: Session }) {
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    if (session.role !== 'преподаватель' && !session.teamId) {
      setEvents([])
      return
    }
    const team = session.role === 'преподаватель' ? '' : `?teamId=${session.teamId}`
    void api
      .request<{ events: ActivityEvent[] }>(`/api/activity${team}`)
      .then((result) => setEvents(result.events))
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Журнал не открылся'))
  }, [api, session.role, session.teamId])

  return (
    <section className="stack">
      <h2>Журнал</h2>
      {error && <p className="error">{error}</p>}
      {events.length === 0 && <p className="meta">Записей пока нет.</p>}
      {events.map((event) => (
        <article key={event.id} className="card">
          <strong>
            {event.kind}
            {event.fast ? ' · быстро' : ''}
          </strong>
          <div>
            {session.role === 'преподаватель' ? `${event.teamName}. ` : ''}
            {event.taskTitle}
          </div>
          <div className="meta">{when(event.createdAt)}</div>
        </article>
      ))}
    </section>
  )
}
