import { supabase } from '../../../lib/supabase'

import type {
  BalanceSource,
  BillCharge,
  BillChargeDetail,
  BillDraftRow,
  BillingCycle,
  BillingDashboardData,
  BillingIssue,
  BillingProperty,
  BillingServiceSummary,
  DraftDetail,
  GenerateDraftsResult,
  WorkspaceIdentity,
} from './types'


type BillingErrorLike = {
  message?: unknown
  code?: unknown
  details?: unknown
  hint?: unknown
}

function logBillingRepositoryError(
  operation: string,
  error: unknown,
  context: Record<string, unknown> = {},
) {
  const payload =
    typeof error === 'object' && error !== null
      ? error as BillingErrorLike
      : {}

  console.error(`[BillingRepository] ${operation} failed`, {
    context,
    message:
      typeof payload.message === 'string'
        ? payload.message
        : error instanceof Error
          ? error.message
          : String(error),
    code: payload.code,
    details: payload.details,
    hint: payload.hint,
    error,
  })
}

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function monthDateRange(date = new Date()) {
  const year = date.getFullYear()
  const month = date.getMonth()
  const start = `${year}-${String(month + 1).padStart(2, '0')}-01`
  const lastDay = new Date(year, month + 1, 0).getDate()
  const end = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  return { start, end }
}

function rateApplies(
  effectiveFrom: string,
  effectiveTo: string | null,
  date: string,
) {
  return (
    effectiveFrom <= date &&
    (effectiveTo === null || effectiveTo >= date)
  )
}

export async function fetchBillingProperties(): Promise<BillingProperty[]> {
  const { data, error } = await supabase
    .from('properties')
    .select('id, organization_id, name')
    .eq('status', 'active')
    .is('deleted_at', null)
    .order('name')

  if (error) throw error
  return (data ?? []) as BillingProperty[]
}

export async function fetchWorkspaceIdentity(
  property: BillingProperty,
): Promise<WorkspaceIdentity> {
  const { data: userResult, error: userError } = await supabase.auth.getUser()
  if (userError) throw userError

  const user = userResult.user
  if (!user) throw new Error('You are not signed in.')

  const [organizationResult, membershipResult] = await Promise.all([
    supabase
      .from('organizations')
      .select('name')
      .eq('id', property.organization_id)
      .single(),

    supabase
      .from('organization_members')
      .select('role')
      .eq('organization_id', property.organization_id)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .maybeSingle(),
  ])

  if (organizationResult.error) throw organizationResult.error
  if (membershipResult.error) throw membershipResult.error

  const firstName =
    user.user_metadata?.full_name?.split(' ')[0] ??
    user.email?.split('@')[0] ??
    'there'

  const role = membershipResult.data?.role ?? 'member'

  return {
    organizationName: organizationResult.data.name,
    role: role.charAt(0).toUpperCase() + role.slice(1),
    firstName,
  }
}

export async function fetchBillingCycles(
  propertyId: string,
): Promise<BillingCycle[]> {
  const { data, error } = await supabase
    .from('billing_cycles')
    .select(`
      id,
      property_id,
      period_start,
      period_end,
      status,
      created_at,
      updated_at
    `)
    .eq('property_id', propertyId)
    .order('period_start', { ascending: false })

  if (error) throw error
  return (data ?? []) as BillingCycle[]
}

export async function createCurrentBillingCycle(
  propertyId: string,
): Promise<string> {
  const { data, error } = await supabase.rpc(
    'create_billing_cycle',
    {
      p_property_id: propertyId,
    },
  )

  if (error) {
    logBillingRepositoryError(
      'create billing cycle rpc',
      error,
      { propertyId },
    )
    throw error
  }

  if (typeof data !== 'string' || !data) {
    const resultError = new Error(
      'The billing cycle RPC did not return a cycle id.',
    )

    logBillingRepositoryError(
      'validate create billing cycle rpc result',
      resultError,
      { propertyId, data },
    )

    throw resultError
  }

  return data
}

