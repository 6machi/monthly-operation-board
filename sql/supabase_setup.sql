-- 月次作戦ボード Supabase 初期設定SQL v4
-- これ1本を Supabase SQL Editor で実行してください。
-- public側の月次作戦ボード用テーブルを作り直します。
-- Authのユーザー自体は削除しません。
-- v4: bootstrap_my_board() を returns void に変更し、team_id の曖昧参照エラーを回避します。

create extension if not exists pgcrypto;

-- 既存の試作用テーブルを作り直す
-- 本運用前の初期セットアップ用です。既存タスクがある場合は消えます。
drop table if exists public.tasks cascade;
drop table if exists public.category_trees cascade;
drop table if exists public.team_members cascade;
drop table if exists public.teams cascade;
drop table if exists public.profiles cascade;

drop function if exists public.set_updated_at() cascade;
drop function if exists public.is_team_member(uuid) cascade;
drop function if exists public.is_team_admin(uuid) cascade;
drop function if exists public.is_team_creator(uuid) cascade;
drop function if exists public.bootstrap_my_board() cascade;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '自分',
  display_emoji text not null default '🌙',
  display_color text not null default '#5d9cec',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null default '個人ボード',
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('admin','member','viewer')),
  created_at timestamptz not null default now(),
  unique(team_id, user_id)
);

create table public.category_trees (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  tree jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(team_id, owner_id)
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete cascade,
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

create index idx_team_members_user on public.team_members(user_id);
create index idx_team_members_team on public.team_members(team_id);
create index idx_tasks_team_owner on public.tasks(team_id, owner_id);
create index idx_tasks_schedule on public.tasks(schedule_date);
create index idx_tasks_carryover on public.tasks(carryover_date);

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

create trigger set_profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger set_teams_updated_at before update on public.teams for each row execute function public.set_updated_at();
create trigger set_tasks_updated_at before update on public.tasks for each row execute function public.set_updated_at();
create trigger set_category_trees_updated_at before update on public.category_trees for each row execute function public.set_updated_at();

-- RLSポリシー内でteam_membersを直接参照すると再帰エラーになることがあるため、
-- SECURITY DEFINER関数経由で確認します。
create or replace function public.is_team_member(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.team_members tm
    where tm.team_id = p_team_id
      and tm.user_id = auth.uid()
  );
$$;

create or replace function public.is_team_admin(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.team_members tm
    where tm.team_id = p_team_id
      and tm.user_id = auth.uid()
      and tm.role = 'admin'
  );
$$;

create or replace function public.is_team_creator(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.teams t
    where t.id = p_team_id
      and t.created_by = auth.uid()
  );
$$;

-- 初回ログイン時の自分用ボード作成関数。
-- クライアントから直接 teams/team_members を作ると、RLS順序で弾かれることがあるため関数化。
create or replace function public.bootstrap_my_board()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_display_name text;
  v_team_id uuid;
  v_default_tree jsonb := '[
    {"name":"かいまほケット2026","color":"#e8a6c8","memo":"イベント・制作系","projects":[{"name":"ハッキング合宿","types":[{"name":"原稿制作","tasks":["清書・トーン張り","校正反映","入稿準備"]}]}]},
    {"name":"仕事","color":"#5d9cec","memo":"会社・業務委託","projects":[{"name":"通常業務","types":[{"name":"連絡","tasks":["進捗報告","確認依頼","返信作成"]},{"name":"チェック","tasks":["タテヨコ確認","資料確認","差し戻し確認"]}]}]},
    {"name":"プライベート","color":"#63b978","memo":"生活・通院・休息","projects":[{"name":"生活","types":[{"name":"体調管理","tasks":["通院","薬確認","8時間寝る"]},{"name":"家事","tasks":["洗濯","片付け","買い出し"]}]}]},
    {"name":"差し込みタスク","color":"#f5a623","memo":"急な依頼・即対応","projects":[{"name":"差し込み","types":[{"name":"即対応","tasks":["急ぎ対応"]}]}]}
  ]'::jsonb;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  select email into v_email from auth.users where id = v_user;
  v_display_name := coalesce(nullif(split_part(v_email, '@', 1), ''), '自分');

  insert into public.profiles(id, display_name, display_emoji, display_color)
  values (v_user, v_display_name, '🌙', '#5d9cec')
  on conflict (id) do update
    set display_name = case
      when public.profiles.display_name = v_email then excluded.display_name
      when public.profiles.display_name like '%@%' then excluded.display_name
      else public.profiles.display_name
    end;

  select tm.team_id into v_team_id
  from public.team_members tm
  where tm.user_id = v_user
  order by tm.created_at asc
  limit 1;

  if v_team_id is null then
    insert into public.teams(name, created_by)
    values ('個人ボード', v_user)
    returning id into v_team_id;

    insert into public.team_members(team_id, user_id, role)
    values (v_team_id, v_user, 'admin')
    on conflict (team_id, user_id) do nothing;
  end if;

  insert into public.category_trees(team_id, owner_id, tree)
  values (v_team_id, v_user, v_default_tree)
  on conflict (team_id, owner_id) do nothing;

  return;
