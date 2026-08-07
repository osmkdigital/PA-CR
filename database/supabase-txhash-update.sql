-- =========================================================
-- Royal Flush — transaction hash update
-- Run this once (idempotent — safe to re-run) in your project's
-- SQL Editor:
-- https://supabase.com/dashboard/project/voriexbapbrkhrfboqeh/sql/new
--
-- Adds a tx_hash column to tickets so the hash a client pastes on
-- checkout.html is saved with their order and shows up in the CRM
-- Orders page for payment verification.
-- =========================================================

alter table public.tickets add column if not exists tx_hash text;
