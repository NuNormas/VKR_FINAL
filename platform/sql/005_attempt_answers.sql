-- Текст сдачи и кто её отправил. Секрет варианта по-прежнему в task_issues.

ALTER TABLE attempts ADD COLUMN IF NOT EXISTS answer TEXT;
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS submitter_user_id UUID REFERENCES users (id);
