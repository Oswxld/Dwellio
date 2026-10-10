# Dwellio tenant portal — Stitch V1

Three mobile-first React views based on the supplied Google Stitch HTML:
- Home: live tenant/property/lease snapshot, real outstanding balance **only if** the existing billing RPC is available; M-Pesa button is an explicit *not yet connected* informational dialog.
- My Lease: read-only tenancy terms, current notice state and a real tenant move-out request form calling `submit_move_out_request`; pending/accepted/declined history is shown.
- Personal Information: read-only tenant record, masked identification number and emergency contact.

The Invoices tab is a clearly labeled next-step placeholder. No fake invoices, payments, M-Pesa prompts or support tickets are created.

## Tenant signup, email confirmation and automatic linking

Landlords and tenants use the same Supabase Auth project but enter through different sign-in URLs:

- **Landlord/manager:** `/login`. The existing property manager sign-in and signup remain unchanged.
- **Tenant:** `/tenant/login`. The tenant first enters the same email their landlord registered on `public.tenants.email`. The next view offers **Sign in** or **Create account**, using that email.
- **Tenant signup:** Sign up with a password, then follow the email confirmation link. `AuthPage` sets `emailRedirectTo` to `<site-origin>/tenant/login`; if Supabase establishes a session on confirmation, the app can automatically continue. Otherwise, the tenant signs in normally.
- **After a confirmed login:** `App.tsx` calls `public.claim_tenant_account()`. The security-definer function reads the **verified email in `auth.users`** using `auth.uid()`, finds matching active `public.tenants` records case-insensitively, updates `tenants.user_id` if still null, and returns `linked_user_id` and tenant IDs. No browser-provided email or user ID is used to claim a tenant.
- **No matching email:** The user sees **Tenant email not registered** and must ask their property manager to register the correct email. If a matching tenancy is already linked to a different Auth user, the function will not transfer it.
- **After linking:** Authorization and the tenant portal continue to use `tenants.user_id = auth.uid()`; the original tenant record remains otherwise unchanged. Accounts with both tenant and landlord permissions may use both portals.

**Security note:** A public/unauthenticated screen cannot safely discover whether an email already belongs to a Supabase account (account-enumeration risk). The first step only collects the email; the next step offers sign-in and signup, and the server does the tenant lookup after email verification. Do not run the older `claim_tenant_account()` function that only checked email without requiring `auth.users.email_confirmed_at`.

### Supabase Auth settings required

1. In **Supabase → Authentication → Providers → Email**, ensure **Confirm email** is enabled.
2. In **Supabase → Authentication → URL Configuration**, add the development callback **`http://localhost:5173/tenant/login`** and the production tenant login URL **`https://YOUR-DOMAIN/tenant/login`** to the allowed **Redirect URLs**. Set **Site URL** to the appropriate production domain.
3. Confirm that the signup email template includes a working `{{ .ConfirmationURL }}` link, or a correctly configured custom `{{ .RedirectTo }}` link. The tenant app is a single-page application, so the production host must serve its `index.html` for the tenant login route.
4. Configure a suitable SMTP/email sender for reliable confirmation emails in production; check spam during testing.

## Set up the database first

1. The earlier `supabase/tenant_move_out_requests_v1.sql` migration must be applied to your actual Supabase project. If already applied, **do not blindly rerun it**. That migration includes tenant SELECT RLS and the move-out request RPC.
2. In Supabase SQL Editor, run **`supabase/tenant_portal_profile_v1.sql`**. It adds the authenticated, read-only `get_my_tenant_portal()` RPC. No Edge Function deployment is required.
3. In Supabase SQL Editor, run **`supabase/tenant_email_claim_v1.sql`**. This replaces any earlier `claim_tenant_account()` function with a verified-email-only implementation. The tenant's landlord must have registered their email in the `tenants` table, but does **not** need to copy the Auth user ID manually. **Apply this migration before testing tenant sign-in after updating the frontend.**
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
