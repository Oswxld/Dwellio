# Dwellio landlord web MVP — vertical slice 1

React + TypeScript + plain CSS + Supabase.

Flow:
Auth → Organization → Property → Buildings → Floors → Visual Units → Dashboard.

## Setup
1. Create a Supabase project.
2. In Supabase SQL Editor, run `supabase/schema.sql`.
3. Copy `.env.example` to `.env` and fill in your project URL and publishable/anon key.
4. Run `npm install`.
5. Run `npm run dev`.

## Supabase Auth
For email confirmation, Supabase Auth may require the user to confirm their email before a session is returned. For quick local MVP testing you can disable email confirmation in the Auth settings, or keep it enabled and confirm the email.

## Current MVP scope
- Email/password landlord sign-up and login.
- Automatic `profiles` row from an Auth trigger.
- Create organization and owner membership.
- Create first property.
- Configure building count/names.
- Configure floors per building with independent unit counts.
- Visual unit builder: bottom floor first, left-to-right; Enter advances to the next unit and then the next floor.
- Save property/building/floor/unit hierarchy to Supabase.
- Basic RLS for organization-scoped access.

The next vertical slice should be Tenant Management + Invitations. Production improvements such as transactions for the multi-table setup operation, audit logs, stronger role/permission modeling, and resumable onboarding can be added after the base flow is validated.
