import { supabase } from '../../../lib/supabase'

export type MpesaCheckoutContext = {
  available: boolean
  property_id?: string
  property_name?: string
  unit_number?: string
  paybill_shortcode?: string | null
  setup_status?: string
  phone_number?: string | null
  outstanding_balance?: number
  message?: string | null
}

export type MpesaAttempt = {
  id: string
  status: 'initiating' | 'awaiting_callback' | 'callback_received' |
    'initiation_failed' | 'failed' | 'needs_review' | 'confirmed'
  amount: number
  created_at?: string
  paybill_shortcode?: string
  account_reference?: string
  verification_status?: string | null
  payment_id?: string | null
  receipt?: string | null
  result_description?: string | null
}

export async function getTenantMpesaContext(invoiceId?: string): Promise<MpesaCheckoutContext> {
  const { data, error } = await supabase.rpc('get_my_mpesa_checkout_context', {
    p_invoice_id: invoiceId ?? null,
  })
  if (error) throw new Error(error.message)
  if (!data || typeof data !== 'object') throw new Error('Could not load M-Pesa payment information.')
  return data as MpesaCheckoutContext
}

export async function getRecentTenantMpesaAttempt(propertyId: string): Promise<MpesaAttempt | null> {
  const { data, error } = await supabase.rpc('get_my_recent_mpesa_stk', {
    p_property_id: propertyId,
  })
  if (error) throw new Error(error.message)
  return data as MpesaAttempt | null
}

export async function getTenantMpesaAttemptStatus(attemptId: string): Promise<MpesaAttempt> {
  const { data, error } = await supabase.rpc('get_my_mpesa_stk_status', {
    p_attempt_id: attemptId,
  })
  if (error) throw new Error(error.message)
  if (!data) throw new Error('Unable to find this payment request.')
  return data as MpesaAttempt
}

export async function initiateTenantMpesaStk(
  propertyId: string,
  phoneNumber: string,
  amount: number,
): Promise<MpesaAttempt> {
  const { data, error } = await supabase.functions.invoke('mpesa-stk-initiate', {
    body: { property_id: propertyId, phone_number: phoneNumber, amount },
  })
  if (error) {
    // Edge Functions return HTTP 409 for validation errors. Surface provider
    // response text if exposed by the SDK, otherwise the normal SDK error.
    let message = error.message
    if ('context' in error && error.context instanceof Response) {
      try {
        const body = await error.context.clone().json() as { error?: string; message?: string }
        message = body.error || body.message || message
      } catch { /* preserve SDK error message */ }
    }
    throw new Error(message)
  }
  if (!data?.attempt_id) {
    throw new Error('The M-Pesa request returned no tracking ID. Please check with property management before retrying.')
  }
  return {
    id: String(data.attempt_id),
    status: data.status ?? 'needs_review',
    amount: Number(data.amount ?? amount),
    paybill_shortcode: data.paybill_shortcode,
    account_reference: data.account_reference,
  } as MpesaAttempt
}
