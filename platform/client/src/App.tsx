import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  Api,
  type AuthoredDetail,
  type AuthoredSummary,
  type OpenedTask,
  type Session,
  type TaskCard,
  type Theme,
} from './api'
import { HintBox } from './hints'
import { Journal } from './journal'
import { SolutionCard, SolutionList } from './solutions'
import { TaskCardView, TaskCreate, TaskList, TaskSubmit } from './tasks'

const STORAGE = 'trainer-session'

type Screen =
  | { name: 'themes' }
  | { name: 'theme'; theme: Theme }
  | { name: 'task'; theme: Theme; task: TaskCard }
  | { name: 'authored' }
  | { name: 'authored-one'; id: string }
  | { name: 'task-list' }
  | { name: 'task-card'; id: string }
  | { name: 'task-create' }
  | { name: 'task-submit'; id: string }
  | { name: 'solutions' }
  | { name: 'solution'; id: string }
  | { name: 'journal' }

export function App() {
  const [session, setSession] = useState<Session | null>(() => readSession())
  const [screen, setScreen] = useState<Screen>({ name: 'themes' })
  const api = useMemo(() => new Api(session?.token ?? ''), [session?.token])

  if (!session) return <Login onLogin={setSession} />
  return (
    <div className="shell">
      <header>
        <div>
          <h1>Тренажёр</h1>
          <p className="meta">
            {session.displayName}, {session.role}
          </p>
        </div>
        <button
          className="quiet"
          onClick={() => {
            sessionStorage.removeItem(STORAGE)
            setSession(null)
            setScreen({ name: 'themes' })
          }}
        >
          Выйти
        </button>
      </header>
      <nav className="row">
        <button className="quiet" onClick={() => setScreen({ name: 'themes' })}>
          Темы
        </button>
        <button className="quiet" onClick={() => setScreen({ name: 'task-list' })}>
          Задания
        </button>
        <button className="quiet" onClick={() => setScreen({ name: 'solutions' })}>
          Решения
        </button>
        <button className="quiet" onClick={() => setScreen({ name: 'journal' })}>
          Журнал
        </button>
        <button className="quiet" onClick={() => setScreen({ name: 'authored' })}>
          Свои задачи
        </button>
      </nav>
      {screen.name === 'themes' && (
        <Themes
          api={api}
          session={session}
          onOpen={(theme) => setScreen({ name: 'theme', theme })}
          onSession={setSession}
        />
      )}
      {screen.name === 'theme' && (
        <ThemePage
          api={api}
          session={session}
          theme={screen.theme}
          onOpen={(task) => setScreen({ name: 'task', theme: screen.theme, task })}
        />
      )}
      {screen.name === 'task' && (
        <TaskPage api={api} session={session} task={screen.task} onBack={() => setScreen({ name: 'theme', theme: screen.theme })} />
      )}
      {screen.name === 'authored' && (
        <AuthoredList api={api} session={session} onOpen={(id) => setScreen({ name: 'authored-one', id })} />
      )}
      {screen.name === 'authored-one' && <AuthoredOne api={api} id={screen.id} />}
      {screen.name === 'task-list' && (
        <TaskList
          api={api}
          session={session}
          onOpen={(id) => setScreen({ name: 'task-card', id })}
          onCreate={() => setScreen({ name: 'task-create' })}
        />
      )}
      {screen.name === 'task-create' && <TaskCreate api={api} onCreated={(id) => setScreen({ name: 'task-card', id })} />}
      {screen.name === 'task-card' && (
        <TaskCardView
          api={api}
          session={session}
          id={screen.id}
          onSubmit={() => setScreen({ name: 'task-submit', id: screen.id })}
        />
      )}
      {screen.name === 'task-submit' && <TaskSubmit api={api} session={session} id={screen.id} />}
      {screen.name === 'solutions' && <SolutionList api={api} onOpen={(id) => setScreen({ name: 'solution', id })} />}
      {screen.name === 'solution' && (
        <SolutionCard
          api={api}
          id={screen.id}
          teacher={session.role === 'преподаватель'}
          onBack={() => setScreen({ name: 'solutions' })}
        />
      )}
      {screen.name === 'journal' && <Journal api={api} session={session} />}
    </div>
  )
}

