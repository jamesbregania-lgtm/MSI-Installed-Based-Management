-- Sales account assigned to a client (Admin > Client Management).
--
-- One column on clients gives the required shape by construction:
--   one client -> at most one sales account (a single value, NULL = unassigned)
--   one sales account -> many clients (the same username on many rows)
--
-- sales_username holds accounts.username (always lowercase). A Sales user only
-- sees clients whose sales_username is their own.
--
-- Run this in the Supabase SQL editor BEFORE deploying the application change.

alter table public.clients
  add column if not exists sales_username text;

create index if not exists clients_sales_username_idx
  on public.clients (sales_username);
