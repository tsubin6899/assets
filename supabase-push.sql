-- Run once in the existing project's SQL editor. Device endpoints remain private.
create table if not exists public.finance_push_subscriptions (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  subscription jsonb not null,
  updated_at timestamptz not null default now(),
  last_notified_date date
);
alter table public.finance_push_subscriptions enable row level security;
revoke all on public.finance_push_subscriptions from anon, authenticated;
grant all on public.finance_push_subscriptions to service_role;
create or replace function public.claim_finance_push_reminder(subscription_id text, notification_date date)
returns boolean language plpgsql security invoker set search_path=public as $$
begin
  update public.finance_push_subscriptions set last_notified_date=notification_date
  where id=subscription_id and (last_notified_date is null or last_notified_date<notification_date);
  return found;
end;
$$;
revoke all on function public.claim_finance_push_reminder(text,date) from public,anon,authenticated;
grant execute on function public.claim_finance_push_reminder(text,date) to service_role;
