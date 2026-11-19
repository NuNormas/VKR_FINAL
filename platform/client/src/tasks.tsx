import { useEffect, useState, type FormEvent } from 'react'
import { Api, type Session, type TeacherTaskDetail, type TeacherTaskSummary, type Theme } from './api'
import { HintBox } from './hints'

export function TaskList({
  api,
  session,
  onOpen,
  onCreate,
}: {
  api: Api
  session: Session
  onOpen: (id: string) => void
  onCreate: () => void
}) {
  const [tasks, setTasks] = useState<TeacherTaskSummary[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    const bank = session.role === 'преподаватель' || session.role === 'автор заданий'
    if (!bank && !session.teamId) {
      setTasks([])
      return
    }
    const team = bank ? '' : `?teamId=${session.teamId}`
    void api
      .request<{ tasks: TeacherTaskSummary[] }>(`/api/teacher-tasks${team}`)
      .then((result) => setTasks(result.tasks))
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Список не открылся'))
  }, [api, session.role, session.teamId])

  return (
    <section className="stack">
      <div className="row">
        <h2>Задания</h2>
        {(session.role === 'преподаватель' || session.role === 'автор заданий') && (
          <button onClick={onCreate}>Новое задание</button>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      {tasks.length === 0 && <p className="meta">Пока пусто.</p>}
      {tasks.map((task) => (
        <button key={task.id} className="card" onClick={() => onOpen(task.id)}>
          <strong>{task.title}</strong>
          <div className="meta">
            {task.theme}. {task.mode === 'очное' ? 'очное' : 'домашнее'}, {task.level}, {task.checker}
          </div>
          {session.role === 'студент' && <div>Вердикт: {task.verdict ?? 'ещё не сдано'}</div>}
        </button>
      ))}
    </section>
  )
}

export function TaskCreate({ api, onCreated }: { api: Api; onCreated: (id: string) => void }) {
  const [themes, setThemes] = useState<Theme[]>([])
  const [error, setError] = useState('')
  const [draft, setDraft] = useState({
    title: '',
    themeKey: 'intro',
    competency: '',
    mode: 'тренажёр',
    level: 'простое',
    statement: '',
    checker: 'флаг',
    secret: '',
    mustHave: '',
    mustNot: '',
    attemptLimit: '10',
    hints: '',
  })

  useEffect(() => {
    void api.request<{ themes: Theme[] }>('/api/themes').then((result) => setThemes(result.themes))
  }, [api])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    const lines = (value: string) => value.split('\n').map((line) => line.trim()).filter((line) => line.length > 0)
    const body: Record<string, unknown> = {
      title: draft.title,
      themeKey: draft.themeKey,
      competency: draft.competency,
      mode: draft.mode,
      level: draft.level,
      statement: draft.statement,
      checker: draft.checker,
    }
    if (draft.checker === 'патч') {
      body.mustHave = lines(draft.mustHave)
      body.mustNot = lines(draft.mustNot)
    } else {
      body.secret = draft.secret
    }
    const limit = Number(draft.attemptLimit)
    if (Number.isInteger(limit)) body.attemptLimit = limit
    const hints = lines(draft.hints)
    if (hints.length > 0) body.hints = hints
    try {
      const created = await api.request<{ id: string }>('/api/teacher-tasks', { method: 'POST', body })
      onCreated(created.id)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Задание не сохранилось')
    }
  }

  return (
    <form className="stack" onSubmit={(event) => void submit(event)}>
      <h2>Новое задание</h2>
      {error && <p className="error">{error}</p>}
      <label>
        <span>Название</span>
        <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
      </label>
      <label>
        <span>Тема</span>
        <select value={draft.themeKey} onChange={(event) => setDraft({ ...draft, themeKey: event.target.value })}>
          {themes.map((theme) => (
            <option key={theme.key} value={theme.key}>
              {theme.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Компетенция</span>
        <input value={draft.competency} onChange={(event) => setDraft({ ...draft, competency: event.target.value })} />
      </label>
      <label>
        <span>Режим</span>
        <select value={draft.mode} onChange={(event) => setDraft({ ...draft, mode: event.target.value })}>
          <option value="тренажёр">домашнее</option>
          <option value="очное">очное</option>
        </select>
      </label>
      <label>
        <span>Уровень</span>
        <select value={draft.level} onChange={(event) => setDraft({ ...draft, level: event.target.value })}>
          <option>простое</option>
          <option>среднее</option>
          <option>сложное</option>
        </select>
      </label>
      <label>
        <span>Условие</span>
        <textarea value={draft.statement} onChange={(event) => setDraft({ ...draft, statement: event.target.value })} />
      </label>
      <label>
        <span>Чекер</span>
        <select value={draft.checker} onChange={(event) => setDraft({ ...draft, checker: event.target.value })}>
          <option value="флаг">флаг</option>
          <option value="строка">строка</option>
          <option value="патч">патч</option>
        </select>
      </label>
      {draft.checker === 'патч' ? (
        <>
          <label>
            <span>Что должно появиться в исправлении</span>
            <textarea value={draft.mustHave} onChange={(event) => setDraft({ ...draft, mustHave: event.target.value })} />
          </label>
          <label>
            <span>Чего в исправлении быть не должно</span>
            <textarea value={draft.mustNot} onChange={(event) => setDraft({ ...draft, mustNot: event.target.value })} />
          </label>
        </>
      ) : (
        <label>
          <span>Секрет паспорта</span>
          <input
            type="password"
            value={draft.secret}
            autoComplete="off"
            onChange={(event) => setDraft({ ...draft, secret: event.target.value })}
          />
        </label>
      )}
      <label>
        <span>Лимит попыток</span>
        <input
          value={draft.attemptLimit}
          onChange={(event) => setDraft({ ...draft, attemptLimit: event.target.value })}
        />
      </label>
      <label>
        <span>Подсказки, две или три ступени, каждая с новой строки</span>
        <textarea value={draft.hints} onChange={(event) => setDraft({ ...draft, hints: event.target.value })} />
      </label>
      <button type="submit">Сохранить задание</button>
    </form>
  )
}

export function TaskCardView({
  api,
  session,
  id,
  onSubmit,
}: {
  api: Api
  session: Session
  id: string
  onSubmit: () => void
}) {
  const [task, setTask] = useState<TeacherTaskDetail | null>(null)
  const [error, setError] = useState('')
  const [code, setCode] = useState('')

  useEffect(() => {
    void load()
    async function load() {
      try {
        setTask(await api.request<TeacherTaskDetail>(`/api/teacher-tasks/${id}${teamQuery(session)}`))
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Карточка не открылась')
      }
    }
  }, [api, id, session])

  async function join(event: FormEvent) {
    event.preventDefault()
    setError('')
    try {
      await api.request('/api/oral-sessions/join', { method: 'POST', body: { code } })
      setTask(await api.request<TeacherTaskDetail>(`/api/teacher-tasks/${id}${teamQuery(session)}`))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Код не принят')
    }
  }

  if (!task) return error ? <p className="error">{error}</p> : <p className="meta">Загрузка</p>
  return (
    <article className="stack">
      <h2>{task.title}</h2>
      <p className="meta">
        {task.theme}. {task.mode === 'очное' ? 'очное' : 'домашнее'}, {task.level}. Чекер: {task.checker}
      </p>
      <p>{task.competency}</p>
      {task.statement && <pre className="condition">{task.statement}</pre>}
      {task.closed && <p className="error">{task.closed}</p>}
      {session.role === 'студент' && task.verdict && <p>Вердикт: {task.verdict}</p>}
      {(session.role === 'преподаватель' || session.role === 'автор заданий') && task.secret && (
        <p className="meta">Секрет: {task.secret}</p>
      )}
      {(session.role === 'преподаватель' || session.role === 'автор заданий') && task.mustHave && (
        <p className="meta">В исправлении: {task.mustHave.join(', ')}</p>
      )}
      {session.role === 'студент' && task.mode === 'очное' && task.closed && (
        <form className="row" onSubmit={(event) => void join(event)}>
          <input value={code} onChange={(event) => setCode(event.target.value)} placeholder="Код сессии" />
          <button type="submit">Войти в сессию</button>
        </form>
      )}
      {session.role === 'студент' && task.statement && <button onClick={onSubmit}>К сдаче</button>}
      {error && <p className="error">{error}</p>}
    </article>
  )
}

export function TaskSubmit({ api, session, id }: { api: Api; session: Session; id: string }) {
  const [task, setTask] = useState<TeacherTaskDetail | null>(null)
  const [answer, setAnswer] = useState('')
  const [verdict, setVerdict] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    void api
      .request<TeacherTaskDetail>(`/api/teacher-tasks/${id}${teamQuery(session)}`)
      .then(setTask)
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Задание не открылось'))
  }, [api, id, session])

  async function submit() {
    setError('')
    try {
      const result = await api.request<{ result: string }>(`/api/teacher-tasks/${id}/submissions`, {
        method: 'POST',
        body: { teamId: session.teamId, answer },
      })
      setVerdict(result.result)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Сдача не прошла')
    }
  }

  return (
    <section className="stack">
      <h2>Сдача</h2>
      {task && <p className="meta">{task.title}</p>}
      {task?.statement && <pre className="condition">{task.statement}</pre>}
      {task?.statement && session.teamId && <HintBox api={api} taskId={id} teamId={session.teamId} />}
      {task?.closed && <p className="error">{task.closed}</p>}
      {error && <p className="error">{error}</p>}
      <label>
        <span>Ответ</span>
        <textarea value={answer} onChange={(event) => setAnswer(event.target.value)} />
      </label>
      <button onClick={() => void submit()}>Сдать</button>
      {verdict && <p className={verdict === 'зачтено' ? 'ok' : 'bad'}>{verdict}</p>}
    </section>
  )
}

function teamQuery(session: Session): string {
  if (session.role !== 'студент' || !session.teamId) return ''
  return `?teamId=${session.teamId}`
}
