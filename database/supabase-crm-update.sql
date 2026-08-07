-- =========================================================
-- Royal Flush — CRM update
-- Run this AFTER supabase-setup.sql, once (or re-run any time —
-- every statement below is idempotent) in your project's SQL Editor:
-- https://supabase.com/dashboard/project/voriexbapbrkhrfboqeh/sql/new
--
-- Adds everything the CRM console (crm.html) needs on top of the
-- base schema: client email/status/join-date, a "today's winning
-- number" board that both the CRM and the public site can read,
-- an order status field, and simple payouts / email-log tables so
-- the "Getting Paid" and "Email" pages persist real rows instead of
-- fake in-memory data.
-- =========================================================


-- =========================================================
-- 1. PROFILES — email, status, join date
-- =========================================================
alter table public.profiles add column if not exists email      text;
alter table public.profiles add column if not exists status     text not null default 'active';
alter table public.profiles add column if not exists created_at timestamptz not null default now();

alter table public.profiles drop constraint if exists profiles_status_check;
alter table public.profiles add constraint profiles_status_check check (status in ('active','suspended'));

-- backfill email + a real join date for any row that predates this migration
update public.profiles p
set email      = u.email,
    created_at = least(p.created_at, u.created_at)
from auth.users u
where u.id = p.id and (p.email is null or p.email = '');

-- keep new signups' email in profiles automatically (dob/name insert already existed)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, name, dob, email)
  values (
    new.id,
    new.raw_user_meta_data ->> 'name',
    nullif(new.raw_user_meta_data ->> 'dob', '')::date,
    new.email
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- admins can now update OTHER people's profile rows too (e.g. flip
-- status to 'suspended' from the CRM). protect_is_admin() still stops
-- anyone from granting themselves admin through this.
drop policy if exists "Admins can update all profiles" on public.profiles;
create policy "Admins can update all profiles"
  on public.profiles for update
  using (public.is_admin());

-- a suspended client can no longer check out new tickets (real
-- enforcement, not just a CRM label)
drop policy if exists "Users can insert own tickets" on public.tickets;
create policy "Users can insert own tickets"
  on public.tickets for insert
  with check (
    auth.uid() = user_id
    and coalesce((select status from public.profiles where id = auth.uid()), 'active') = 'active'
  );


-- =========================================================
-- 2. TICKETS — order status (paid / pending / refunded)
--    Every ticket is inserted as 'paid' today (checkout only ever
--    writes a ticket row after "payment" is confirmed) but admins
--    can flip it from the CRM's Orders page.
-- =========================================================
alter table public.tickets add column if not exists status text not null default 'paid';
alter table public.tickets drop constraint if exists tickets_status_check;
alter table public.tickets add constraint tickets_status_check check (status in ('paid','pending','refunded'));


-- =========================================================
-- 3. WINNING_NUMBERS — one row per game per draw day.
--    Publicly readable (so the site can show "today's number"),
--    but only writable through announce_winning_number() below,
--    which is admin-gated.
-- =========================================================
create table if not exists public.winning_numbers (
  game_type    text not null references public.ticket_counters(game_type),
  draw_date    date not null default current_date,
  number       text not null,
  announced_at timestamptz not null default now(),
  announced_by uuid references auth.users(id),
  primary key (game_type, draw_date)
);

alter table public.winning_numbers enable row level security;

drop policy if exists "Anyone can view winning numbers" on public.winning_numbers;
create policy "Anyone can view winning numbers"
  on public.winning_numbers for select
  using (true);
-- intentionally no insert/update/delete policy — writes only ever
-- happen through the security-definer function below.

create or replace function public.announce_winning_number(p_game_type text, p_number text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can announce a winning number';
  end if;

  insert into public.winning_numbers (game_type, draw_date, number, announced_by)
  values (p_game_type, current_date, p_number, auth.uid())
  on conflict (game_type, draw_date)
  do update set number = excluded.number, announced_at = now(), announced_by = excluded.announced_by;
end;
$$;

grant execute on function public.announce_winning_number(text, text) to authenticated;


-- =========================================================
-- 4. PAYOUTS — "Getting Paid" page, admin only.
-- =========================================================
create table if not exists public.payouts (
  id           uuid primary key default gen_random_uuid(),
  amount       numeric not null,
  wallet       text not null,
  status       text not null default 'pending',
  note         text,
  requested_by uuid references auth.users(id),
  requested_at timestamptz not null default now()
);

alter table public.payouts drop constraint if exists payouts_status_check;
alter table public.payouts add constraint payouts_status_check check (status in ('pending','paid'));

alter table public.payouts enable row level security;

drop policy if exists "Admins can view payouts" on public.payouts;
create policy "Admins can view payouts" on public.payouts for select using (public.is_admin());
drop policy if exists "Admins can insert payouts" on public.payouts;
create policy "Admins can insert payouts" on public.payouts for insert with check (public.is_admin());
drop policy if exists "Admins can update payouts" on public.payouts;
create policy "Admins can update payouts" on public.payouts for update using (public.is_admin());


-- =========================================================
-- 5. EMAIL_LOG — "Email" page, admin only. Records that a campaign
--    was queued from the CRM. Sending the actual email still needs
--    a mail provider wired up separately (e.g. a Supabase Edge
--    Function) — this table just gives the log something real to
--    persist instead of resetting on every page reload.
-- =========================================================
create table if not exists public.email_log (
  id       uuid primary key default gen_random_uuid(),
  subject  text not null,
  audience text not null,
  sent_by  uuid references auth.users(id),
  sent_at  timestamptz not null default now()
);

alter table public.email_log enable row level security;

drop policy if exists "Admins can view email log" on public.email_log;
create policy "Admins can view email log" on public.email_log for select using (public.is_admin());
drop policy if exists "Admins can insert email log" on public.email_log;
create policy "Admins can insert email log" on public.email_log for insert with check (public.is_admin());
