-- 月次作戦ボード Supabase 初期設定SQL
-- これ1本だけを Supabase SQL Editor で実行してください。
-- service_role key / secret key はGitHubへ入れないでください。

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '自分',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null default '個人ボード',
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('admin','member','viewer')),
  created_at timestamptz not null default now(),
  unique(team_id, user_id)
);

create table if not exists public.category_trees (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  tree jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(team_id, owner_id)
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  title text not null,
  category text not null default '未分類',
  project text not null default '未分類',
  task_type text not null default '未分類',
  estimated_minutes integer not null default 30 check (estimated_minutes >= 0),
  schedule_date date,
  carryover_date date,
  due_date date,
  occurrence text not null default 'single' check (occurrence in ('single','daily')),
  status text not null default 'scheduled' check (status in ('scheduled','carryover','done')),
  done boolean not null default false,
  memo text not null default '',
  sort_order bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_team_members_user on public.team_members(user_id);
create index if not exists idx_team_members_team on public.team_members(team_id);
create index if not exists idx_tasks_team_owner on public.tasks(team_id, owner_id);
create index if not exists idx_tasks_schedule on public.tasks(schedule_date);
create index if not exists idx_tasks_carryover on public.tasks(carryover_date);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
drop trigger if exists set_teams_updated_at on public.teams;
create trigger set_teams_updated_at before update on public.teams for each row execute function public.set_updated_at();
drop trigger if exists set_tasks_updated_at on public.tasks;
create trigger set_tasks_updated_at before update on public.tasks for each row execute function public.set_updated_at();
drop trigger if exists set_category_trees_updated_at on public.category_trees;
create trigger set_category_trees_updated_at before update on public.category_trees for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.category_trees enable row level security;
alter table public.tasks enable row level security;

-- 既存ポリシーを作り直しやすいように削除
DROP POLICY IF EXISTS "profiles_select_authenticated" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_self" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_self" ON public.profiles;
DROP POLICY IF EXISTS "teams_select_member" ON public.teams;
DROP POLICY IF EXISTS "teams_insert_self" ON public.teams;
DROP POLICY IF EXISTS "teams_update_admin" ON public.teams;
DROP POLICY IF EXISTS "team_members_select_same_team" ON public.team_members;
DROP POLICY IF EXISTS "team_members_insert_self_or_admin" ON public.team_members;
DROP POLICY IF EXISTS "team_members_update_admin" ON public.team_members;
DROP POLICY IF EXISTS "team_members_delete_admin" ON public.team_members;
DROP POLICY IF EXISTS "category_trees_select_member" ON public.category_trees;
DROP POLICY IF EXISTS "category_trees_insert_owner" ON public.category_trees;
DROP POLICY IF EXISTS "category_trees_update_owner" ON public.category_trees;
DROP POLICY IF EXISTS "category_trees_delete_owner" ON public.category_trees;
DROP POLICY IF EXISTS "tasks_select_team_member" ON public.tasks;
DROP POLICY IF EXISTS "tasks_insert_owner" ON public.tasks;
DROP POLICY IF EXISTS "tasks_update_owner_or_admin" ON public.tasks;
DROP POLICY IF EXISTS "tasks_delete_owner_or_admin" ON public.tasks;

create policy "profiles_select_authenticated"
on public.profiles for select
to authenticated
using (true);

create policy "profiles_insert_self"
on public.profiles for insert
to authenticated
with check (id = auth.uid());

create policy "profiles_update_self"
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy "teams_select_member"
on public.teams for select
to authenticated
using (exists (
  select 1 from public.team_members tm
  where tm.team_id = teams.id and tm.user_id = auth.uid()
));

create policy "teams_insert_self"
on public.teams for insert
to authenticated
with check (created_by = auth.uid());

create policy "teams_update_admin"
on public.teams for update
to authenticated
using (exists (
  select 1 from public.team_members tm
  where tm.team_id = teams.id and tm.user_id = auth.uid() and tm.role = 'admin'
));

create policy "team_members_select_same_team"
on public.team_members for select
to authenticated
using (exists (
  select 1 from public.team_members me
  where me.team_id = team_members.team_id and me.user_id = auth.uid()
));

create policy "team_members_insert_self_or_admin"
on public.team_members for insert
to authenticated
with check (
  user_id = auth.uid()
  or exists (
    select 1 from public.team_members me
    where me.team_id = team_members.team_id and me.user_id = auth.uid() and me.role = 'admin'
  )
);

create policy "team_members_update_admin"
on public.team_members for update
to authenticated
using (exists (
  select 1 from public.team_members me
  where me.team_id = team_members.team_id and me.user_id = auth.uid() and me.role = 'admin'
));

create policy "team_members_delete_admin"
on public.team_members for delete
to authenticated
using (exists (
  select 1 from public.team_members me
  where me.team_id = team_members.team_id and me.user_id = auth.uid() and me.role = 'admin'
));

create policy "category_trees_select_member"
on public.category_trees for select
to authenticated
using (exists (
  select 1 from public.team_members tm
  where tm.team_id = category_trees.team_id and tm.user_id = auth.uid()
));

create policy "category_trees_insert_owner"
on public.category_trees for insert
to authenticated
with check (
  owner_id = auth.uid()
  and exists (
    select 1 from public.team_members tm
    where tm.team_id = category_trees.team_id and tm.user_id = auth.uid()
  )
);

create policy "category_trees_update_owner"
on public.category_trees for update
to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

create policy "category_trees_delete_owner"
on public.category_trees for delete
to authenticated
using (owner_id = auth.uid());

create policy "tasks_select_team_member"
on public.tasks for select
to authenticated
using (exists (
  select 1 from public.team_members tm
  where tm.team_id = tasks.team_id and tm.user_id = auth.uid()
));

create policy "tasks_insert_owner"
on public.tasks for insert
to authenticated
with check (
  owner_id = auth.uid()
  and created_by = auth.uid()
  and exists (
    select 1 from public.team_members tm
    where tm.team_id = tasks.team_id and tm.user_id = auth.uid()
  )
);

create policy "tasks_update_owner_or_admin"
on public.tasks for update
to authenticated
using (
  owner_id = auth.uid()
  or exists (
    select 1 from public.team_members tm
    where tm.team_id = tasks.team_id and tm.user_id = auth.uid() and tm.role = 'admin'
  )
)
with check (
  owner_id = auth.uid()
  or exists (
    select 1 from public.team_members tm
    where tm.team_id = tasks.team_id and tm.user_id = auth.uid() and tm.role = 'admin'
  )
);

create policy "tasks_delete_owner_or_admin"
on public.tasks for delete
to authenticated
using (
  owner_id = auth.uid()
  or exists (
    select 1 from public.team_members tm
    where tm.team_id = tasks.team_id and tm.user_id = auth.uid() and tm.role = 'admin'
  )
);

-- 確認用：このSQL実行後、SupabaseのAuthenticationでユーザー登録をONにしてからサイト側で新規登録してください。
