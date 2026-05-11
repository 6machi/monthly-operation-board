-- タスクかんりシート v18 発生タイプ追加パッチ
-- 毎週・毎月を tasks.occurrence に保存できるようにします。

alter table public.tasks drop constraint if exists tasks_occurrence_check;
alter table public.tasks add constraint tasks_occurrence_check
  check (occurrence in ('single','daily','weekly','monthly'));