export async function fetchBillingDashboard(
  propertyId: string,
  cycle: BillingCycle,
): Promise<BillingDashboardData> {
  const [unitsResult, servicesResult] = await Promise.all([
    supabase
      .from('units')
      .select('id, name')
      .eq('property_id', propertyId)
      .is('deleted_at', null),

    supabase
      .from('billing_services')
      .select('id, name, billing_method, applicability, is_active')
      .eq('property_id', propertyId)
      .eq('is_active', true),
  ])

  if (unitsResult.error) throw unitsResult.error
  if (servicesResult.error) throw servicesResult.error

  const units = unitsResult.data ?? []
  const services = servicesResult.data ?? []
  const unitIds = units.map(unit => unit.id)

  if (unitIds.length === 0) {
    return {
      leaseCount: 0,
      futureMoveIns: 0,
      movingOut: 0,
      draftCount: 0,
      approvedCount: 0,
      invoiceCount: 0,
      services: [],
      drafts: [],
      configurationIssues: [],
    }
  }

  const { data: leases, error: leasesError } = await supabase
    .from('leases')
    .select('id, unit_id, tenant_id, status')
    .in('unit_id', unitIds)
    .in('status', ['active', 'notice_given', 'not_moved_in_yet'])

  if (leasesError) throw leasesError

  const currentLeases = leases ?? []
  const leaseIds = currentLeases.map(lease => lease.id)
  const serviceIds = services.map(service => service.id)

  let rates: Array<{
    service_id: string
    rate: number | string
    effective_from: string
    effective_to: string | null
  }> = []

  if (serviceIds.length > 0) {
    const result = await supabase
      .from('billing_service_rates')
      .select('service_id, rate, effective_from, effective_to')
      .in('service_id', serviceIds)

    if (result.error) throw result.error
    rates = result.data ?? []
  }

  const metersResult = await supabase
    .from('meters')
    .select('id, unit_id, service_id, status, installed_at, retired_at')
    .in('unit_id', unitIds)

  if (metersResult.error) throw metersResult.error
  const meters = metersResult.data ?? []

  let subscriptions: Array<{
    lease_id: string
    tenant_id: string
    service_id: string
    status: string
    started_at: string
    ended_at: string | null
  }> = []

  if (leaseIds.length > 0) {
    const result = await supabase
      .from('tenant_service_subscriptions')
      .select('lease_id, tenant_id, service_id, status, started_at, ended_at')
      .in('lease_id', leaseIds)
      .eq('status', 'active')

    if (result.error) throw result.error
    subscriptions = result.data ?? []
  }

  const draftsResult = await supabase
    .from('bill_drafts')
    .select(`
      id,
      billing_cycle_id,
      lease_id,
      tenant_id,
      unit_id,
      billing_context,
      current_charges,
      previous_balance,
      total_payable,
      status,
      created_at
    `)
    .eq('billing_cycle_id', cycle.id)
    .neq('status', 'cancelled')
    .order('created_at', { ascending: true })

  if (draftsResult.error) throw draftsResult.error
  const rawDrafts = draftsResult.data ?? []

  const draftTenantIds = [...new Set(rawDrafts.map(draft => draft.tenant_id))]

  const tenantNameMap = new Map<string, string>()
  if (draftTenantIds.length > 0) {
    const tenantsResult = await supabase
      .from('tenants')
      .select('id, full_name')
      .in('id', draftTenantIds)

    if (tenantsResult.error) throw tenantsResult.error

    for (const tenant of tenantsResult.data ?? []) {
      tenantNameMap.set(tenant.id, tenant.full_name)
    }
  }

  const unitMap = new Map(units.map(unit => [unit.id, unit.name]))

  const drafts = rawDrafts.map(draft => ({
    ...draft,
    current_charges: numberValue(draft.current_charges),
    previous_balance: numberValue(draft.previous_balance),
    total_payable: numberValue(draft.total_payable),
    tenantName: tenantNameMap.get(draft.tenant_id) ?? 'Tenant',
    unitName: unitMap.get(draft.unit_id) ?? 'Unit',
  })) as BillDraftRow[]

  const utilityEligibleLeases = currentLeases.filter(
    lease => lease.status === 'active' || lease.status === 'notice_given',
  )

  const serviceSummaries: BillingServiceSummary[] = []
  const configurationIssues: BillingIssue[] = []

  for (const service of services) {
    const applicableRates = rates
      .filter(
        rate =>
          rate.service_id === service.id &&
          rateApplies(rate.effective_from, rate.effective_to, cycle.period_end),
      )
      .sort((a, b) => b.effective_from.localeCompare(a.effective_from))

    const currentRate = applicableRates[0]
      ? numberValue(applicableRates[0].rate)
      : null

    const serviceSubscriptions = subscriptions.filter(
      subscription => subscription.service_id === service.id,
    )

    const subscribedLeaseIds = new Set(
      serviceSubscriptions.map(subscription => subscription.lease_id),
    )

    let expectedLeases = utilityEligibleLeases

    if (service.applicability === 'optional') {
      expectedLeases = utilityEligibleLeases.filter(lease =>
        subscribedLeaseIds.has(lease.id),
      )
    }

    const expectedUnitIds = new Set(expectedLeases.map(lease => lease.unit_id))

    const serviceMeters = meters.filter(
      meter =>
        meter.service_id === service.id &&
        meter.status === 'active' &&
        expectedUnitIds.has(meter.unit_id),
    )

    const meteredUnitIds = new Set(serviceMeters.map(meter => meter.unit_id))

    serviceSummaries.push({
      id: service.id,
      name: service.name,
      billingMethod: service.billing_method,
      applicability: service.applicability,
      currentRate,
      targetCount: expectedUnitIds.size,
      meterCount: meteredUnitIds.size,
      subscriberCount: serviceSubscriptions.length,
    })

    if (currentRate === null) {
      configurationIssues.push({
        id: `rate-${service.id}`,
        type: 'missing_rate',
        serviceId: service.id,
        serviceName: service.name,
        title: `${service.name} rate missing`,
        description: 'No active service rate applies to this billing period.',
        action: 'service',
      })
    }

    if (service.billing_method === 'usage') {
      for (const lease of expectedLeases) {
        if (meteredUnitIds.has(lease.unit_id)) continue

        configurationIssues.push({
          id: `meter-${service.id}-${lease.unit_id}`,
          type: 'missing_meter',
          unitId: lease.unit_id,
          unitName: unitMap.get(lease.unit_id) ?? 'Unit',
          serviceId: service.id,
          serviceName: service.name,
          title: `${service.name} meter not configured`,
          description: 'This unit requires a meter before usage billing can be calculated.',
          action: 'meter',
        })
      }
    }
  }

  let invoiceCount = 0
  const draftIds = drafts.map(draft => draft.id)

  if (draftIds.length > 0) {
    const { count, error } = await supabase
      .from('invoices')
      .select('id', { count: 'exact', head: true })
      .in('bill_draft_id', draftIds)
      .neq('status', 'void')

    if (error) throw error
    invoiceCount = count ?? 0
  }

  return {
    leaseCount: currentLeases.length,
    futureMoveIns: currentLeases.filter(
      lease => lease.status === 'not_moved_in_yet',
    ).length,
    movingOut: drafts.filter(
      draft => draft.billing_context === 'move_out',
    ).length,
    draftCount: drafts.length,
    approvedCount: drafts.filter(draft => draft.status === 'approved').length,
    invoiceCount,
    services: serviceSummaries,
    drafts,
    configurationIssues,
  }
}

