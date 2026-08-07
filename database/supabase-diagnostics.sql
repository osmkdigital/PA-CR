-- =========================================================
-- Royal Flush — diagnostics
-- Run this in the SQL Editor and paste back the results (or a
-- screenshot). It tells us exactly what's missing, instead of
-- guessing.
-- =========================================================

-- 1. Which of our tables actually exist?
select table_name
from information_schema.tables
where table_schema = 'public'
order by table_name;
-- expect: draws, email_log, payouts, profiles, ticket_counters, tickets, winning_numbers

-- 2. Does your account have is_admin = true?
--    (replace the email — this is the #1 reason the CRM shows nothing)
select id, email, is_admin, status
from public.profiles
where email = 'PUT-YOUR-LOGIN-EMAIL-HERE';

-- 3. Do the admin-visibility policies exist?
select schemaname, tablename, policyname
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

-- 4. Are there actually any tickets in the table at all?
select count(*) as ticket_count from public.tickets;
select * from public.tickets order by purchased_at desc limit 5;
