-- Журнал активности команды, ступенчатые подсказки и лимит попыток в паспорте.

ALTER TABLE task_passports ADD COLUMN IF NOT EXISTS attempt_limit INTEGER NOT NULL DEFAULT 10;
ALTER TABLE teacher_tasks ADD COLUMN IF NOT EXISTS attempt_limit INTEGER NOT NULL DEFAULT 10;

CREATE TABLE IF NOT EXISTS task_hints (
  task_id TEXT NOT NULL,
  step INTEGER NOT NULL CHECK (step BETWEEN 1 AND 3),
  body TEXT NOT NULL,
  PRIMARY KEY (task_id, step)
);

CREATE TABLE IF NOT EXISTS hint_opens (
  team_id UUID NOT NULL REFERENCES teams (id),
  task_id TEXT NOT NULL,
  step INTEGER NOT NULL,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, task_id, step)
);

CREATE TABLE IF NOT EXISTS activity_log (
  id UUID PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES teams (id),
  task_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('открытие', 'стенд', 'попытка', 'подсказка')),
  fast BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  seq BIGINT GENERATED ALWAYS AS IDENTITY
);

ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS seq BIGINT GENERATED ALWAYS AS IDENTITY;
