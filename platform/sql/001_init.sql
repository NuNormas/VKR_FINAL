-- Учёт среза. Секрет варианта лежит только здесь и в процесс чекера не уходит клиенту.

CREATE TABLE IF NOT EXISTS teams (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS team_members (
  id UUID PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES teams (id),
  display_name TEXT NOT NULL,
  position INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS theme_windows (
  theme_key TEXT PRIMARY KEY,
  phase TEXT NOT NULL CHECK (phase IN ('закрыта', 'открыта', 'закончилась'))
);

CREATE TABLE IF NOT EXISTS task_issues (
  id UUID PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES teams (id),
  task_id TEXT NOT NULL,
  seed TEXT NOT NULL,
  secret TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (team_id, task_id)
);

CREATE INDEX IF NOT EXISTS task_issues_task_secret_idx
  ON task_issues (task_id, secret);

CREATE TABLE IF NOT EXISTS attempts (
  id UUID PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES teams (id),
  task_id TEXT NOT NULL,
  accepted BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS foreign_answer_incidents (
  id UUID PRIMARY KEY,
  task_id TEXT NOT NULL,
  submitter_team_id UUID NOT NULL REFERENCES teams (id),
  owner_team_id UUID NOT NULL REFERENCES teams (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
