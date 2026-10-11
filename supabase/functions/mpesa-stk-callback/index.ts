// Dwellio: STK callback + independent Safaricom STK Push status query (SANDBOX).
// The public callback is NOT trusted as proof of paid amount/receipt.
// The STK query corroborates STATUS and IDs, but its standard response does
// not contain the receipt/amount. DO NOT create payments or allocate invoices
// here; reconciliation to the merchant's payment records comes next.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

type StkCallback = {
  CheckoutRequestID?: unknown;
  MerchantRequestID?: unknown;
  ResultCode?: unknown;
  ResultDesc?: unknown;
  CallbackMetadata?: { Item?: Array<{ Name?: unknown; Value?: unknown }> };
};
type MerchantCredentials = {
  environment: "sandbox";
  consumer_key: string;
  consumer_secret: string;
  passkey: string;
};
type StkAttempt = {
  id: string;
  callback_token: string;
  checkout_request_id: string | null;
  merchant_request_id: string | null;
  paybill_shortcode: string;
  phone_number: string;
  amount: number;
  status: string;
  callback_payload: unknown;
};
type QueryEvidence = {
  raw: Record<string, unknown>;
  responseCode: string;
  resultCode: number | null;
  resultDescription: string;
  checkoutId: string | null;
  merchantId: string | null;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Match conventional UUID syntax. Callback token is an opaque unguessable UUID.
const validUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function resultInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    const result = Number(value);
    return Number.isSafeInteger(result) ? result : null;
  }
  return null;
}

function nairobiTimestamp(): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date());
  const part = (name: string) => parts.find((p) => p.type === name)?.value ?? "";
  return ["year", "month", "day", "hour", "minute", "second"].map(part).join("");
}

async function fetchTimed(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try { return await fetch(url, { ...init, signal: controller.signal }); }
  finally { clearTimeout(timeout); }
}

function callbackFields(callback: StkCallback): {
  result: number;
  amount: number | null;
  phone: string | null;
  receipt: string | null;
  validMetadata: boolean;
} {
  const result = callback.ResultCode as number;
  if (result !== 0) {
    return { result, amount: null, phone: null, receipt: null, validMetadata: true };
  }
  const items = callback.CallbackMetadata?.Item;
  if (!Array.isArray(items) || items.length > 30) {
    return { result, amount: null, phone: null, receipt: null, validMetadata: false };
  }
  // Reject duplicate values; never choose the first or last arbitrarily.
  const readUnique = (key: string): unknown => {
    const matches = items.filter((item) => item?.Name === key);
    return matches.length === 1 ? matches[0]?.Value : undefined;
  };
  const rawAmount = readUnique("Amount");
  const rawPhone = readUnique("PhoneNumber");
  const rawReceipt = readUnique("MpesaReceiptNumber");
  const amount = typeof rawAmount === "number" && Number.isSafeInteger(rawAmount)
    ? rawAmount : null;
  const phone = (typeof rawPhone === "number" || typeof rawPhone === "string")
    ? String(rawPhone) : null;
  const receipt = typeof rawReceipt === "string" ? rawReceipt.trim() : null;
  const validMetadata = amount !== null && amount > 0 &&
    phone !== null && /^254[17][0-9]{8}$/.test(phone) &&
    receipt !== null && /^[A-Za-z0-9]{5,32}$/.test(receipt);
  return { result, amount, phone, receipt, validMetadata };
}

function sameCallback(a: StkCallback, b: StkCallback): boolean {
  if (a.CheckoutRequestID !== b.CheckoutRequestID ||
      a.MerchantRequestID !== b.MerchantRequestID ||
      a.ResultCode !== b.ResultCode) return false;
  if (a.ResultCode !== 0) return true;
  const x = callbackFields(a);
  const y = callbackFields(b);
  return x.amount === y.amount && x.phone === y.phone && x.receipt === y.receipt &&
    x.validMetadata === y.validMetadata;
}

