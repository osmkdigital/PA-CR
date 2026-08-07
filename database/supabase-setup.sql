-- =========================================================
-- Royal Flush — Supabase setup
-- Run this once (or re-run any time — every statement below is
-- idempotent) in your project's SQL Editor:
-- https://supabase.com/dashboard/project/voriexbapbrkhrfboqeh/sql/new
--
-- IMPORTANT — this is a DEMO / college-project schema.
-- Every "USDT/USDC" and "payout" field here stores a plain text
-- string the user typed in. Nothing in this schema moves real
-- crypto, checks a balance, or talks to a blockchain. Treat it
-- exactly like a "shipping address" field — just saved text.
-- =========================================================


-- =========================================================
-- 1. PROFILES — one row per auth user
-- =========================================================
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  name       text,
  dob        date,
  tickets    integer not null default 0,
  spent      numeric not null default 0,
  draws      integer not null default 0,
  is_admin   boolean not null default false,
  payout_usdt text,   -- saved USDT address string (display/demo only)
  payout_usdc text,   -- saved USDC address string (display/demo only)
  updated_at timestamptz not null default now()
);

-- add the new columns if this table already existed from before
alter table public.profiles add column if not exists is_admin    boolean not null default false;
alter table public.profiles add column if not exists payout_usdt text;
alter table public.profiles add column if not exists payout_usdc text;

alter table public.profiles enable row level security;

drop policy if exists "Users can view own profile" on public.profiles;
create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- Auto-create a profile row whenever someone signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, name, dob)
  values (
    new.id,
    new.raw_user_meta_data ->> 'name',
    nullif(new.raw_user_meta_data ->> 'dob', '')::date
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();


-- =========================================================
-- 2. is_admin() helper — used by every admin-only RLS policy.
--    security definer so it can read profiles.is_admin without
--    getting tangled in the RLS policy that's checking it.
-- =========================================================
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

drop policy if exists "Admins can view all profiles" on public.profiles;
create policy "Admins can view all profiles"
  on public.profiles for select
  using (public.is_admin());

-- Guard rail: a normal user updating their own profile row (e.g. to
-- save a payout address) can NEVER flip their own is_admin to true.
-- Only a direct SQL-editor update (no auth.uid() in that context) or
-- another admin's session can change it.
create or replace function public.protect_is_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    new.is_admin := old.is_admin;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_is_admin on public.profiles;
create trigger trg_protect_is_admin
  before update on public.profiles
  for each row execute procedure public.protect_is_admin();

-- To make a user an admin, run this once with their email:
--   update public.profiles set is_admin = true
--   where id = (select id from auth.users where email = 'you@example.com');


-- =========================================================
-- 3. TICKET_COUNTERS — one row per game, tracks the next number
--    to hand out. Reset to 1 after each draw.
-- =========================================================
create table if not exists public.ticket_counters (
  game_type   text primary key,
  prefix      text not null,
  next_number integer not null default 1
);

insert into public.ticket_counters (game_type, prefix, next_number) values
  ('royal-flush', 'RF', 1),
  ('dagger',      'DG', 1),
  ('jack',        'JA', 1),
  ('joker',       'JK', 1),
  ('king',        'K',  1),
  ('queen',       'Q',  1),
  ('straight',    'ST', 1),
  ('red-dragon',  'RD', 1),
  ('black-dragon','BD', 1),
  ('x-card',      'X',  1),
  ('redeemed',    'FR', 1)  -- free tickets redeemed via a code on draw.html
on conflict (game_type) do nothing;

alter table public.ticket_counters enable row level security;

drop policy if exists "Admins can view counters" on public.ticket_counters;
create policy "Admins can view counters"
  on public.ticket_counters for select
  using (public.is_admin());
-- no insert/update/delete policy for anyone — the only way counters
-- change is through the next_ticket_code() / run_draw_reset()
-- functions below, which run as security definer.


-- =========================================================
-- 4. TICKETS — one row per ticket a player owns
-- =========================================================
create table if not exists public.tickets (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  game_type    text not null references public.ticket_counters(game_type),
  ticket_code  text not null unique,
  price        numeric not null default 0,
  is_winner    boolean not null default false,
  seen         boolean not null default false,
  purchased_at timestamptz not null default now()
);

create index if not exists tickets_user_id_idx on public.tickets(user_id);
create index if not exists tickets_game_type_idx on public.tickets(game_type);

alter table public.tickets enable row level security;

drop policy if exists "Users can view own tickets" on public.tickets;
create policy "Users can view own tickets"
  on public.tickets for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own tickets" on public.tickets;
create policy "Users can insert own tickets"
  on public.tickets for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can mark own tickets seen" on public.tickets;
create policy "Users can mark own tickets seen"
  on public.tickets for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Admins can view all tickets" on public.tickets;
create policy "Admins can view all tickets"
  on public.tickets for select
  using (public.is_admin());

drop policy if exists "Admins can update all tickets" on public.tickets;
create policy "Admins can update all tickets"
  on public.tickets for update
  using (public.is_admin());


-- =========================================================
-- 5. DRAWS — a log entry every time an admin resets a game
-- =========================================================
create table if not exists public.draws (
  id        uuid primary key default gen_random_uuid(),
  game_type text not null,   -- the game reset, or 'ALL'
  reset_at  timestamptz not null default now(),
  reset_by  uuid references auth.users(id)
);

alter table public.draws enable row level security;

drop policy if exists "Admins can view draws" on public.draws;
create policy "Admins can view draws"
  on public.draws for select
  using (public.is_admin());


-- =========================================================
-- 6. next_ticket_code(game_type) — atomically hands out the
--    next ticket code for a game, e.g. 'RF001', 'RF002', ...
--    Called once per ticket from the checkout flow.
-- =========================================================
create or replace function public.next_ticket_code(p_game_type text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text;
  v_num    integer;
begin
  update public.ticket_counters
     set next_number = next_number + 1
   where game_type = p_game_type
   returning prefix, next_number - 1 into v_prefix, v_num;

  if v_prefix is null then
    raise exception 'Unknown game type: %', p_game_type;
  end if;

  return v_prefix || lpad(v_num::text, 3, '0');
end;
$$;

grant execute on function public.next_ticket_code(text) to authenticated;


-- =========================================================
-- 7. run_draw_reset(game_type) — admin only. Resets one game's
--    counter back to 1, or ALL games if no game_type is passed.
--    Existing tickets are untouched — only the numbering resets
--    so the next draw starts back at 001.
-- =========================================================
create or replace function public.run_draw_reset(p_game_type text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can reset a draw';
  end if;

  if p_game_type is null then
    update public.ticket_counters set next_number = 1;
    insert into public.draws (game_type, reset_by) values ('ALL', auth.uid());
  else
    update public.ticket_counters set next_number = 1 where game_type = p_game_type;
    insert into public.draws (game_type, reset_by) values (p_game_type, auth.uid());
  end if;
end;
$$;

grant execute on function public.run_draw_reset(text) to authenticated;

-- =========================================================
-- 8. new insertion.
-- =========================================================

insert into public.profiles (id, name, dob)
select u.id,
       u.raw_user_meta_data ->> 'name',
       nullif(u.raw_user_meta_data ->> 'dob', '')::date
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;
