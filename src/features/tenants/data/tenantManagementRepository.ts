import { supabase } from '../../../lib/supabase'

export type TenantRecord = {
  id: string
  full_name: string
  email: string
  phone: string
  identification_type: string
  date_of_birth: string | null
  status: string
  user_id: string | null
  created_at: string
}

export type TenantLease = {
  id: string
  tenant_id: string
  unit_id: string
  start_date: string
  end_date: string
  notice_date: string | null
  move_out_date: string | null
  rent_amount: number
  deposit_amount: number
  due_day: number
  grace_period_days: number
  billing_frequency: string
  status: string
  propertyName: string
  buildingName: string
  floorName: string
  unitName: string
  propertyId: string
}

export type TenantInvoice = {
  id: string
  lease_id: string
  tenant_id: string
  invoice_number: string
  invoice_type: string
  billing_period_start: string
  billing_period_end: string
  current_charges: number
  previous_balance: number
  total_payable: number
  paid_amount: number
  outstanding_amount: number
  status: string
  due_date: string | null
  carriedFrom: Array<{ invoice_number: string; amount: number }>
}

export type TenantMoveOutRequest = {
  id: string
  lease_id: string
  tenant_id: string
  proposed_move_out_date: string
  reason: string | null
  status: 'pending' | 'accepted' | 'declined'
  submitted_at: string
  reviewed_at: string | null
  decision_reason: string | null
}

export type TenantEmergencyContact = {
  tenant_id: string
  full_name: string
  relationship: string
  phone: string
}

export type TenantProfile = {
  tenant: TenantRecord
  leases: TenantLease[]
  invoices: TenantInvoice[]
  requests: TenantMoveOutRequest[]
  contacts: TenantEmergencyContact[]
  balance: number | null
  balanceIssue: string | null
}

export type TenantDirectoryData = {
  profiles: TenantProfile[]
}

function numberValue(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function chunks<T>(items: T[], size = 85): T[][] {
  const batches: T[][] = []
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size))
  return batches
}

type RawInvoice = {
  id: string
  lease_id: string
  tenant_id: string
  invoice_number: string
  invoice_type: string
  billing_period_start: string
  billing_period_end: string
  current_charges: number | string
  previous_balance: number | string
  total_payable: number | string
  paid_amount: number | string
  outstanding_amount: number | string
  status: string
  due_date: string | null
}

type Line = { id: string; invoice_id: string; is_receivable: boolean }
type Source = { invoice_line_id: string; source_invoice_id: string; amount: number | string }

type BalanceResult = { amount: number | null; issue: string | null }
type LedgerTotals = {
  results: Map<string, BalanceResult>
  sourcesByInvoice: Map<string, Array<{ invoice_number: string; amount: number }>>
}

async function computeLedgerBalances(rawInvoices: RawInvoice[]): Promise<LedgerTotals> {
  const results = new Map<string, BalanceResult>()
  const sourcesByInvoice = new Map<string, Array<{ invoice_number: string; amount: number }>>()
  const active = rawInvoices.filter(invoice => invoice.status !== 'void')
  const invoiceById = new Map(active.map(invoice => [invoice.id, invoice]))
  const invoiceIds = active.map(invoice => invoice.id)
  const lines: Line[] = []

  // Invoice source lines identify amounts rolled into later invoices.
  // The same debt must only appear ONCE in an organization's tenant balance.
  for (const batch of chunks(invoiceIds)) {
    const { data, error } = await supabase
      .from('invoice_lines')
      .select('id, invoice_id, is_receivable')
      .in('invoice_id', batch)
    if (error) throw error
    lines.push(...((data ?? []) as Line[]))
  }

  const sources: Source[] = []
  for (const batch of chunks(lines.map(line => line.id))) {
    const { data, error } = await supabase
      .from('invoice_line_sources')
      .select('invoice_line_id, source_invoice_id, amount')
      .in('invoice_line_id', batch)
    if (error) throw error
    sources.push(...((data ?? []) as Source[]))
  }

  const lineById = new Map(lines.map(line => [line.id, line]))
  const rolledByInvoice = new Map<string, number>()
  const duplicatedByTenant = new Map<string, number>()
  const problematicTenants = new Set<string>()

  for (const source of sources) {
    const destinationLine = lineById.get(source.invoice_line_id)
    const destinationId = destinationLine?.invoice_id
    const destination = destinationId ? invoiceById.get(destinationId) : null
    if (!destination) continue
    const origin = invoiceById.get(source.source_invoice_id)

    const amount = numberValue(source.amount)
    if (source.source_invoice_id === destination.id ||
        amount <= 0 || (origin && origin.tenant_id !== destination.tenant_id)) {
      problematicTenants.add(destination.tenant_id)
      continue
    }

    rolledByInvoice.set(destination.id, (rolledByInvoice.get(destination.id) ?? 0) + amount)
    const originNumber = rawInvoices.find(invoice => invoice.id === source.source_invoice_id)?.invoice_number
      ?? 'Source invoice'
    const list = sourcesByInvoice.get(destination.id) ?? []
    list.push({ invoice_number: originNumber, amount })
    sourcesByInvoice.set(destination.id, list)

    // Carry-forward lines with is_receivable=false are INFORMATIONAL,
    // not a duplicate charge in invoices.outstanding_amount. Never subtract
    // them again. Older legacy schemas may have truly receivable copies,
    // which need separate reconciliation.
    if (origin && destinationLine?.is_receivable) {
      duplicatedByTenant.set(
        destination.tenant_id,
        (duplicatedByTenant.get(destination.tenant_id) ?? 0) + amount,
      )
    }
  }

  const byTenant = new Map<string, RawInvoice[]>()
  for (const invoice of active) {
    const group = byTenant.get(invoice.tenant_id) ?? []
    group.push(invoice)
    byTenant.set(invoice.tenant_id, group)
  }

  for (const [tenantId, invoices] of byTenant) {
    // A nonzero carried-forward balance without traceable sources cannot
    // safely be reconciled, so show a verification state rather than a guess.
    const sourceMissing = invoices.some(invoice =>
      numberValue(invoice.previous_balance) > 0.01 &&
      Math.abs(numberValue(invoice.previous_balance) -
        (rolledByInvoice.get(invoice.id) ?? 0)) > 0.01,
    )
    if (problematicTenants.has(tenantId) || sourceMissing) {
      results.set(tenantId, {
        amount: null,
        issue: 'Carried-forward invoice sources need reconciliation before a reliable total can be shown.',
      })
      continue
    }

    const gross = invoices.reduce((sum, invoice) =>
      sum + Math.max(0, numberValue(invoice.outstanding_amount)), 0)
    const copied = duplicatedByTenant.get(tenantId) ?? 0
    const net = gross - copied
    if (net < -0.01) {
      results.set(tenantId, {
        amount: null,
        issue: 'The recorded payments and carried-forward balances need reconciliation.',
      })
    } else {
      results.set(tenantId, { amount: Math.max(net, 0), issue: null })
    }
  }
  return { results, sourcesByInvoice }
}

