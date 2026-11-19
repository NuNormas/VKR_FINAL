CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  login TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('студент', 'преподаватель')),
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE team_members ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users (id);

CREATE TABLE IF NOT EXISTS task_passports (
  id TEXT PRIMARY KEY,
  work INTEGER NOT NULL,
  theme_key TEXT NOT NULL,
  title TEXT NOT NULL,
  competency TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('тренажёр', 'очное')),
  format TEXT NOT NULL CHECK (format IN ('командное', 'индивидуальное')),
  level TEXT NOT NULL CHECK (level IN ('простое', 'среднее', 'сложное')),
  generator_id TEXT NOT NULL,
  checker_kind TEXT NOT NULL CHECK (checker_kind IN ('string', 'stand-flag', 'teacher', 'behavior'))
);

CREATE TABLE IF NOT EXISTS oral_sessions (
  id UUID PRIMARY KEY,
  theme_key TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('простое', 'среднее', 'сложное')),
  code TEXT NOT NULL UNIQUE,
  minutes INTEGER NOT NULL CHECK (minutes BETWEEN 10 AND 20),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS oral_session_joins (
  session_id UUID NOT NULL REFERENCES oral_sessions (id),
  user_id UUID NOT NULL REFERENCES users (id),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, user_id)
);

CREATE TABLE IF NOT EXISTS authored_tasks (
  id UUID PRIMARY KEY,
  author_user_id UUID NOT NULL REFERENCES users (id),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  flag TEXT NOT NULL,
  instruction TEXT NOT NULL,
  license TEXT NOT NULL,
  link TEXT,
  file_name TEXT,
  file_body TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (link IS NOT NULL AND file_name IS NULL AND file_body IS NULL)
    OR (link IS NULL AND file_name IS NOT NULL AND file_body IS NOT NULL)
  )
);
