-- Задание, которое преподаватель собрал в интерфейсе.
-- Секрет лежит здесь и не входит в каталог генераторов.

CREATE TABLE IF NOT EXISTS teacher_tasks (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL,
  theme_key TEXT NOT NULL,
  competency TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('тренажёр', 'очное')),
  level TEXT NOT NULL CHECK (level IN ('простое', 'среднее', 'сложное')),
  statement TEXT NOT NULL,
  checker TEXT NOT NULL CHECK (checker IN ('флаг', 'строка', 'патч')),
  secret TEXT NOT NULL,
  author_user_id UUID NOT NULL REFERENCES users (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
