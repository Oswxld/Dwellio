# Dwellio tenant portal — Stitch V1

Three mobile-first React views based on the supplied Google Stitch HTML:
- Home: live tenant/property/lease snapshot, real outstanding balance **only if** the existing billing RPC is available; M-Pesa button is an explicit *not yet connected* informational dialog.
- My Lease: read-only tenancy terms, current notice state and a real tenant move-out request form calling `submit_move_out_request`; pending/accepted/declined history is shown.
- Personal Information: read-only tenant record, masked identification number and emergency contact.

The Invoices tab is a clearly labeled next-step placeholder. No fake invoices, payments, M-Pesa prompts or support tickets are created.

## Login entry points

The login page provides two selectable experiences backed by **one Supabase Auth** project:

- **Landlord / Manager:** `/login` (or the site root while signed out). Existing sign-in and organization signup remain available.
- **Tenant:** `/tenant/login`. Tenant sign-in uses the same email/password authentication, then enters `/tenant` only when `public.tenants.user_id = auth.uid()`. Tenant registration is **not** offered on this screen in V1.
- A tenant login without a linked tenant record shows an actionable **Tenant access not linked** message rather than starting landlord onboarding.
- A dual-role account can open `/tenant` for the tenant experience and `/` for the landlord dashboard; the selected portal never grants DB permissions by itself.

**First-time tenant access:** A property manager must ensure a verified Supabase auth account exists and is securely associated with the `tenants.user_id` field. This UI change does not implement account claiming, send invitations, create tenant passwords, or change Supabase RLS. Never rely on email text alone to grant access.

## Set up the database first

1. The earlier `supabase/tenant_move_out_requests_v1.sql` migration must be applied to your actual Supabase project. If already applied, **do not blindly rerun it**. That migration includes tenant SELECT RLS and the move-out request RPC.
2. In Supabase SQL Editor, run **`supabase/tenant_portal_profile_v1.sql`**. It adds the authenticated, read-only `get_my_tenant_portal()` RPC. No Edge Function deployment is required.
3. The tenant must have `public.tenants.user_id` linked to the exact `auth.users.id` used to sign in. If it is null, tenant portal access will not be detected. The landlord must link the account through the existing onboarding/claim process. Never assign a user ID just by trusting a phone/email input without verification.
4. Review existing `get_tenant_outstanding_balance(uuid)` behavior before relying on the home balance, especially if a newer invoice carries a prior balance that also remains outstanding on an older invoice. If the helper does not exist, the card shows no numeric balance.

## Pull and run

```bash
git switch main
git pull origin main
npm run build
npm run dev
```

- Tenant-only account: automatically routed to `/tenant` instead of landlord onboarding.
- Landlord account: original dashboard remains at `/`.
- Dual-role account: `/tenant` opens the tenant portal explicitly.

## Smoke test

Sign in as a linked tenant user and test Home, Lease, Profile, bottom tabs and read-only fields. From an **active** lease, submit a future proposed move-out date no later than the lease end date. Verify:
- A `pending` record appears in `move_out_requests`
- Lease and unit status do **not** change on submission
- After landlord approves through the separate RPC, the lease becomes `notice_given`, unit remains `occupied`, and the portal shows the agreed date
- On decline, the decision reason is visible and lease status stays `active`

Do not test with real M-Pesa funds yet. Invoices, payment initiation and backend-confirmed payment receipts belong to the next iteration.

The repository contains UI and SQL, but they are not automatically deployed into your Supabase project. Browser behavior and SQL against your live database still need end-to-end verification.
