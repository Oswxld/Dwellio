import { supabase } from '../../../lib/supabase'
import { sendInvoiceSmsBatch } from '../../billing/data/invoiceDeliveryRepository'

export type MoveOutInspection = {
  id: string
  organization_id: string
  lease_id: string
  tenant_id: string
  unit_id: string
  inspection_date: string | null
  status: 'pending' | 'completed'
  notes: string | null
  inspected_by: string | null
  completed_at: string | null
}
export type MoveOutCharge = {
  id: string
  inspection_id: string
  title: string
  description: string | null
  amount: number
}

export type MoveOutSettlement = {
  id: string
  invoice_id: string
  lease_id: string
  inspection_id: string
  arrears_total: number
  inspection_total: number
  additional_total: number
  deposit_held: number
  deposit_applied: number
  tenant_payable: number
  deposit_refundable: number
}
export type MoveOutArrearSource = {
  settlement_id: string
  source_invoice_id: string
  amount: number
}
export type MoveOutSmsDelivery = {
  invoice_id: string
  phone: string
  status: 'sending' | 'accepted' | 'failed' | 'unknown'
  attempt_count: number
  attempted_at: string
}
export type MoveOutWorkspace = {
  inspection: MoveOutInspection | null
  charges: MoveOutCharge[]
  settlement: MoveOutSettlement | null
  arrearSources: MoveOutArrearSource[]
  smsDelivery: MoveOutSmsDelivery | null
  schemaReady: boolean
  error: string | null
}

function isMissingTable(error: { code?: string; message?: string }) {
  return ['42P01','PGRST205','PGRST116'].includes(error.code ?? '') ||
    /could not find the table|relation .* does not exist/i.test(error.message ?? '')
}

export async function fetchMoveOutWorkspace(leaseId: string): Promise<MoveOutWorkspace> {
  const { data: inspections, error } = await supabase
    .from('move_out_inspections')
    .select('id, organization_id, lease_id, tenant_id, unit_id, inspection_date, status, notes, inspected_by, completed_at')
    .eq('lease_id', leaseId)
    .limit(1)
  if (error) {
    if (isMissingTable(error)) return {
      inspection: null, charges: [], settlement: null, arrearSources: [], smsDelivery: null, schemaReady: false,
      error: 'Inspection storage is not installed. Apply supabase/move_out_inspections_v1.sql in Supabase first.',
    }
    throw error
  }
  const inspection = ((inspections ?? [])[0] ?? null) as MoveOutInspection | null
  if (!inspection) return {
    inspection: null, charges: [], settlement: null, arrearSources: [],
    smsDelivery: null, schemaReady: true, error: null,
  }
  const { data, error: chargeError } = await supabase
    .from('move_out_inspection_bills')
    .select('id, inspection_id, title, description, amount')
    .eq('inspection_id', inspection.id)
    .order('created_at')
  if (chargeError) throw chargeError
  let settlement: MoveOutSettlement | null = null
  let arrearSources: MoveOutArrearSource[] = []
  let smsDelivery: MoveOutSmsDelivery | null = null
  const { data: snapshots, error: snapshotError } = await supabase
    .from('move_out_settlements')
    .select('id,invoice_id,lease_id,inspection_id,arrears_total,inspection_total,additional_total,deposit_held,deposit_applied,tenant_payable,deposit_refundable')
    .eq('inspection_id', inspection.id).limit(1)
  if (snapshotError && !isMissingTable(snapshotError)) throw snapshotError
  if (snapshots?.length) {
    const item = snapshots[0]
    settlement = {
      ...item,
      arrears_total: Number(item.arrears_total),
      inspection_total: Number(item.inspection_total),
      additional_total: Number(item.additional_total),
      deposit_held: Number(item.deposit_held),
      deposit_applied: Number(item.deposit_applied),
      tenant_payable: Number(item.tenant_payable),
      deposit_refundable: Number(item.deposit_refundable),
    } as MoveOutSettlement
    const [sources, delivery] = await Promise.all([
      supabase.from('move_out_settlement_arrears')
        .select('settlement_id,source_invoice_id,amount').eq('settlement_id', settlement.id),
      supabase.from('move_out_sms_deliveries')
        .select('invoice_id,phone,status,attempt_count,attempted_at')
        .eq('invoice_id', settlement.invoice_id).limit(1),
    ])
    if (sources.error) throw sources.error
    if (delivery.error) throw delivery.error
    arrearSources = (sources.data ?? []).map(item => ({...item,amount:Number(item.amount)}))
    smsDelivery = ((delivery.data ?? [])[0] ?? null) as MoveOutSmsDelivery | null
  }
  return {
    inspection,
    charges: (data ?? []).map(item => ({ ...item, amount: Number(item.amount) })) as MoveOutCharge[],
    settlement,
    arrearSources,
    smsDelivery,
    schemaReady: true,
    error: null,
  }
}

