-- Отметка «верный путь» на сложном очном задании. На лимит попыток не влияет.

CREATE TABLE IF NOT EXISTS oral_path_marks (
  team_id UUID NOT NULL REFERENCES teams (id),
  task_id TEXT NOT NULL,
  marked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, task_id)
);