function Login({ onLogin }: { onLogin: (session: Session) => void }) {
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    try {
      const api = new Api(null)
      const result = await api.request<{ token: string; role: Session['role']; displayName: string }>('/api/login', {
        method: 'POST',
        body: { login, password },
      })
      const session: Session = { ...result, login }
      if (session.role === 'студент') {
        const authed = new Api(session.token)
        const team = await authed.request<{ id: string }>('/api/teams', {
          method: 'POST',
          body: { name: session.displayName, memberLogins: [login] },
        })
        session.teamId = team.id
      }
      sessionStorage.setItem(STORAGE, JSON.stringify(session))
      onLogin(session)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Ошибка входа')
    }
  }

  return (
    <div className="shell">
      <h1>Тренажёр</h1>
      <form className="stack" onSubmit={submit}>
        <label>
          <span>Логин</span>
          <input value={login} onChange={(event) => setLogin(event.target.value)} autoComplete="username" />
        </label>
        <label>
          <span>Пароль</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit">Войти</button>
      </form>
    </div>
  )
}

function Themes({
  api,
  session,
  onOpen,
  onSession,
}: {
  api: Api
  session: Session
  onOpen: (theme: Theme) => void
  onSession: (session: Session) => void
}) {
  const [themes, setThemes] = useState<Theme[]>([])
  const [error, setError] = useState('')
  const [student, setStudent] = useState({ login: '', password: '', displayName: '' })
  const [imported, setImported] = useState('')

  useEffect(() => {
    void load()
    async function load() {
      try {
        const listed = await api.request<{ themes: Theme[] }>('/api/themes')
        const withPhase = await Promise.all(
          listed.themes.map(async (theme) => {
            const window = await api.request<{ phase: string }>(`/api/themes/${theme.key}/window`)
            return { ...theme, phase: window.phase }
          }),
        )
        setThemes(withPhase)
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Не удалось загрузить темы')
      }
    }
  }, [api])

  return (
    <section className="stack">
      <h2>Темы</h2>
      {error && <p className="error">{error}</p>}
      {themes.map((theme) => (
        <button key={theme.key} className="card" onClick={() => onOpen(theme)}>
          <strong>{theme.name}</strong>
          <div className="meta">Окно: {theme.phase}</div>
        </button>
      ))}
      {session.role === 'преподаватель' && (
        <>
        <form
          className="stack"
          onSubmit={async (event) => {
            event.preventDefault()
            setError('')
            try {
              await api.request('/api/users', { method: 'POST', body: { ...student, role: 'студент' } })
              setStudent({ login: '', password: '', displayName: '' })
            } catch (caught) {
              setError(caught instanceof Error ? caught.message : 'Студент не создан')
            }
          }}
        >
          <h2>Новый студент</h2>
          <label>
            <span>Логин</span>
            <input value={student.login} onChange={(event) => setStudent({ ...student, login: event.target.value })} />
          </label>
          <label>
            <span>Пароль</span>
            <input
              type="password"
              value={student.password}
              onChange={(event) => setStudent({ ...student, password: event.target.value })}
            />
          </label>
          <label>
            <span>Имя</span>
            <input
              value={student.displayName}
              onChange={(event) => setStudent({ ...student, displayName: event.target.value })}
            />
          </label>
          <button type="submit">Создать студента</button>
        </form>
        <label>
          <span>Файл группы CSV: логин, пароль, имя, роль</span>
          <input
            type="file"
            accept=".csv,text/csv,text/plain"
            onChange={async (event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (!file) return
              setError('')
              setImported('')
              try {
                const result = await api.request<{ count: number }>('/api/groups', {
                  method: 'POST',
                  body: { csv: await file.text() },
                })
                setImported(`Доступ получили ${result.count}`)
              } catch (caught) {
                setError(caught instanceof Error ? caught.message : 'Группа не загрузилась')
              }
            }}
          />
        </label>
        {imported && <p className="ok">{imported}</p>}
        </>
      )}
      {session.role === 'студент' && !session.teamId && (
        <button
          onClick={async () => {
            const team = await api.request<{ id: string }>('/api/teams', {
              method: 'POST',
              body: { name: session.displayName, memberLogins: [session.login] },
            })
            const next = { ...session, teamId: team.id }
            sessionStorage.setItem(STORAGE, JSON.stringify(next))
            onSession(next)
          }}
        >
          Собрать команду
        </button>
      )}
    </section>
  )
}