export async function beginMoveOutInspection(args: {
  organizationId: string
  leaseId: string
  tenantId: string
  unitId: string
  date: string
}): Promise<void> {
  const { data: auth, error: authError } = await supabase.auth.getUser()
  if (authError) throw authError
  if (!auth.user) throw new Error('Sign in before creating an inspection.')
  const { error } = await supabase.from('move_out_inspections').insert({
    organization_id: args.organizationId,
    lease_id: args.leaseId,
    tenant_id: args.tenantId,
    unit_id: args.unitId,
    inspection_date: `${args.date}T12:00:00+03:00`,
    inspected_by: auth.user.id,
  })
  if (error) throw error
}

export async function updateMoveOutInspection(
  inspectionId: string, data: { inspected_at?: string; notes?: string | null; status?: 'completed' },
) {
  const payload: Record<string, unknown> = {
    ...(data.inspected_at ? { inspection_date: `${data.inspected_at}T12:00:00+03:00` } : {}),
    ...(data.notes !== undefined ? { notes: data.notes } : {}),
    ...(data.status ? { status: data.status } : {}),
    updated_at: new Date().toISOString(),
  }
  const { data: result, error } = await supabase.from('move_out_inspections')
    .update(payload).eq('id', inspectionId).eq('status', 'pending').select('id')
  if (error) throw error
  if (!result?.length) throw new Error('The inspection cannot be changed. Refresh and check its status.')
}

export async function addMoveOutCharge(
  inspectionId: string, title: string, amount: number, description: string | null,
) {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Charge amount must be greater than zero.')
  const { error } = await supabase.from('move_out_inspection_bills')
    .insert({ inspection_id: inspectionId, title: title.trim(), amount, description: description?.trim() || null })
  if (error) throw error
}

export async function editMoveOutCharge(
  id: string, title: string, amount: number, description: string | null,
) {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Charge amount must be greater than zero.')
  const { data, error } = await supabase.from('move_out_inspection_bills')
    .update({ title: title.trim(), amount, description: description?.trim() || null })
    .eq('id', id).select('id')
  if (error) throw error
  if (!data?.length) throw new Error('The charge can no longer be edited.')
}

export async function removeMoveOutCharge(id: string) {
  const { error } = await supabase.from('move_out_inspection_bills').delete().eq('id', id)
  if (error) throw error
}

export async function finalizeMoveOut(
  leaseId: string,
  finalInvoiceId: string,
  moveOutDate: string,
): Promise<{ status: string; unit_status: string }> {
  const { data, error } = await supabase.rpc('finalize_move_out', {
    p_lease_id: leaseId,
    p_invoice_id: finalInvoiceId,
    p_move_out_date: moveOutDate,
    p_keys_returned: true,
    p_unit_vacated: true,
  })
  if (error) throw error
  if (!data || data.status !== 'terminated' || data.unit_status !== 'vacant') {
    throw new Error('The move-out closeout did not return a verified termination result.')
  }
  return data
}

export type ProcessMoveOutInvoiceResult = {
  invoice_id: string
  invoice_number?: string
  settlement_id: string
  already_processed: boolean
  arrears_total?: number
  inspection_total?: number
  deposit_applied?: number
  tenant_payable: number
  deposit_refundable: number
}
export async function processMoveOutInvoice(inspectionId: string): Promise<ProcessMoveOutInvoiceResult> {
  const { data, error } = await supabase.rpc('process_move_out_invoice', {
    p_inspection_id: inspectionId,
  })
  if (error) throw error
  if (!data?.invoice_id || !data?.settlement_id) {
    throw new Error('Invoice processing did not return a finalized settlement.')
  }
  return data as ProcessMoveOutInvoiceResult
}
export type SendMoveOutSmsResult = {
  environment: 'sandbox' | 'production'
  invoice_id: string
  status: 'accepted' | 'failed' | 'unknown' | 'skipped'
  reason?: string
}
export async function sendMoveOutInvoiceSms(invoiceId: string): Promise<SendMoveOutSmsResult> {
  // Reuse Billing Step 6's existing send-invoices endpoint and request shape.
  const batch = await sendInvoiceSmsBatch([invoiceId])
  const result = batch.results.find(row => row.invoice_id === invoiceId)
  if (!result) throw new Error('SMS backend did not return the requested invoice result.')
  return { environment: batch.environment, ...result }
}
