-- TaskPulse database setup. Paste into Supabase > SQL Editor > New query > Run. Safe to run more than once.
create table if not exists public.tasks (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title        text not null check (char_length(title) between 1 and 80),
  description  text not null default '' check (char_length(description) <= 300),
  category     text not null default 'Work'   check (category in ('Work', 'Personal', 'Study')),
  priority     text not null default 'Medium' check (priority in ('High', 'Medium', 'Low')),
  due_date     date,
  status       text not null default 'active' check (status in ('active', 'completed')),
  position     integer not null default 0,
  completed_at timestamptz,                       -- used by the weekly activity chart
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists tasks_user_position_idx on public.tasks (user_id, position);

create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at before update on public.tasks
  for each row execute function public.set_updated_at();

-- Row Level Security: every row is visible and editable only by its owner.
alter table public.tasks enable row level security;
drop policy if exists "tasks_select_own" on public.tasks;
drop policy if exists "tasks_insert_own" on public.tasks;
drop policy if exists "tasks_update_own" on public.tasks;
drop policy if exists "tasks_delete_own" on public.tasks;
create policy "tasks_select_own" on public.tasks for select to authenticated using (auth.uid() = user_id);
create policy "tasks_insert_own" on public.tasks for insert to authenticated with check (auth.uid() = user_id);
create policy "tasks_update_own" on public.tasks for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "tasks_delete_own" on public.tasks for delete to authenticated using (auth.uid() = user_id);
-- No policy exists for the anonymous role, so logged-out visitors can read and write nothing.
