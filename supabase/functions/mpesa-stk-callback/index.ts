// Dwellio multi-landlord M-Pesa STK callback receiver — SANDBOX STAGING.
// Callbacks are NOT cryptographically signed by this integration.
// The callback URL uses a per-attempt opaque token and validates the checkout ID,
// but this alone is not sufficient proof of money received.
// Accordingly this function NEVER inserts into payments or allocates money.
// Confirm via a separate reconciliation/query workflow before ledger settlement.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

type StkCallback = {
  CheckoutRequestID?: unknown;
  MerchantRequestID?: unknown;
  ResultCode?: unknown;
  ResultDesc?: unknown;
  CallbackMetadata?: {
    Item?: Array<{ Name?: unknown; Value?: unknown }>;
  };
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default {
  fetch: withSupabase({ auth: "none" }, async (req, ctx) => {
    if (req.method !== "POST") {
      return Response.json({ error: "POST required" }, { status: 405 });
    }
    const url = new URL(req.url);
    const attemptId = url.searchParams.get("attempt_id") ?? "";
    const callbackToken = url.searchParams.get("token") ?? "";
    if (!uuid.test(attemptId) || !uuid.test(callbackToken)) {
      return Response.json({ error: "Invalid callback token" }, { status: 401 });
    }

    let json: unknown;
    try {
      const raw = await req.text();
      if (raw.length > 20000) return Response.json({ error: "Callback too large" }, { status: 413 });
      json = JSON.parse(raw);
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }
    if (typeof json !== "object" || !json) {
      return Response.json({ error: "Invalid callback payload" }, { status: 400 });
    }

    const callback = (json as { Body?: { stkCallback?: StkCallback } }).Body?.stkCallback;
    if (!callback || typeof callback.CheckoutRequestID !== "string" ||
        typeof callback.ResultCode !== "number" ||
        !Number.isInteger(callback.ResultCode)) {
      return Response.json({ error: "Missing STK callback result" }, { status: 400 });
    }

    const { data: attempt, error: getError } = await ctx.supabaseAdmin
      .from("mpesa_stk_requests")
      .select("id,callback_token,checkout_request_id,merchant_request_id,amount,status")
      .eq("id", attemptId).maybeSingle();
    if (getError || !attempt || attempt.callback_token !== callbackToken) {
      return Response.json({ error: "Unknown M-Pesa callback" }, { status: 401 });
    }

    // The checkout may not have persisted yet if Safaricom called back quickly;
    // store the payload for later reconciliation and resolve the race explicitly.
    if (attempt.checkout_request_id && callback.CheckoutRequestID !== attempt.checkout_request_id) {
      return Response.json({ error: "Checkout ID mismatch" }, { status: 409 });
    }
    if (attempt.merchant_request_id && callback.MerchantRequestID !== attempt.merchant_request_id) {
      return Response.json({ error: "Merchant request ID mismatch" }, { status: 409 });
    }
    if (attempt.status === "confirmed") {
      return Response.json({ ok: true, status: "already_confirmed" });
    }

    const items = callback.CallbackMetadata?.Item ?? [];
    if (!Array.isArray(items) || items.length > 30) {
      return Response.json({ error: "Invalid callback metadata" }, { status: 400 });
    }
    const readMeta = (name: string): unknown =>
      items.find((entry) => entry?.Name === name)?.Value;
    const receipt = readMeta("MpesaReceiptNumber");
    const returnedAmount = readMeta("Amount");
    const success = callback.ResultCode === 0;
    const validAmount = Number(returnedAmount) === Number(attempt.amount);
    const validReceipt = typeof receipt === "string" && receipt.length >= 5 && receipt.length <= 32;

    const newStatus = success && (!validAmount || !validReceipt)
      ? "needs_review"
      : "callback_received";

    const { error: updateError } = await ctx.supabaseAdmin
      .from("mpesa_stk_requests")
      .update({
        status: newStatus,
        callback_result_code: callback.ResultCode,
        callback_result_description: String(callback.ResultDesc ?? "").slice(0, 500),
        callback_payload: json,
        mpesa_receipt: success && validReceipt ? receipt : null,
        updated_at: new Date().toISOString(),
        // Do not set completed_at; a callback alone does not settle the ledger.
      })
      .eq("id", attemptId)
      .neq("status", "confirmed");
    if (updateError) {
      console.error("[MPESA] Callback not stored", { attemptId, error: updateError });
      return Response.json({ error: "Callback could not be recorded" }, { status: 500 });
    }

    return Response.json({
      ok: true,
      status: newStatus,
      note: "Result recorded for reconciliation. No accounting entry made.",
    });
  }),
};