function ThemePage({
  api,
  session,
  theme,
  onOpen,
}: {
  api: Api
  session: Session
  theme: Theme
  onOpen: (task: TaskCard) => void
}) {
  const [tasks, setTasks] = useState<TaskCard[]>([])
  const [phase, setPhase] = useState(theme.phase ?? '')
  const [level, setLevel] = useState('простое')
  const [minutes, setMinutes] = useState(15)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [grade, setGrade] = useState('')

  useEffect(() => {
    void api.request<{ tasks: TaskCard[] }>('/api/tasks').then((result) => {
      setTasks(result.tasks.filter((task) => task.theme === theme.name))
    })
    if (session.role !== 'студент' || !session.teamId) return
    void api
      .request<{ label: string }>(`/api/themes/${theme.key}/grade?teamId=${session.teamId}`)
      .then((result) => setGrade(result.label))
      .catch(() => setGrade(''))
  }, [api, theme.name, theme.key, session.role, session.teamId])

  async function windowAction(action: 'открыть' | 'закончить') {
    setError('')
    try {
      const result = await api.request<{ phase: string }>(`/api/themes/${theme.key}/window`, {
        method: 'POST',
        body: { action },
      })
      setPhase(result.phase)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Окно не изменилось')
    }
  }

  return (
    <section className="stack">
      <h2>{theme.name}</h2>
      <p className="meta">Окно: {phase}</p>
      {grade && <p>Оценка: {grade}</p>}
      {(session.role === 'преподаватель' || session.role === 'ассистент') && (
        <div className="stack">
          {session.role === 'преподаватель' && (
            <div className="row">
              <button onClick={() => void windowAction('открыть')}>Открыть неделю</button>
              <button onClick={() => void windowAction('закончить')}>Закончить неделю</button>
            </div>
          )}
          <label>
            <span>Уровень</span>
            <select value={level} onChange={(event) => setLevel(event.target.value)}>
              <option>простое</option>
              <option>среднее</option>
              <option>сложное</option>
            </select>
          </label>
          <label>
            <span>Минуты</span>
            <input
              type="number"
              min={10}
              max={20}
              value={minutes}
              onChange={(event) => setMinutes(Number(event.target.value))}
            />
          </label>
          <button
            onClick={async () => {
              setError('')
              try {
                const sessionResult = await api.request<{ code: string }>('/api/oral-sessions', {
                  method: 'POST',
                  body: { themeKey: theme.key, level, minutes },
                })
                setCode(sessionResult.code)
              } catch (caught) {
                setError(caught instanceof Error ? caught.message : 'Сессия не открылась')
              }
            }}
          >
            Открыть сессию
          </button>
          {code && (
            <p>
              Код сессии: <strong>{code}</strong>
            </p>
          )}
        </div>
      )}
      {error && <p className="error">{error}</p>}
      {tasks.map((task) => (
        <button key={task.id} className="card" onClick={() => onOpen(task)}>
          <strong>{task.title}</strong>
          <div className="meta">
            {task.mode}, {task.level}
          </div>
          <div>{task.competency}</div>
        </button>
      ))}
    </section>
  )
}

