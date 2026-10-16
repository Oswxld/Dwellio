# Dwellio dashboard & complete property structure setup

## What's on the dashboard

- Main navigation: **Dashboard, Properties, Tenants, Billing**, plus Payment Settings.
  Unfinished Maintenance, Leases, Staff, Announcements, Reports and Documents
  tabs and modules are hidden until those modules are implemented.
- Topbar has **no mock search or notification buttons**.
- The dashboard's **Expected this month**, **Outstanding** and **Collected**
  cards use `get_landlord_dashboard_financials` for the selected billing month.
- **Expected** matches the sum of `bill_drafts.total_payable` for the month’s
  **finalized, non-void invoices** — the same source as Billing's
  **Total invoiced**, given the current live `invoices` schema.
- **Outstanding** comes directly from `invoices.outstanding_amount` for those
  same invoices and month. **Collected = Expected − Outstanding**, as requested.
  This is NOT total cash paid during the calendar month (late payment of old
  invoices is not included). It is the collection progress on that invoice set.
- Metrics aggregate the organization's properties for the selected month;
  Billing shows the figures for one property at a time.
- The quick Add menu supports **Add tenant**, **building + floor + units**,
  **floor + units**, and **units under an existing floor**.
  Organization-member invitations are hidden.
- Property entries are clickable and open `/properties/:propertyId`.
- Mobile layout has a working hamburger menu.
- Existing lease/maintenance/operations placeholder cards are removed.

## SQL setup in Supabase (required before using the new features)

Deployment status in the connected **Dwellio** Supabase project:

1. `supabase/dashboard_financials_v2.sql` — **INSTALLED AND TESTED**.
   - Installs `get_landlord_dashboard_financials(p_organization_id uuid,
     p_period_start date)` using SECURITY INVOKER and existing RLS policies.
   - Requires an active owner/admin/manager of the requested organization.
   - Compares monthly finalized invoices by joining `properties`,
     `billing_cycles`, `bill_drafts` and `invoices`.
   - Does not affect payments, outstanding balances, tables or other RPCs.
   - October 2026 verified as 2 finalized invoices: Expected KSh 14,904,
     Outstanding KSh 14,904 and Collected KSh 0. An authenticated owner
     session and the empty September 2026 month were also verified.

2. `supabase/dashboard_property_quick_add_v1.sql` — **INSTALLED AND TESTED**.
   - Installs **three independent RPCs**, each with its own parameter signature:
     `dashboard_add_building_with_floor_units` (property, building name, floor details, unit list);
     `dashboard_add_floor_with_units` (property, existing building, floor details, unit list);
     `dashboard_add_units` (property, building, existing floor, unit list).
   - The interactive dashboard Add menu fetches properties, buildings and floors
     directly from Supabase and presents them in the step-by-step creation modal.
   - No building or floor is created without units. Entire creation rolls back
     if validation/insertion fails.
   - Uses existing authenticated landlord/manager RLS rules, unit defaults and
     `sync_unit_property_id_trigger`.
   - TESTED in a transaction using an authenticated owner, covering all
     three operations, unit property ID/status defaults, cross-building rejection
     and empty-unit validation. **Test inserts were rolled back.**
   - All existing property tables, constraints and policies were preserved.

`supabase/property_structure_bundle_v1.sql` (old combined RPC) was removed
from the feature branch because it was never installed and has now been
superseded by these three distinct RPCs. Do not run the obsolete migration.

## Test cases

1. Select the current month on the dashboard. Compare **Expected** to the sum
   of **Total invoiced** on Billing Step 5 for all properties for that month.
2. Verify **Outstanding** equals the non-void outstanding amounts for those
   exact invoices and **Collected** equals Expected minus Outstanding.
3. Select a month with no finalized invoices; all three financial amounts
   should be KSh 0.00.
4. Click a property row; it should open that property's details.
5. From the dashboard Add menu choose Add building; pick a property **inside
   the modal**, then enter building, floor and 2+ units.
6. Add a floor: pick property, then building, then enter floor and 2+ units.
7. Add units: pick property, building, existing floor, and enter units.
   Verify that a floor/building with no units cannot be created and that
   duplicate names, invalid rents and wrong parent IDs are rejected.
8. Verify landlord authentication, tenant enrollment and password-based login,
   desktop navigation and mobile navigation.

## Vercel deployment (after merging/testing)

The repository includes `vercel.json` so direct links like
`/properties/...`, `/tenants/...`, and `/tenant/login` load the SPA.

For a GitHub-based Vercel project, choose **Framework Preset: Vite**,
**Build Command: `npm run build`** and **Output Directory: `dist`**.
In Vercel → Project → Settings → Environment Variables add:

- `VITE_SUPABASE_URL` = existing Supabase Project URL
- `VITE_SUPABASE_ANON_KEY` = existing Supabase publishable/anon key

Do **not** put your Supabase service-role key or Africa's Talking API key into
Vite environment variables; only public Supabase keys belong in the browser.

After Vercel assigns your production HTTPS domain, go to
**Supabase → Authentication → URL Configuration**:

- **Site URL**: `https://YOUR-DOMAIN`
- **Redirect URLs**: `https://YOUR-DOMAIN/**` and your local development
  URL (usually `http://localhost:5173/**`).
- Your tenant account confirmation code redirects to
  `https://YOUR-DOMAIN/tenant/login`, which must be allowlisted.
- Keep preview URLs on an allowlist only if you actually test auth on previews;
  prefer explicit production URLs rather than a broad wildcard.

Deploy the same branch you actually tested. A draft PR does not automatically
change Vercel's production deployment, which normally follows `main`.
