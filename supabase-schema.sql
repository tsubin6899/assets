create table if not exists public.asset_dashboard_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.asset_dashboard_profiles enable row level security;

drop policy if exists "Users can read own dashboard data" on public.asset_dashboard_profiles;
create policy "Users can read own dashboard data"
on public.asset_dashboard_profiles
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own dashboard data" on public.asset_dashboard_profiles;
create policy "Users can insert own dashboard data"
on public.asset_dashboard_profiles
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update own dashboard data" on public.asset_dashboard_profiles;
create policy "Users can update own dashboard data"
on public.asset_dashboard_profiles
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create or replace function public.set_asset_dashboard_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_asset_dashboard_profiles_updated_at on public.asset_dashboard_profiles;
create trigger set_asset_dashboard_profiles_updated_at
before update on public.asset_dashboard_profiles
for each row
execute function public.set_asset_dashboard_updated_at();