function TaskPage({
  api,
  session,
  task,
  onBack,
}: {
  api: Api
  session: Session
  task: TaskCard
  onBack: () => void
}) {
  const [opened, setOpened] = useState<OpenedTask | null>(null)
  const [answer, setAnswer] = useState('')
  const [verdict, setVerdict] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')

  async function openTask() {
    setError('')
    try {
      const result = await api.request<OpenedTask>(`/api/tasks/${task.id}/open`, {
        method: 'POST',
        body: { teamId: session.teamId },
      })
      setOpened(result)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Задание не открылось')
    }
  }

  return (
    <section className="stack">
      <button className="quiet" onClick={onBack}>
        К теме
      </button>
      <h2>{task.title}</h2>
      <p className="meta">
        {task.mode}, {task.level}. {task.competency}
      </p>
      {task.mode === 'очное' && session.role === 'студент' && (
        <div className="row">
          <input value={code} onChange={(event) => setCode(event.target.value)} placeholder="Код сессии" />
          <button
            onClick={async () => {
              setError('')
              try {
                await api.request('/api/oral-sessions/join', { method: 'POST', body: { code } })
              } catch (caught) {
                setError(caught instanceof Error ? caught.message : 'Код не принят')
              }
            }}
          >
            Войти в сессию
          </button>
        </div>
      )}
      {session.role === 'студент' && <button onClick={() => void openTask()}>Открыть задание</button>}
      {opened && (
        <>
          <pre className="condition">{opened.condition.statement}</pre>
          {session.teamId && <HintBox api={api} taskId={task.id} teamId={session.teamId} />}
          {opened.condition.standUrl && (
            <p>
              Адрес стенда:{' '}
              <a href={opened.condition.standUrl} target="_blank" rel="noreferrer">
                {opened.condition.standUrl}
              </a>
            </p>
          )}
          <label>
            <span>Ответ</span>
            <textarea value={answer} onChange={(event) => setAnswer(event.target.value)} />
          </label>
          <button
            onClick={async () => {
              setError('')
              try {
                const result = await api.request<{ result: string }>(`/api/tasks/${task.id}/submissions`, {
                  method: 'POST',
                  body: { teamId: session.teamId, answer },
                })
                setVerdict(result.result)
              } catch (caught) {
                setError(caught instanceof Error ? caught.message : 'Сдача не прошла')
              }
            }}
          >
            Сдать
          </button>
          {verdict && <p className={verdict === 'зачтено' ? 'ok' : 'bad'}>{verdict}</p>}
        </>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  )
}

function AuthoredList({
  api,
  session,
  onOpen,
}: {
  api: Api
  session: Session
  onOpen: (id: string) => void
}) {
  const [tasks, setTasks] = useState<AuthoredSummary[]>([])
  const [error, setError] = useState('')
  const [draft, setDraft] = useState({
    title: '',
    description: '',
    flag: '',
    instruction: '',
    license: '',
    link: '',
  })

  async function reload() {
    const result = await api.request<{ tasks: AuthoredSummary[] }>('/api/authored-tasks')
    setTasks(result.tasks)
  }

  useEffect(() => {
    void reload().catch((caught: unknown) => {
      setError(caught instanceof Error ? caught.message : 'Список не открылся')
    })
  }, [api])

  return (
    <section className="stack">
      <h2>{session.role === 'преподаватель' ? 'Задачи студентов' : 'Своя задача'}</h2>
      {error && <p className="error">{error}</p>}
      {tasks.map((task) => (
        <button key={task.id} className="card" onClick={() => onOpen(task.id)}>
          <strong>{task.title}</strong>
          <div className="meta">{task.authorName}</div>
        </button>
      ))}
      {session.role === 'студент' && (
        <form
          className="stack"
          onSubmit={async (event) => {
            event.preventDefault()
            setError('')
            try {
              await api.request('/api/authored-tasks', { method: 'POST', body: draft })
              setDraft({ title: '', description: '', flag: '', instruction: '', license: '', link: '' })
              await reload()
            } catch (caught) {
              setError(caught instanceof Error ? caught.message : 'Пакет не принят')
            }
          }}
        >
          <label>
            <span>Название</span>
            <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
          </label>
          <label>
            <span>Описание</span>
            <textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
          </label>
          <label>
            <span>Флаг</span>
            <input value={draft.flag} onChange={(event) => setDraft({ ...draft, flag: event.target.value })} />
          </label>
          <label>
            <span>Инструкция</span>
            <textarea value={draft.instruction} onChange={(event) => setDraft({ ...draft, instruction: event.target.value })} />
          </label>
          <label>
            <span>Лицензия</span>
            <input value={draft.license} onChange={(event) => setDraft({ ...draft, license: event.target.value })} />
          </label>
          <label>
            <span>Ссылка</span>
            <input value={draft.link} onChange={(event) => setDraft({ ...draft, link: event.target.value })} />
          </label>
          <button type="submit">Сдать пакет</button>
        </form>
      )}
    </section>
  )
}

function AuthoredOne({ api, id }: { api: Api; id: string }) {
  const [task, setTask] = useState<AuthoredDetail | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    void api
      .request<AuthoredDetail>(`/api/authored-tasks/${id}`)
      .then(setTask)
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Задача не найдена'))
  }, [api, id])

  if (error) return <p className="error">{error}</p>
  if (!task) return <p className="meta">Загрузка</p>
  return (
    <article className="stack">
      <h2>{task.title}</h2>
      <p className="meta">{task.authorName}</p>
      <p>{task.description}</p>
      <p>{task.instruction}</p>
      <p className="meta">Лицензия: {task.license}</p>
      {task.link && (
        <p>
          <a href={task.link}>{task.link}</a>
        </p>
      )}
      {task.fileName && (
        <pre className="condition">
          {task.fileName}
          {'\n'}
          {task.fileText}
        </pre>
      )}
      <p>Флаг: {task.flag}</p>
    </article>
  )
}

function readSession(): Session | null {
  const raw = sessionStorage.getItem(STORAGE)
  if (!raw) return null
  try {
    return JSON.parse(raw) as Session
  } catch {
    return null
  }
}
