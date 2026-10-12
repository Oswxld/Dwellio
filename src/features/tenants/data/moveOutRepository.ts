import { supabase } from '../../../lib/supabase'

export type MoveOutInspection = {
  id: string
  organization_id: string
  lease_id: string
  tenant_id: string
  unit_id: string
  inspected_at: string
  status: 'draft' | 'completed'
  notes: string | null
  created_by: string
  completed_at: string | null
}
export type MoveOutCharge = {
  id: string
  inspection_id: string
  title: string
  description: string | null
  amount: number
}

export type MoveOutWorkspace = {
  inspection: MoveOutInspection | null
  charges: MoveOutCharge[]
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
    .select('id, organization_id, lease_id, tenant_id, unit_id, inspected_at, status, notes, created_by, completed_at')
    .eq('lease_id', leaseId)
    .limit(1)
  if (error) {
    if (isMissingTable(error)) return {
      inspection: null, charges: [], schemaReady: false,
      error: 'Inspection storage is not installed. Apply supabase/move_out_inspections_v1.sql in Supabase first.',
    }
    throw error
  }
  const inspection = ((inspections ?? [])[0] ?? null) as MoveOutInspection | null
  if (!inspection) return { inspection: null, charges: [], schemaReady: true, error: null }
  const { data, error: chargeError } = await supabase
    .from('move_out_inspection_bills')
    .select('id, inspection_id, title, description, amount')
    .eq('inspection_id', inspection.id)
    .order('created_at')
  if (chargeError) throw chargeError
  return {
    inspection,
    charges: (data ?? []).map(item => ({ ...item, amount: Number(item.amount) })) as MoveOutCharge[],
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
    inspected_at: args.date,
    created_by: auth.user.id,
  })
  if (error) throw error
}

export async function updateMoveOutInspection(
  inspectionId: string, data: { inspected_at?: string; notes?: string | null; status?: 'completed' },
) {
  const payload: Record<string, unknown> = { ...data, updated_at: new Date().toISOString() }
  if (data.status === 'completed') payload.completed_at = new Date().toISOString()
  const { data: result, error } = await supabase.from('move_out_inspections')
    .update(payload).eq('id', inspectionId).eq('status', 'draft').select('id')
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
