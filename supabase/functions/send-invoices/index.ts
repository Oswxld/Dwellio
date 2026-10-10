// Dwellio | Authenticated, manager-authorized, personalized invoice SMS submissions.
// Each request processes up to 10 invoice IDs. Requires the invoice_sms_delivery.sql migration.
// This function reads phone + amount from invoices on the server, never from caller-provided fields.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

type Claim = {
  claimed: boolean;
  reason?: string;
  invoice_id?: string;
  phone?: string;
  invoice_number?: string;
  total_receivable?: number | string;
  due_date?: string | null;
  property_name?: string;
};

type Result = {
  invoice_id: string;
  status: "accepted" | "failed" | "unknown" | "skipped";
  reason?: string;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeKenyanPhone(raw: string): string | null {
  const stripped = raw.replace(/[\s()-]/g, "");
  const normalized = stripped.startsWith("0")
    ? "+254" + stripped.slice(1)
    : stripped.startsWith("254")
      ? "+" + stripped
      : stripped;

  return /^\+254[17]\d{8}$/.test(normalized) ? normalized : null;
}

function invoiceSms(claim: Claim): string {
  const property = String(claim.property_name ?? "your property").slice(0, 40);
  const reference = String(claim.invoice_number ?? "").slice(0, 40);
  const amount = Number(claim.total_receivable ?? 0);
  const due = claim.due_date ? ` Due ${claim.due_date}.` : "";
  return `Dwellio: ${property} invoice ${reference}. Total KES ${amount.toFixed(2)}.${due} Contact management for payment details.`;
}

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "POST") {
      return Response.json({ error: "POST required" }, { status: 405 });
    }

    let ids: unknown;
    try {
      const body = await req.json();
      ids = body?.invoice_ids;
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }

    if (
      !Array.isArray(ids) ||
      ids.length < 1 ||
      ids.length > 10 ||
      ids.some((id) => typeof id !== "string" || !uuidPattern.test(id))
    ) {
      return Response.json(
        { error: "Provide 1-10 valid invoice IDs per request" },
        { status: 400 },
      );
    }

    const actorId = ctx.userClaims?.id;
    if (!actorId) {
      return Response.json({ error: "Authenticated user required" }, { status: 401 });
    }

    const invoiceIds = Array.from(new Set(ids as string[]));
    const username = Deno.env.get("AFRICASTALKING_USERNAME");
    const apiKey = Deno.env.get("AFRICASTALKING_API_KEY");
    const senderId = Deno.env.get("AFRICASTALKING_SENDER_ID");

    if (!username || !apiKey) {
      return Response.json({ error: "SMS credentials are not configured" }, { status: 503 });
    }

    const environment = username === "sandbox" ? "sandbox" : "production";

    // Prevent accidentally switching to real, paid SMS with an unapproved sender.
    if (environment === "production" && !senderId) {
      return Response.json(
        { error: "Set an approved AFRICASTALKING_SENDER_ID before production sending" },
        { status: 503 },
      );
    }

    const endpoint = environment === "sandbox"
      ? "https://api.sandbox.africastalking.com/version1/messaging"
      : "https://api.africastalking.com/version1/messaging";

    const results: Result[] = [];

    async function updateDelivery(
      invoiceId: string,
      fields: Record<string, unknown>,
    ) {
      const { data, error } = await ctx.supabaseAdmin
        .from("invoice_sms_deliveries")
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq("invoice_id", invoiceId)
        .eq("status", "sending")
        .select("invoice_id")
        .single();

      if (error || !data) {
        throw new Error("Could not save the SMS delivery result");
      }
    }

    for (const invoiceId of invoiceIds) {
      // The RPC checks permissions, finalization, phone presence and duplicates.
      // It atomically claims an invoice before the external network call.
      const { data, error } = await ctx.supabaseAdmin.rpc(
        "claim_invoice_sms_delivery",
        {
          p_invoice_id: invoiceId,
          p_environment: environment,
          p_actor_id: actorId,
        },
      );

      if (error) {
        results.push({ invoice_id: invoiceId, status: "failed", reason: error.message });
        continue;
      }

      const claim = data as Claim | null;
      if (!claim?.claimed) {
        results.push({
          invoice_id: invoiceId,
          status: "skipped",
          reason: claim?.reason ?? "Not eligible",
        });
        continue;
      }

      const phone = normalizeKenyanPhone(String(claim.phone ?? ""));
      if (!phone) {
        try {
          await updateDelivery(invoiceId, {
            status: "failed",
            error_message: "Invalid Kenyan mobile number on invoice",
          });
        } catch {
          // Leave in 'sending' if the database cannot be updated; don't retry automatically.
        }
        results.push({
          invoice_id: invoiceId,
          status: "failed",
          reason: "Invalid Kenyan mobile number on invoice",
        });
        continue;
      }

      const parameters = new URLSearchParams({
        username,
        to: phone,
        message: invoiceSms(claim),
      });
      if (environment === "production" && senderId) {
        parameters.set("from", senderId);
      }

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            apiKey,
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: parameters.toString(),
          signal: AbortSignal.timeout(15000),
        });

        const raw = await response.text();
        let provider: Record<string, unknown> = {};
        try {
          provider = JSON.parse(raw);
        } catch {
          // Unparseable responses may still represent an accepted submission.
        }

        const smsData = provider?.SMSMessageData as
          | { Recipients?: Array<Record<string, unknown>> }
          | undefined;
        const recipient = smsData?.Recipients?.[0];
        const accepted =
          response.ok &&
          recipient?.status === "Success" &&
          Number(recipient?.statusCode) === 101;

        const state = accepted
          ? "accepted"
          : response.status >= 500 || (response.ok && !recipient)
            ? "unknown"
            : "failed";

        await updateDelivery(invoiceId, {
          status: state,
          phone,
          provider_message_id:
            typeof recipient?.messageId === "string" ? recipient.messageId : null,
          provider_status:
            typeof recipient?.status === "string" ? recipient.status : null,
          cost: typeof recipient?.cost === "string" ? recipient.cost : null,
          error_message: accepted
            ? null
            : state === "unknown"
              ? "Provider response unclear: check provider before retrying"
              : "SMS provider rejected the message",
          accepted_at: accepted ? new Date().toISOString() : null,
        });

        results.push({
          invoice_id: invoiceId,
          status: state,
          reason: state === "unknown" ? "Provider response unclear" : undefined,
        });
      } catch {
        // A timeout/network error may occur AFTER provider accepted the SMS.
        // Never auto-retry it; record an indeterminate state.
        try {
          await updateDelivery(invoiceId, {
            status: "unknown",
            error_message: "Network timeout or uncertain submission; review provider before retrying",
          });
        } catch {
          // If updating failed, it stays in 'sending' to avoid duplicate submissions.
        }
        results.push({
          invoice_id: invoiceId,
          status: "unknown",
          reason: "Outcome uncertain; do not automatically retry",
        });
      }
    }

    return Response.json({ environment, results });
  }),
};