export async function generatePropertyBillDrafts(
  billingCycleId: string,
): Promise<GenerateDraftsResult> {
  const { data, error } = await supabase.rpc('generate_property_bill_drafts', {
    p_billing_cycle_id: billingCycleId,
  })

  if (error) {
    console.error('[BillingRepository] generate_property_bill_drafts RPC failed', {
      billingCycleId,
      error,
    })
    throw error
  }

  const result = data as GenerateDraftsResult

  if (result?.errors?.length > 0) {
    console.error('[BillingRepository] generate_property_bill_drafts returned errors', {
      billingCycleId,
      errors: result.errors,
      result,
    })
  }

  return result
}

export async function fetchDraftDetail(
  draft: BillDraftRow,
): Promise<DraftDetail> {
  const { data: charges, error: chargesError } = await supabase
    .from('bill_charges')
    .select(`
      id,
      bill_draft_id,
      service_id,
      charge_type,
      description,
      amount,
      created_at
    `)
    .eq('bill_draft_id', draft.id)
    .order('created_at', { ascending: true })

  if (chargesError) throw chargesError

  const chargeIds = (charges ?? []).map(charge => charge.id)

  let rawDetails: Array<{
    id: string
    bill_charge_id: string
    meter_id: string | null
    previous_reading_id: string | null
    current_reading_id: string | null
    previous_reading: number | string | null
    current_reading: number | string | null
    consumption: number | string | null
    rate: number | string | null
  }> = []

  if (chargeIds.length > 0) {
    const result = await supabase
      .from('bill_charge_details')
      .select(`
        id,
        bill_charge_id,
        meter_id,
        previous_reading_id,
        current_reading_id,
        previous_reading,
        current_reading,
        consumption,
        rate
      `)
      .in('bill_charge_id', chargeIds)

    if (result.error) throw result.error
    rawDetails = result.data ?? []
  }

  const balanceSourceResult = await supabase
    .from('bill_draft_balance_sources')
    .select('source_invoice_id, amount')
    .eq('bill_draft_id', draft.id)

  if (balanceSourceResult.error) throw balanceSourceResult.error

  const detailsByCharge = new Map<string, BillChargeDetail[]>()

  for (const rawDetail of rawDetails) {
    const detail: BillChargeDetail = {
      id: rawDetail.id,
      bill_charge_id: rawDetail.bill_charge_id,
      meter_id: rawDetail.meter_id,
      previous_reading_id: rawDetail.previous_reading_id,
      current_reading_id: rawDetail.current_reading_id,
      previous_reading:
        rawDetail.previous_reading === null
          ? null
          : numberValue(rawDetail.previous_reading),
      current_reading:
        rawDetail.current_reading === null
          ? null
          : numberValue(rawDetail.current_reading),
      consumption:
        rawDetail.consumption === null
          ? null
          : numberValue(rawDetail.consumption),
      rate: rawDetail.rate === null ? null : numberValue(rawDetail.rate),
    }

    const existing = detailsByCharge.get(detail.bill_charge_id) ?? []
    existing.push(detail)
    detailsByCharge.set(detail.bill_charge_id, existing)
  }

  const mappedCharges: BillCharge[] = (charges ?? []).map(charge => ({
    id: charge.id,
    bill_draft_id: charge.bill_draft_id,
    service_id: charge.service_id,
    charge_type: charge.charge_type,
    description: charge.description,
    amount: numberValue(charge.amount),
    details: detailsByCharge.get(charge.id) ?? [],
  }))

  const rawSources = balanceSourceResult.data ?? []
  const sourceInvoiceIds = rawSources.map(source => source.source_invoice_id)
  const invoiceNumberMap = new Map<string, string>()

  if (sourceInvoiceIds.length > 0) {
    const { data, error } = await supabase
      .from('invoices')
      .select('id, invoice_number')
      .in('id', sourceInvoiceIds)

    if (error) throw error

    for (const invoice of data ?? []) {
      invoiceNumberMap.set(invoice.id, invoice.invoice_number)
    }
  }

  const balanceSources: BalanceSource[] = rawSources.map(source => ({
    source_invoice_id: source.source_invoice_id,
    invoiceNumber:
      invoiceNumberMap.get(source.source_invoice_id) ?? 'Previous invoice',
    amount: numberValue(source.amount),
  }))

  return {
    draft,
    charges: mappedCharges,
    balanceSources,
  }
}

