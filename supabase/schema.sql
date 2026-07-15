-- TradeHarbor cloud schema — paste into Supabase: SQL Editor → New query → Run.
-- One row per (user, entity). Entities mirror the app's localStorage keys
-- ('trades', 'accounts', 'expenses', …, plus 'shots:<tradeId>' for screenshots).

create table if not exists public.journal_data (
  user_id    uuid not null references auth.users (id) on delete cascade,
  entity     text not null,
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, entity)
);

alter table public.journal_data enable row level security;

-- Each user can only ever touch their own rows.
create policy "read own data"
  on public.journal_data for select
  using (auth.uid() = user_id);

create policy "insert own data"
  on public.journal_data for insert
  with check (auth.uid() = user_id);

create policy "update own data"
  on public.journal_data for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "delete own data"
  on public.journal_data for delete
  using (auth.uid() = user_id);

-- Helpful index for the sync pull (PK already covers user_id+entity;
-- this speeds "everything for this user changed since X" queries).
create index if not exists journal_data_user_updated
  on public.journal_data (user_id, updated_at desc);
