// Dwellio: multi-landlord M-Pesa STK Push initiation (SANDBOX ONLY).
// The tenant provides ONLY the property ID, mobile number and payment amount.
// Verified authorization, PayBill, tenant account reference and debt ceiling
// are resolved in Postgres. Per-property credentials are stored in Vault.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

type Attempt = {
  id: string;
  property_id: string;
  tenant_id: string;
  paybill_shortcode: string;
  account_reference: string;
  amount: number;
  phone_number: string;
  callback_token: string;
};
type ProviderSecrets = {
  environment: "sandbox";
  consumer_key: string;
  consumer_secret: string;
  passkey: string;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function eatTimestamp(): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date());
  const read = (part: string) => parts.find((p) => p.type === part)?.value ?? "";
  return ["year", "month", "day", "hour", "minute", "second"].map(read).join("");
}

async function fetchWithTimeout(url: string, options: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 18000);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timeout); }
}

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "POST") {
      return Response.json({ error: "POST required" }, { status: 405 });
    }
    let body: Record<string, unknown>;
    try { body = await req.json(); }
    catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }

    const propertyId = body?.property_id;
    const phone = body?.phone_number;
    const amount = body?.amount;
    if (typeof propertyId !== "string" || !uuid.test(propertyId) ||
        typeof phone !== "string" || phone.length > 24 ||
        (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount <= 0)) {
      return Response.json({ error: "Valid property_id, phone_number and whole-KSh amount required" },
        { status: 400 });
    }
    if (!ctx.userClaims?.id) {
      return Response.json({ error: "Tenant must be signed in" }, { status: 401 });
    }

    const { data: reserved, error: reserveError } = await ctx.supabase.rpc(
      "reserve_my_mpesa_stk",
      { p_property_id: propertyId, p_phone: phone, p_amount: amount },
    );
    if (reserveError || !reserved?.id) {
      return Response.json({ error: reserveError?.message ?? "Cannot initiate this payment" },
        { status: 409 });
    }

    const attemptId = String(reserved.id);
    async function updateAttempt(fields: Record<string, unknown>) {
      const { error } = await ctx.supabaseAdmin.from("mpesa_stk_requests")
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq("id", attemptId);
      if (error) throw new Error("Could not persist M-Pesa attempt state");
    }

    try {
      const { data: rawContext, error: contextError } = await ctx.supabaseAdmin.rpc(
        "get_mpesa_stk_service_context", { p_attempt_id: attemptId },
      );
      if (contextError || !rawContext) throw new Error("Merchant setup unavailable");

      const { attempt, credentials } = rawContext as {
        attempt: Attempt; credentials: ProviderSecrets;
      };

      // Important: no production request can be sent by this initial integration.
      if (credentials?.environment !== "sandbox") {
        throw new Error("Only approved sandbox accounts are supported in this version");
      }
      if (!credentials.consumer_key || !credentials.consumer_secret || !credentials.passkey) {
        throw new Error("Incomplete sandbox Daraja credentials");
      }
      if (attempt.id !== attemptId || attempt.paybill_shortcode !== reserved.paybill_shortcode) {
        throw new Error("Merchant information changed; payment stopped");
      }

      const baseUrl = Deno.env.get("MPESA_CALLBACK_BASE_URL") || Deno.env.get("SUPABASE_URL");
      if (!baseUrl || !baseUrl.startsWith("https://")) {
        throw new Error("An HTTPS callback URL is required");
      }
      const callbackUrl = new URL("/functions/v1/mpesa-stk-callback", baseUrl);
      callbackUrl.searchParams.set("attempt_id", attempt.id);
      callbackUrl.searchParams.set("token", attempt.callback_token);

      const endpoint = "https://sandbox.safaricom.co.ke";
      const basic = btoa(`${credentials.consumer_key}:${credentials.consumer_secret}`);
      const authResp = await fetchWithTimeout(
        `${endpoint}/oauth/v1/generate?grant_type=client_credentials`, {
          method: "GET",
          headers: { Authorization: `Basic ${basic}` },
        },
      );
      if (!authResp.ok) throw new Error("Daraja sandbox authentication failed");
      const authData = await authResp.json();
      if (!authData.access_token) throw new Error("Daraja access token missing");

      const timestamp = eatTimestamp();
      const password = btoa(`${attempt.paybill_shortcode}${credentials.passkey}${timestamp}`);
      const requestBody = {
        BusinessShortCode: attempt.paybill_shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: "CustomerPayBillOnline",
        Amount: attempt.amount,
        PartyA: attempt.phone_number,
        PartyB: attempt.paybill_shortcode,
        PhoneNumber: attempt.phone_number,
        CallBackURL: callbackUrl.toString(),
        AccountReference: attempt.account_reference,
        TransactionDesc: "Dwellio Rent",
      };

      const response = await fetchWithTimeout(
        `${endpoint}/mpesa/stkpush/v1/processrequest`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${authData.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
        },
      );
      const result: Record<string, unknown> = await response.json();
      const responseCode = String(result.ResponseCode ?? "");
      const checkoutId = result.CheckoutRequestID;
      const merchantId = result.MerchantRequestID;

      if (!response.ok || responseCode !== "0" || typeof checkoutId !== "string") {
        await updateAttempt({
          status: "initiation_failed",
          response_code: responseCode,
          response_description: String(result.ResponseDescription ?? "STK request rejected").slice(0, 500),
        });
        return Response.json({ status: "initiation_failed", attempt_id: attemptId,
          message: "Safaricom did not accept the STK request" }, { status: 502 });
      }

      await updateAttempt({
        status: "awaiting_callback",
        checkout_request_id: checkoutId,
        merchant_request_id: typeof merchantId === "string" ? merchantId : null,
        response_code: responseCode,
        response_description: String(result.ResponseDescription ?? "").slice(0, 500),
      });

      // Provider accepted the REQUEST only; funds are NOT confirmed here.
      return Response.json({
        status: "awaiting_callback",
        attempt_id: attemptId,
        checkout_request_id: checkoutId,
        paybill_shortcode: attempt.paybill_shortcode,
        account_reference: attempt.account_reference,
        amount: attempt.amount,
        message: "M-Pesa request accepted. Awaiting confirmation on the phone.",
      }, { status: 202 });
    } catch (error) {
      // A network timeout may have sent a real STK prompt. Do not automatically
      // retry or assume the merchant request failed; require reconciliation.
      console.error("[MPESA] STK initiation uncertain", { attemptId, error });
      try { await updateAttempt({ status: "needs_review" }); }
      catch (updateError) { console.error("[MPESA] Could not mark request uncertain", updateError); }
      return Response.json({ status: "needs_review", attempt_id: attemptId,
        message: "Payment request outcome is uncertain. Do not retry until its status is checked." },
      { status: 202 });
    }
  }),
};
