# Royal Flush — folder guide

```
royal-flush/
├── website/     the public storefront (deploy as your main site)
├── crm/         the staff-only CRM console (deploy separately, e.g. crm.yourdomain.com)
└── database/    SQL to run in Supabase — run once, in order
```

## 1. Database

In the Supabase SQL Editor, run these two files **in order**:

1. `database/supabase-setup.sql`
2. `database/supabase-crm-update.sql`

Both are safe to re-run (idempotent) if you ever need to.

To make an account an admin (required to log into the CRM), run once with
their email:

```sql
update public.profiles set is_admin = true
where id = (select id from auth.users where email = 'you@example.com');
```

## 2. Deploying

`website/` and `crm/` are two separate static sites that both talk to the
same Supabase project. Deploy them as siblings (e.g. two folders in the
same host, or two separate subdomains) — the links between them
(`website/admin.html → ../crm/crm.html` and `crm/crm.html → ../website/index.html`)
assume that relative layout. If you deploy them somewhere that doesn't
preserve that relationship, update those two links.

## 3. How the CRM connects to the website

They're not two separate systems wired together — they're two front-ends
reading and writing the **same** Supabase tables:

| CRM page | Reads / writes | 
|---|---|
| Dashboard | `profiles`, `tickets`, `payouts`, `winning_numbers` — live KPIs, 7-day revenue, top sellers, recent orders |
| Orders | `tickets` (joined with `profiles` for buyer name), status editable (paid/pending/refunded) |
| Client Data & Login | `profiles` — every signed-up player, join date, tickets, spend, active/suspended status; plus saved USDT/USDC payout addresses |
| Sales | `tickets` grouped by game — units, revenue, share |
| Today's Tickets & Draw Control | `ticket_counters` + `winning_numbers`; "Announce Winning Numbers" calls the `announce_winning_number()` RPC, "Reset" calls `run_draw_reset()` |
| Email | writes to `email_log` (queues/logs a campaign — connect a real mail provider, e.g. a Supabase Edge Function, to actually send) |
| Getting Paid | `payouts` |

A couple of notes on what "client login details" means here: the anon key
can never read anyone's password (Supabase doesn't expose password
hashes to any client, admin or not) — so the CRM shows account/login
*metadata* (email, join date, active/suspended status, saved payout
addresses), not raw credentials. Suspending a client from the CRM also
blocks them from checking out new tickets, enforced by a real RLS policy,
not just a UI label.

## 4. Getting from the site into the CRM

- `website/admin.html` now has an **"Open Full CRM Console →"** button.
- The account menu (top-right, once logged in as an admin) now shows a
  **"CRM Console"** link alongside "Admin Panel".
- `crm/crm.html`'s login screen links back to the main site for anyone
  who lands there without staff access.