end;
$$;

alter table public.profiles enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.category_trees enable row level security;
alter table public.tasks enable row level security;

create policy profiles_select_authenticated
on public.profiles for select
to authenticated
using (true);

create policy profiles_insert_self
on public.profiles for insert
to authenticated
with check (id = auth.uid());

create policy profiles_update_self
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy teams_select_member
on public.teams for select
to authenticated
using (public.is_team_member(id));

create policy teams_insert_self
on public.teams for insert
to authenticated
with check (created_by = auth.uid());

create policy teams_update_admin
on public.teams for update
to authenticated
using (public.is_team_admin(id))
with check (public.is_team_admin(id));

create policy team_members_select_own_or_team_member
on public.team_members for select
to authenticated
using (
  user_id = auth.uid()
  or public.is_team_member(team_id)
);

create policy team_members_insert_admin
on public.team_members for insert
to authenticated
with check (public.is_team_admin(team_id));

create policy team_members_update_admin
on public.team_members for update
to authenticated
using (public.is_team_admin(team_id))
with check (public.is_team_admin(team_id));

create policy team_members_delete_admin
on public.team_members for delete
to authenticated
using (public.is_team_admin(team_id));

create policy category_trees_select_member
on public.category_trees for select
to authenticated
using (public.is_team_member(team_id));

create policy category_trees_insert_owner
on public.category_trees for insert
to authenticated
with check (
  owner_id = auth.uid()
  and public.is_team_member(team_id)
);

create policy category_trees_update_owner
on public.category_trees for update
to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

create policy category_trees_delete_owner
on public.category_trees for delete
to authenticated
using (owner_id = auth.uid());

create policy tasks_select_team_member
on public.tasks for select
to authenticated
using (public.is_team_member(team_id));

create policy tasks_insert_owner
on public.tasks for insert
to authenticated
with check (
  owner_id = auth.uid()
  and created_by = auth.uid()
  and public.is_team_member(team_id)
);

create policy tasks_update_owner_or_admin
on public.tasks for update
to authenticated
using (
  owner_id = auth.uid()
  or public.is_team_admin(team_id)
)
with check (
  owner_id = auth.uid()
  or public.is_team_admin(team_id)
);

create policy tasks_delete_owner_or_admin
on public.tasks for delete
to authenticated
using (
  owner_id = auth.uid()
  or public.is_team_admin(team_id)
);

-- Supabase APIからアクセスできるように権限を付与します。
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.teams to authenticated;
grant select, insert, update, delete on public.team_members to authenticated;
grant select, insert, update, delete on public.category_trees to authenticated;
grant select, insert, update, delete on public.tasks to authenticated;
grant execute on function public.is_team_member(uuid) to authenticated;
grant execute on function public.is_team_admin(uuid) to authenticated;
grant execute on function public.is_team_creator(uuid) to authenticated;
grant execute on function public.bootstrap_my_board() to authenticated;

-- PostgRESTのスキーマキャッシュ更新
notify pgrst, 'reload schema';
