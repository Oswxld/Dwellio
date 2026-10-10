import { supabase } from '../../../lib/supabase'

export type TenantInvoice = {
  id: string
  invoice_number: string
  status: string
  issued_at: string | null
  created_at: string
  due_date: string | null
  period_start: string
  period_end: string
  billing_context: string
  property_name: string
  unit_name: string
  tenant_name?: string
  current_charges: number
  previous_balance: number
  total_payable: number
  total_receivable: number
  total_paid: number
  total_deposit_applied: number
  total_credits: number
  total_debits: number
  outstanding_amount: number
}

export type TenantInvoiceChargeDetail = {
  id: string
  meter_id: string | null
  previous_reading: number | null
  current_reading: number | null
  consumption: number | null
  rate: number | null
}

export type TenantInvoiceCharge = {
  id: string
  charge_type: string
  description: string
  amount: number
  details: TenantInvoiceChargeDetail[]
}

export type TenantInvoiceBalanceSource = {
  source_invoice_id: string
  invoice_number: string
  period_start: string
  amount: number
}

export type TenantInvoicePayment = {
  payment_id: string
  amount_allocated: number
  reference: string | null
  paid_at: string | null
  method: string | null
}

export type TenantInvoiceDetail = {
  invoice: TenantInvoice & { tenant_name: string }
  charges: TenantInvoiceCharge[]
  balance_sources: TenantInvoiceBalanceSource[]
  payments: TenantInvoicePayment[]
}

export async function fetchMyTenantInvoices(): Promise<TenantInvoice[]> {
  const { data, error } = await supabase.rpc('get_my_tenant_invoices')
  if (error) {
    console.error('[TenantInvoices] Could not load invoices', error)
    throw new Error(error.message)
  }
  return Array.isArray(data) ? data as TenantInvoice[] : []
}

export async function fetchMyTenantInvoiceDetail(id: string): Promise<TenantInvoiceDetail | null> {
  const { data, error } = await supabase.rpc('get_my_tenant_invoice_detail', {
    p_invoice_id: id,
  })
  if (error) {
    console.error('[TenantInvoices] Could not load invoice details', { id, error })
    throw new Error(error.message)
  }
  return data ? data as TenantInvoiceDetail : null
}