async function queryStk(
  credentials: MerchantCredentials,
  attempt: StkAttempt,
): Promise<QueryEvidence> {
  if (credentials.environment !== "sandbox") {
    throw new Error("STK Query blocked: only sandbox merchant credentials are supported");
  }
  if (!credentials.consumer_key || !credentials.consumer_secret || !credentials.passkey) {
    throw new Error("Merchant sandbox credentials are incomplete");
  }
  const endpoint = "https://sandbox.safaricom.co.ke";
  const basic = btoa(`${credentials.consumer_key}:${credentials.consumer_secret}`);
  const oauth = await fetchTimed(
    `${endpoint}/oauth/v1/generate?grant_type=client_credentials`,
    { method: "GET", headers: { Authorization: `Basic ${basic}` } },
  );
  if (!oauth.ok) throw new Error("Daraja OAuth failed");
  const tokenResult = await oauth.json() as { access_token?: string };
  if (typeof tokenResult.access_token !== "string" || !tokenResult.access_token) {
    throw new Error("Daraja OAuth returned no access token");
  }
  const timestamp = nairobiTimestamp();
  const password = btoa(`${attempt.paybill_shortcode}${credentials.passkey}${timestamp}`);
  const response = await fetchTimed(
    `${endpoint}/mpesa/stkpushquery/v1/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenResult.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        BusinessShortCode: attempt.paybill_shortcode,
        Password: password,
        Timestamp: timestamp,
        CheckoutRequestID: attempt.checkout_request_id,
      }),
    },
  );
  if (!response.ok) throw new Error(`Daraja STK Query HTTP ${response.status}`);
  const raw = await response.json() as Record<string, unknown>;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Daraja returned an invalid STK Query response");
  }
  return {
    raw,
    responseCode: String(raw.ResponseCode ?? ""),
    resultCode: resultInteger(raw.ResultCode),
    resultDescription: String(raw.ResultDesc ?? raw.ResponseDescription ?? "").slice(0, 500),
    checkoutId: typeof raw.CheckoutRequestID === "string" ? raw.CheckoutRequestID : null,
    merchantId: typeof raw.MerchantRequestID === "string" ? raw.MerchantRequestID : null,
  };
}

export default {
  fetch: withSupabase({ auth: "none" }, async (req, ctx) => {
    if (req.method !== "POST") {
      return Response.json({ error: "POST required" }, { status: 405 });
    }
    const url = new URL(req.url);
    const attemptId = url.searchParams.get("attempt_id") ?? "";
    const callbackToken = url.searchParams.get("token") ?? "";
    if (!validUuid.test(attemptId) || !validUuid.test(callbackToken)) {
      return Response.json({ error: "Invalid callback token" }, { status: 401 });
    }

    let payload: Record<string, unknown>;
    try {
      const raw = await req.text();
      if (raw.length > 20000) return Response.json({ error: "Callback too large" }, { status: 413 });
      payload = JSON.parse(raw) as Record<string, unknown>;
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new Error("Payload must be a JSON object");
      }
    } catch {
      return Response.json({ error: "Invalid callback JSON" }, { status: 400 });
    }

    const cb = (payload as { Body?: { stkCallback?: StkCallback } }).Body?.stkCallback;
    if (!cb || typeof cb.CheckoutRequestID !== "string" ||
        typeof cb.MerchantRequestID !== "string" ||
        typeof cb.ResultCode !== "number" || !Number.isSafeInteger(cb.ResultCode)) {
      return Response.json({ error: "Invalid STK callback fields" }, { status: 400 });
    }

    const { data: stored, error: readError } = await ctx.supabaseAdmin
      .from("mpesa_stk_requests")
      .select("id,callback_token,checkout_request_id,merchant_request_id,paybill_shortcode,phone_number,amount,status,callback_payload")
      .eq("id", attemptId).maybeSingle();
    if (readError) {
      console.error("[MPESA] Could not read request", { attemptId, reason: readError.message });
      return Response.json({ error: "Database unavailable" }, { status: 503 });
    }
    const attempt = stored as StkAttempt | null;
    if (!attempt || attempt.callback_token !== callbackToken) {
      return Response.json({ error: "Unknown M-Pesa callback" }, { status: 401 });
    }
    if (attempt.status === "confirmed") {
      return Response.json({ ok: true, status: "already_confirmed" });
    }
    if (attempt.checkout_request_id && cb.CheckoutRequestID !== attempt.checkout_request_id) {
      return Response.json({ error: "CheckoutRequestID mismatch" }, { status: 409 });
    }
    if (attempt.merchant_request_id && cb.MerchantRequestID !== attempt.merchant_request_id) {
      return Response.json({ error: "MerchantRequestID mismatch" }, { status: 409 });
    }

    const previous = (attempt.callback_payload as { Body?: { stkCallback?: StkCallback } } | null)
      ?.Body?.stkCallback;
    if (previous && !sameCallback(previous, cb)) {
      // Callback substitution/conflict: fail closed, retain ORIGINAL raw evidence.
      await ctx.supabaseAdmin.from("mpesa_stk_requests")
        .update({ status: "needs_review", verification_status: "mismatch",
          verification_error: "Conflicting callbacks for the same STK attempt",
          updated_at: new Date().toISOString() })
        .eq("id", attemptId).neq("status", "confirmed");
      return Response.json({ ok: false, status: "needs_review", reason: "Conflicting callback" }, { status: 409 });
    }

    // Record callback before external query so evidence survives network failure.
    // Only the first callback may populate callback_payload.
    if (!previous) {
      const { error: saveError } = await ctx.supabaseAdmin
        .from("mpesa_stk_requests")
        .update({
          status: "callback_received",
          callback_result_code: cb.ResultCode,
          callback_result_description: String(cb.ResultDesc ?? "").slice(0, 500),
          callback_payload: payload,
          verification_status: "query_pending",
          updated_at: new Date().toISOString(),
        })
        .eq("id", attemptId)
        .is("callback_payload", null)
        .neq("status", "confirmed");
      if (saveError) {
        console.error("[MPESA] Failed to persist callback", { attemptId, reason: saveError.message });
        return Response.json({ error: "Could not persist callback" }, { status: 503 });
      }
    }

    const details = callbackFields(cb);
    const metaMatches = cb.ResultCode !== 0 || (
      details.validMetadata &&
      details.amount === Number(attempt.amount) &&
      details.phone === attempt.phone_number
    );
    const now = new Date().toISOString();

    async function recordVerification(
      status: "callback_received" | "failed" | "needs_review",
      verification: "query_matched" | "query_failed" | "mismatch" | "unavailable",
      reason: string | null,
      evidence?: QueryEvidence,
      receipt?: string | null,
    ): Promise<boolean> {
      const patch: Record<string, unknown> = {
        status, verification_status: verification,
        verification_error: reason?.slice(0, 500) ?? null,
        stk_query_checked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      if (evidence) {
        patch.stk_query_response_code = evidence.responseCode;
        patch.stk_query_result_code = evidence.resultCode;
        patch.stk_query_result_description = evidence.resultDescription;
        patch.stk_query_payload = evidence.raw;
      }
      if (verification === "query_matched" && receipt) patch.mpesa_receipt = receipt;
      const { data, error } = await ctx.supabaseAdmin
        .from("mpesa_stk_requests")
        .update(patch).eq("id", attemptId).neq("status", "confirmed")
        .select("id").maybeSingle();
      if (error) {
        console.error("[MPESA] Could not store query verification", { attemptId, reason: error.message });
        return false;
      }
      return Boolean(data);
    }

    // Query the ORIGINAL CheckoutRequestID persisted by the initiator.
    // Very fast callbacks may arrive before it is saved: do not trust the
    // uncorrelated callback ID; retain evidence and stop for reconciliation.
    if (!attempt.checkout_request_id || !attempt.merchant_request_id) {
      const ok = await recordVerification("needs_review", "unavailable",
        "The STK initiation identifiers were not persisted before callback arrival");
      return Response.json({ ok, status: "needs_review", verified: false });
    }

    let evidence: QueryEvidence;
    try {
      const { data: serviceContext, error: serviceError } = await ctx.supabaseAdmin.rpc(
        "get_mpesa_stk_service_context", { p_attempt_id: attemptId },
      );
      if (serviceError || !serviceContext?.credentials) {
        throw new Error("Merchant credentials could not be loaded for this STK attempt");
      }
      // Reread the trusted server copy, NOT the callback's PayBill information.
      const contextAttempt = serviceContext.attempt as StkAttempt;
      if (contextAttempt.id !== attemptId ||
          contextAttempt.checkout_request_id !== attempt.checkout_request_id ||
          contextAttempt.paybill_shortcode !== attempt.paybill_shortcode) {
        throw new Error("Merchant/checkout configuration changed");
      }
      evidence = await queryStk(
        serviceContext.credentials as MerchantCredentials,
        attempt,
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : "STK Query failed";
      const ok = await recordVerification("needs_review", "unavailable", reason);
      return Response.json({ ok, status: "needs_review", verified: false,
        reason: "Safaricom query unavailable; payment remains unsettled" });
    }

    // ResponseCode 0 = query accepted. ResultCode 0 = payment reported successful.
    const idsMatch = evidence.checkoutId === attempt.checkout_request_id &&
      evidence.merchantId === attempt.merchant_request_id;
    const queryValid = evidence.responseCode === "0" &&
      evidence.resultCode !== null && idsMatch;
    if (!queryValid) {
      const ok = await recordVerification("needs_review", "mismatch",
        "Safaricom STK Query response is missing or disagrees on request IDs/status", evidence);
      return Response.json({ ok, status: "needs_review", verified: false,
        reason: "STK Query response mismatch or incomplete" });
    }

    if (evidence.resultCode !== cb.ResultCode) {
      const ok = await recordVerification("needs_review", "mismatch",
        `Callback result ${cb.ResultCode} disagrees with Safaricom query result ${evidence.resultCode}`,
        evidence);
      return Response.json({ ok, status: "needs_review", verified: false,
        reason: "Safaricom and callback outcomes disagree" });
    }

    if (evidence.resultCode !== 0) {
      const ok = await recordVerification("failed", "query_failed", null, evidence);
      return Response.json({ ok, status: "failed", verified: true, paid: false });
    }

    if (!metaMatches || !details.receipt) {
      const ok = await recordVerification("needs_review", "mismatch",
        "Callback amount, phone number or receipt does not match the original STK request",
        evidence);
      return Response.json({ ok, status: "needs_review", verified: false,
        reason: "Callback payment details mismatch" });
    }

    // Guard receipt reuse across STK attempts. Final settlement should also
    // enforce unique receipt and CheckoutRequestID in a database transaction.
    const { data: reused, error: reuseError } = await ctx.supabaseAdmin
      .from("mpesa_stk_requests")
      .select("id").eq("mpesa_receipt", details.receipt)
      .neq("id", attemptId).limit(1);
    if (reuseError) {
      const ok = await recordVerification("needs_review", "unavailable",
        "Could not check receipt uniqueness", evidence);
      return Response.json({ ok, status: "needs_review", verified: false });
    }
    if ((reused ?? []).length > 0) {
      const ok = await recordVerification("needs_review", "mismatch",
        "M-Pesa receipt is already associated with another STK request", evidence);
      return Response.json({ ok, status: "needs_review", verified: false,
        reason: "Duplicate receipt" });
    }

    // Status cross-checked; amount/phone/receipt only match OUR original
    // request, not Safaricom's merchant statement. NO financial settlement.
    const ok = await recordVerification("callback_received", "query_matched", null,
      evidence, details.receipt);
    if (!ok) return Response.json({ error: "Could not persist verification" }, { status: 503 });
    return Response.json({
      ok: true, status: "callback_received", verification_status: "query_matched",
      verified_status: true, settled: false,
      note: "STK Query agrees with callback; receipt/amount still require merchant reconciliation before payment allocation.",
    });
  }),
};
