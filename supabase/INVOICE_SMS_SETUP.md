# Dwellio invoice SMS delivery (Step 6)

This is **SMS invoice summary delivery**, not PDF attachment delivery. The messages contain the invoice reference, total amount, due date, and property name. Financial invoice status and balances are not changed.

## 1. Deploy the database migration

In Supabase Dashboard → SQL Editor, run the entire file:

`supabase/invoice_sms_delivery.sql`

The migration adds:

- `invoice_sms_deliveries`, one delivery record per invoice
- manager-only read access via RLS
- `claim_invoice_sms_delivery(invoice_id, environment, actor_id)`, a service-role-only function that verifies property membership, finalized invoice status, and prevents duplicate submission

You must also have already applied the earlier migration that creates `invoices.phone` and `finalize_billing_cycle_with_phones(uuid)`.

## 2. Deploy the Edge Function

In Supabase Dashboard → Edge Functions → Deploy a new function → Via Editor:

- Name it exactly `send-invoices`
- Use code from `supabase/functions/send-invoices/index.ts`
- Keep authentication / JWT verification enabled
- Deploy

The Edge Function requires custom Supabase secrets:

- `AFRICASTALKING_USERNAME=sandbox` for testing
- `AFRICASTALKING_API_KEY` = the secret sandbox key you rotated
- Production later: `AFRICASTALKING_USERNAME` = actual application username and `AFRICASTALKING_SENDER_ID` = approved sender ID

Never commit actual keys to GitHub. The function chooses the sandbox endpoint when username is `sandbox`. It refuses production requests without a configured sender ID.

## 3. Pull frontend changes

After the PR is merged into `main`, run:

```bash
git switch main
git pull origin main
npm run build
npm run dev
```

Navigate to Billing → finalized invoices → Next: Send invoices (Step 6).

## 4. Test safely

Start with ONE invoice whose saved `invoices.phone` is the simulator's exact virtual phone number, and send ONE SMS. Do not use Send All until the one-invoice flow succeeds.

Expected result: `Accepted (sandbox)` in Step 6 and a message in Africa's Talking simulator. A provider-accepted SMS is **not** the same as delivered to a real handset.

Once an invoice is accepted, another Send attempt is blocked. Explicitly failed sends may be retried. Network timeouts or ambiguous responses become `unknown` and are NOT retried automatically. Investigate them in Africa's Talking before any manual reset.

The browser issue reported earlier (`FunctionsFetchError`) can still interfere with local React → Edge Function calls. If you encounter it again, verify your browser extensions and network requests.

## 5. Important before production

- Your earlier experimental `send-sms` function accepts arbitrary recipient/message input from *any signed-in user*. **Disable or replace it before configuring real SMS credentials**, or authenticated accounts could spend SMS credit without approval.
- Add delivery callbacks for actual handset delivery confirmation (Step 6 currently tracks provider acceptance only).
- Review tenant consent, template wording, SMS credits, sender ID and budget/rate limiting.
- Configure links to tenant invoices only when a secured tenant portal exists.
- Never retry a `sending` or `unknown` delivery automatically; it may already have reached the provider.
- Sending many personalized invoices means multiple API requests behind one staff action. To avoid timeouts, the frontend requests groups of up to 10; each group is processed sequentially server-side.

## Message template

```
Dwellio: <property> invoice <invoice number>. Total KES <amount>.
Due <date>. Contact management for payment details.
```