export async function approveBillDraft(billDraftId: string) {
  const { data, error } = await supabase
    .from('bill_drafts')
    .update({
      status: 'approved',
      updated_at: new Date().toISOString(),
    })
    .eq('id', billDraftId)
    .in('status', ['draft', 'reviewed'])
    .select('id')

  if (error) throw error

  if (!data || data.length === 0) {
    throw new Error('This bill draft could not be approved. Refresh and try again.')
  }
}

export async function approveAllBillDrafts(billingCycleId: string) {
  const { data, error } = await supabase
    .from('bill_drafts')
    .update({
      status: 'approved',
      updated_at: new Date().toISOString(),
    })
    .eq('billing_cycle_id', billingCycleId)
    .neq('status', 'cancelled')
    .select('id')

  if (error) throw error
  return data?.length ?? 0
}

export async function correctMeterReading(
  readingId: string,
  value: number,
) {
  const { data: userResult, error: userError } = await supabase.auth.getUser()
  if (userError) throw userError
  if (!userResult.user) throw new Error('You are not signed in.')

  const { data, error } = await supabase
    .from('meter_readings')
    .update({
      value,
      recorded_by: userResult.user.id,
      recorded_at: new Date().toISOString(),
    })
    .eq('id', readingId)
    .eq('reading_type', 'periodic')
    .select('id')

  if (error) throw error

  if (!data || data.length === 0) {
    throw new Error('This meter reading could not be updated. Refresh and try again.')
  }
}

export async function finalizeBillingCycle(billingCycleId: string) {
  const { data, error } = await supabase.rpc('finalize_billing_cycle', {
    p_billing_cycle_id: billingCycleId,
  })

  if (error) throw error
  return data
}
