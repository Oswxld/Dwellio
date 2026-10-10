import { supabase } from '../../../lib/supabase'

export type InvoiceSmsStatus = 'sending' | 'accepted' | 'failed' | 'unknown'

export type InvoiceSmsDelivery = {
  invoice_id: string
  phone: string
  status: InvoiceSmsStatus
  environment: 'sandbox' | 'production'
  provider_message_id: string | null
  provider_status: string | null
  cost: string | null
  error_message: string | null
  attempt_count: number
  attempted_at: string
  accepted_at: string | null
}

export type InvoiceSmsSendResult = {
  invoice_id: string
  status: 'accepted' | 'failed' | 'unknown' | 'skipped'
  reason?: string
}

export type InvoiceSmsBatchResponse = {
  environment: 'sandbox' | 'production'
  results: InvoiceSmsSendResult[]
}

export async function fetchInvoiceSmsDeliveries(
  invoiceIds: string[],
): Promise<InvoiceSmsDelivery[]> {
  if (invoiceIds.length === 0) return []

  const { data, error } = await supabase
    .from('invoice_sms_deliveries')
    .select('invoice_id, phone, status, environment, provider_message_id, provider_status, cost, error_message, attempt_count, attempted_at, accepted_at')
    .in('invoice_id', invoiceIds)

  if (error) throw error
  return (data ?? []) as InvoiceSmsDelivery[]
}

export async function sendInvoiceSmsBatch(
  invoiceIds: string[],
): Promise<InvoiceSmsBatchResponse> {
  if (invoiceIds.length === 0 || invoiceIds.length > 10) {
    throw new Error('Choose between 1 and 10 invoices per batch.')
  }

  const { data, error } = await supabase.functions.invoke<InvoiceSmsBatchResponse>(
    'send-invoices',
    { body: { invoice_ids: invoiceIds } },
  )

  if (error) {
    let detail = error.message
    let responseStatus: number | null = null
    let responseStatusText: string | null = null
    let underlyingCause: string | null = null

    if (error.context instanceof Response) {
      responseStatus = error.context.status
      responseStatusText = error.context.statusText
      try {
        const body: unknown = await error.context.clone().json()
        if (body !== null && typeof body === 'object' && 'error' in body) {
          const message = (body as { error?: unknown }).error
          if (typeof message === 'string') detail = message
        }
      } catch {
        // Response body may not be JSON; retain the original error.
      }
    } else if (error.context instanceof Error) {
      underlyingCause = error.context.message
      detail = `${detail}: ${underlyingCause}`
    }

    // Log the original SDK error/context, without logging invoice phone
    // numbers, user credentials, or SMS contents.
    console.error('[InvoiceDeliveryRepository] send-invoices Edge Function failed', {
      functionName: 'send-invoices',
      requestedInvoiceCount: invoiceIds.length,
      errorName: error.name,
      errorMessage: error.message,
      underlyingCause,
      responseStatus,
      responseStatusText,
      originalError: error,
      context: error.context,
    })

    throw new Error(detail, { cause: error })
  }

  if (!data?.results || !Array.isArray(data.results)) {
    console.error('[InvoiceDeliveryRepository] Invalid send-invoices response', {
      functionName: 'send-invoices',
      requestedInvoiceCount: invoiceIds.length,
      responseType: typeof data,
    })
    throw new Error('SMS backend returned an invalid response.')
  }

  return data
}