export async function fetchTenantDirectory(organizationId: string): Promise<TenantDirectoryData> {
  const tenantResult = await supabase.from('tenants')
    .select('id, full_name, email, phone, identification_type, date_of_birth, status, user_id, created_at')
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .order('full_name')
  if (tenantResult.error) throw tenantResult.error

  const tenants = (tenantResult.data ?? []) as TenantRecord[]
  if (!tenants.length) return { profiles: [] }
  const tenantIds = new Set(tenants.map(tenant => tenant.id))

  const [leasesResult, contactResult] = await Promise.all([
    supabase.from('leases')
      .select('id, tenant_id, unit_id, start_date, end_date, notice_date, move_out_date, rent_amount, deposit_amount, due_day, grace_period_days, billing_frequency, status')
      .eq('organization_id', organizationId)
      .is('deleted_at', null),
    supabase.from('tenant_emergency_contacts')
      .select('tenant_id, full_name, relationship, phone')
      .eq('organization_id', organizationId),
  ])
  if (leasesResult.error) throw leasesResult.error
  if (contactResult.error) throw contactResult.error

  // Never query every organization's invoices and filter in the browser.
  const rawInvoices: RawInvoice[] = []
  for (const batch of chunks([...tenantIds])) {
    const result = await supabase.from('invoices')
      .select('id, lease_id, tenant_id, invoice_number, invoice_type, billing_period_start, billing_period_end, current_charges, previous_balance, total_payable, paid_amount, outstanding_amount, status, due_date')
      .in('tenant_id', batch)
      .order('billing_period_start', { ascending: false })
    if (result.error) throw result.error
    rawInvoices.push(...((result.data ?? []) as RawInvoice[]))
  }

  const rawLeases = (leasesResult.data ?? []).filter(lease => tenantIds.has(lease.tenant_id))
  const unitIds = [...new Set(rawLeases.map(lease => lease.unit_id))]

  const [unitResult, requestResult] = await Promise.all([
    unitIds.length
      ? supabase.from('units').select('id, name, floor_id').in('id', unitIds)
      : Promise.resolve({ data: [] as { id: string; name: string; floor_id: string }[], error: null }),
    rawLeases.length
      ? supabase.from('move_out_requests')
        .select('id, lease_id, tenant_id, proposed_move_out_date, reason, status, submitted_at, reviewed_at, decision_reason')
        .in('lease_id', rawLeases.map(lease => lease.id))
        .order('submitted_at', { ascending: false })
      : Promise.resolve({ data: [] as TenantMoveOutRequest[], error: null }),
  ])

  if (unitResult.error) throw unitResult.error
  if (requestResult.error) throw requestResult.error

  const units = unitResult.data ?? []
  const floorsResult = units.length
    ? await supabase.from('floors').select('id, name, building_id')
      .in('id', [...new Set(units.map(unit => unit.floor_id))])
    : { data: [] as { id: string; name: string; building_id: string }[], error: null }
  if (floorsResult.error) throw floorsResult.error
  const floors = floorsResult.data ?? []

  const buildingsResult = floors.length
    ? await supabase.from('buildings').select('id, name, property_id')
      .in('id', [...new Set(floors.map(floor => floor.building_id))])
    : { data: [] as { id: string; name: string; property_id: string }[], error: null }
  if (buildingsResult.error) throw buildingsResult.error
  const buildings = buildingsResult.data ?? []

  const propertiesResult = buildings.length
    ? await supabase.from('properties').select('id, name')
      .eq('organization_id', organizationId)
      .in('id', [...new Set(buildings.map(building => building.property_id))])
    : { data: [] as { id: string; name: string }[], error: null }
  if (propertiesResult.error) throw propertiesResult.error

  const unitMap = new Map(units.map(unit => [unit.id, unit]))
  const floorMap = new Map(floors.map(floor => [floor.id, floor]))
  const buildingMap = new Map(buildings.map(building => [building.id, building]))
  const propertyMap = new Map((propertiesResult.data ?? []).map(property => [property.id, property]))

  const leases: TenantLease[] = rawLeases.map(lease => {
    const unit = unitMap.get(lease.unit_id)
    const floor = unit ? floorMap.get(unit.floor_id) : undefined
    const building = floor ? buildingMap.get(floor.building_id) : undefined
    const property = building ? propertyMap.get(building.property_id) : undefined
    return {
      ...lease,
      rent_amount: numberValue(lease.rent_amount),
      deposit_amount: numberValue(lease.deposit_amount),
      propertyName: property?.name ?? 'Unknown property',
      propertyId: property?.id ?? '',
      buildingName: building?.name ?? 'Unknown building',
      floorName: floor?.name ?? 'Unknown floor',
      unitName: unit?.name ?? 'Unknown unit',
    }
  })

  // Accounting-source permissions may be narrower than tenant invoice access.
  // An unavailable ledger must not take the entire tenant directory offline.
  let balances = new Map<string, BalanceResult>()
  let sourcesByInvoice = new Map<string, Array<{ invoice_number: string; amount: number }>>()
  try {
    const ledger = await computeLedgerBalances(rawInvoices)
    balances = ledger.results
    sourcesByInvoice = ledger.sourcesByInvoice
  } catch (cause) {
    console.error('[Tenants] Unable to verify carried balances', cause)
    for (const invoice of rawInvoices) {
      balances.set(invoice.tenant_id, {
        amount: null,
        issue: 'Invoice details are available, but the total account balance could not be verified.',
      })
    }
  }
  const requests = (requestResult.data ?? []) as TenantMoveOutRequest[]

  return {
    profiles: tenants.map(tenant => ({
      tenant,
      leases: leases.filter(lease => lease.tenant_id === tenant.id)
        .sort((a, b) => b.start_date.localeCompare(a.start_date)),
      invoices: rawInvoices.filter(invoice => invoice.tenant_id === tenant.id)
        .map(invoice => ({
          ...invoice,
          current_charges: numberValue(invoice.current_charges),
          previous_balance: numberValue(invoice.previous_balance),
          total_payable: numberValue(invoice.total_payable),
          paid_amount: numberValue(invoice.paid_amount),
          outstanding_amount: numberValue(invoice.outstanding_amount),
          carriedFrom: sourcesByInvoice.get(invoice.id) ?? [],
        })),
      contacts: (contactResult.data ?? []).filter(contact => contact.tenant_id === tenant.id),
      requests: requests.filter(request => request.tenant_id === tenant.id),
      balance: balances.get(tenant.id)?.amount ?? (rawInvoices.some(i => i.tenant_id === tenant.id) ? null : 0),
      balanceIssue: balances.get(tenant.id)?.issue ??
        (rawInvoices.some(i => i.tenant_id === tenant.id)
          ? 'Could not reconcile the invoice ledger.'
          : null),
    })),
  }
}

export async function decideMoveOutRequest(
  requestId: string,
  decision: 'accepted' | 'declined',
  reason: string | null,
) {
  const { data, error } = await supabase.rpc('review_move_out_request', {
    p_request_id: requestId,
    p_decision: decision,
    p_decision_reason: reason,
  })
  if (error) throw error
  return data
}


export async function updateTenantContactDetails(
  organizationId: string,
  tenantId: string,
  input: { full_name: string; email: string; phone: string },
): Promise<void> {
  const fullName = input.full_name.trim()
  const email = input.email.trim().toLowerCase()
  const phone = input.phone.trim()
  if (fullName.length < 2 || fullName.length > 150) throw new Error('Enter a valid full name.')
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Enter a valid email address.')
  if (phone.length < 7 || phone.length > 30) throw new Error('Enter a valid phone number.')

  const { data, error } = await supabase
    .from('tenants')
    .update({ full_name: fullName, email, phone })
    .eq('id', tenantId)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .select('id')
  if (error) throw error
  if (!data?.length) {
    throw new Error('Tenant details could not be updated. Check your organization permissions.')
  }
}
