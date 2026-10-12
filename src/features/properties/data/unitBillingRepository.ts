import { supabase } from '../../../lib/supabase'

export type UnitBillingCycle = {
  id: string
  period_start: string
  period_end: string
  status: string
}

export type UnitReadingHistory = {
  id: string
  meterId: string
  meterSerial: string
  date: string
  value: number
  type: string
  cycleId: string | null
  cycleLabel: string | null
}

export type UnitMeterUsage = {
  id: string
  serial: string
  status: string
  previous: number | null
  current: number | null
  consumption: number | null
  rate: number | null
  amount: number | null
  amountKind: 'billed' | 'draft' | 'estimate' | 'none'
  previousDate: string | null
  currentDate: string | null
  history: UnitReadingHistory[]
}

export type UnitServiceUsage = {
  id: string
  name: string
  method: 'usage' | 'fixed'
  applicability: string
  isActive: boolean
  applicableRate: number | null
  chargedAmount: number | null
  chargeKind: 'billed' | 'draft' | 'configured' | 'none'
  meters: UnitMeterUsage[]
}

export type UnitBillingBreakdown = {
  cycles: UnitBillingCycle[]
  services: UnitServiceUsage[]
  selectedCycle: UnitBillingCycle | null
  invoiceNumber: string | null
}

type Meter = {
  id: string
  service_id: string
  serial_number: string
  status: string
  installed_at: string | null
  retired_at: string | null
}

type Reading = {
  id: string
  meter_id: string
  billing_cycle_id: string | null
  reading_type: string
  reading_date: string
  value: number | string
  recorded_at: string
  status: string
}

type Rate = {
  service_id: string
  rate: number | string
  effective_from: string
  effective_to: string | null
}

type Charge = {
  id: string
  service_id: string | null
  amount: number | string
}

type ChargeDetail = {
  bill_charge_id: string
  meter_id: string | null
  previous_reading: number | string | null
  current_reading: number | string | null
  consumption: number | string | null
  rate: number | string | null
}

function numeric(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const converted = Number(value)
  return Number.isFinite(converted) ? converted : null
}

function byRecentReading(a: Reading, b: Reading) {
  return b.reading_date.localeCompare(a.reading_date) ||
    b.recorded_at.localeCompare(a.recorded_at)
}

function applies(rate: Rate, date: string) {
  return rate.effective_from <= date && (rate.effective_to === null || rate.effective_to >= date)
}

export async function fetchUnitBillingCycles(propertyId: string, unitId: string): Promise<UnitBillingCycle[]> {
  // Verify this unit belongs to the requested property through the existing
  // Property -> Building -> Floor -> Unit hierarchy. Never rely on the label.
  const { data: unit, error: unitError } = await supabase
    .from('units')
    .select('floor_id')
    .eq('id', unitId)
    .is('deleted_at', null)
    .maybeSingle()
  if (unitError) throw unitError
  if (!unit) throw new Error('Unit not found.')

  const { data: floor, error: floorError } = await supabase
    .from('floors')
    .select('building_id')
    .eq('id', unit.floor_id)
    .is('deleted_at', null)
    .maybeSingle()
  if (floorError) throw floorError
  if (!floor) throw new Error('Unit floor not found.')

  const { data: building, error: buildingError } = await supabase
    .from('buildings')
    .select('id')
    .eq('id', floor.building_id)
    .eq('property_id', propertyId)
    .is('deleted_at', null)
    .maybeSingle()
  if (buildingError) throw buildingError
  if (!building) throw new Error('Unit does not belong to this property.')

  const { data, error } = await supabase
    .from('billing_cycles')
    .select('id, period_start, period_end, status')
    .eq('property_id', propertyId)
    .order('period_start', { ascending: false })
  if (error) throw error
  return (data ?? []) as UnitBillingCycle[]
}

export async function fetchUnitBillingBreakdown(
  propertyId: string,
  unitId: string,
  cycles: UnitBillingCycle[],
  cycleId: string | null,
): Promise<UnitBillingBreakdown> {
  const selectedCycle = cycles.find(cycle => cycle.id === cycleId) ?? null

  const [servicesResult, metersResult] = await Promise.all([
    supabase
      .from('billing_services')
      .select('id, name, billing_method, applicability, is_active')
      .eq('property_id', propertyId)
      .order('name'),
    supabase
      .from('meters')
      .select('id, service_id, serial_number, status, installed_at, retired_at')
      .eq('unit_id', unitId),
  ])
  if (servicesResult.error) throw servicesResult.error
  if (metersResult.error) throw metersResult.error

  const services = servicesResult.data ?? []
  const meters = (metersResult.data ?? []) as Meter[]
  const serviceIds = services.map(service => service.id)
  const meterIds = meters.map(meter => meter.id)

  const [ratesResult, readingsResult, draftsResult] = await Promise.all([
    serviceIds.length
      ? supabase.from('billing_service_rates')
        .select('service_id, rate, effective_from, effective_to')
        .in('service_id', serviceIds)
      : Promise.resolve({ data: [] as Rate[], error: null }),
    meterIds.length
      ? supabase.from('meter_readings')
        .select('id, meter_id, billing_cycle_id, reading_type, reading_date, value, recorded_at, status')
        .in('meter_id', meterIds)
        .eq('status', 'active')
        .order('reading_date', { ascending: false })
      : Promise.resolve({ data: [] as Reading[], error: null }),
    selectedCycle
      ? supabase.from('bill_drafts')
        .select('id')
        .eq('unit_id', unitId)
        .eq('billing_cycle_id', selectedCycle.id)
        .neq('status', 'cancelled')
      : Promise.resolve({ data: [] as { id: string }[], error: null }),
  ])
  if (ratesResult.error) throw ratesResult.error
  if (readingsResult.error) throw readingsResult.error
  if (draftsResult.error) throw draftsResult.error

  const rates = (ratesResult.data ?? []) as Rate[]
  const readings = (readingsResult.data ?? []) as Reading[]
  const draftIds = (draftsResult.data ?? []).map(draft => draft.id)
  let charges: Charge[] = []
  let details: ChargeDetail[] = []
  let invoiceNumber: string | null = null

  if (draftIds.length) {
    const [chargesResult, invoicesResult] = await Promise.all([
      supabase.from('bill_charges')
        .select('id, service_id, amount')
        .in('bill_draft_id', draftIds),
      supabase.from('invoices')
        .select('invoice_number')
        .in('bill_draft_id', draftIds)
        .neq('status', 'void')
        .limit(1),
    ])
    if (chargesResult.error) throw chargesResult.error
    if (invoicesResult.error) throw invoicesResult.error
    charges = (chargesResult.data ?? []) as Charge[]
    invoiceNumber = invoicesResult.data?.[0]?.invoice_number ?? null

    if (charges.length) {
      const result = await supabase.from('bill_charge_details')
        .select('bill_charge_id, meter_id, previous_reading, current_reading, consumption, rate')
        .in('bill_charge_id', charges.map(charge => charge.id))
      if (result.error) throw result.error
      details = (result.data ?? []) as ChargeDetail[]
    }
  }

  const cycleStartById = new Map(cycles.map(cycle => [cycle.id, cycle.period_start]))
  const dateParts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const dateValue = (type: string) => dateParts.find(part => part.type === type)?.value ?? ''
  const date = selectedCycle?.period_end ??
    `${dateValue('year')}-${dateValue('month')}-${dateValue('day')}`

  const mapped: UnitServiceUsage[] = services.map(service => {
    const serviceRates = rates
      .filter(rate => rate.service_id === service.id && applies(rate, date))
      .sort((a, b) => b.effective_from.localeCompare(a.effective_from))
    const applicableRate = numeric(serviceRates[0]?.rate)
    const relatedCharges = charges.filter(charge => charge.service_id === service.id)
    const chargeTotal = relatedCharges.length
      ? relatedCharges.reduce((sum, charge) => sum + (numeric(charge.amount) ?? 0), 0)
      : null

    const serviceMeters = meters.filter(meter => meter.service_id === service.id)
      .sort((a, b) => a.serial_number.localeCompare(b.serial_number))

    const meterRows = serviceMeters.map(meter => {
      const history = readings
        .filter(reading => reading.meter_id === meter.id)
        .sort(byRecentReading)

      const historyDisplay: UnitReadingHistory[] = history.map(reading => ({
        id: reading.id,
        meterId: meter.id,
        meterSerial: meter.serial_number,
        date: reading.reading_date,
        value: numeric(reading.value) ?? 0,
        type: reading.reading_type,
        cycleId: reading.billing_cycle_id,
        cycleLabel: reading.billing_cycle_id
          ? (cycles.find(cycle => cycle.id === reading.billing_cycle_id)?.period_start ?? null)
          : null,
      }))

      const chargeDetail = relatedCharges
        .flatMap(charge => details.filter(detail => detail.bill_charge_id === charge.id))
        .find(detail => detail.meter_id === meter.id)

      // Monthly periodic readings are unique for each meter and billing cycle.
      const current = selectedCycle
        ? history.find(reading => reading.reading_type === 'periodic' && reading.billing_cycle_id === selectedCycle.id)
        : null

      const previousPeriodic = selectedCycle
        ? history.filter(reading => reading.reading_type === 'periodic' && reading.billing_cycle_id &&
          (cycleStartById.get(reading.billing_cycle_id) ?? '') < selectedCycle.period_start)
          .sort((a, b) =>
            (cycleStartById.get(b.billing_cycle_id ?? '') ?? '').localeCompare(
              cycleStartById.get(a.billing_cycle_id ?? '') ?? '') ||
            byRecentReading(a, b),
          )[0]
        : null

      const opening = selectedCycle
        ? history.filter(reading => reading.reading_type === 'opening' &&
          reading.reading_date <= selectedCycle.period_end).sort(byRecentReading)[0]
        : null
      const previous = previousPeriodic ?? opening ?? null

      const savedPrevious = chargeDetail ? numeric(chargeDetail.previous_reading) : null
      const savedCurrent = chargeDetail ? numeric(chargeDetail.current_reading) : null
      const savedConsumption = chargeDetail ? numeric(chargeDetail.consumption) : null
      const savedRate = chargeDetail ? numeric(chargeDetail.rate) : null
      const previousValue = savedPrevious ?? (previous ? numeric(previous.value) : null)
      const currentValue = savedCurrent ?? (current ? numeric(current.value) : null)
      const computedConsumption = previousValue !== null && currentValue !== null &&
        currentValue >= previousValue ? currentValue - previousValue : null
      const consumption = savedConsumption ?? computedConsumption
      const unitRate = savedRate ?? applicableRate
      const amount = consumption !== null && unitRate !== null
        ? consumption * unitRate
        : null
      const hasChargeSnapshot = Boolean(chargeDetail && savedConsumption !== null)

      return {
        id: meter.id,
        serial: meter.serial_number,
        status: meter.status,
        previous: previousValue,
        current: currentValue,
        consumption,
        rate: unitRate,
        amount,
        amountKind: hasChargeSnapshot
          ? (invoiceNumber ? 'billed' : 'draft')
          : amount !== null && selectedCycle ? 'estimate' : 'none',
        previousDate: previous?.reading_date ?? null,
        currentDate: current?.reading_date ?? null,
        history: historyDisplay,
      } as UnitMeterUsage
    })

    return {
      id: service.id,
      name: service.name,
      method: service.billing_method === 'usage' ? 'usage' : 'fixed',
      applicability: service.applicability,
      isActive: service.is_active === true,
      applicableRate,
      chargedAmount: chargeTotal,
      chargeKind: chargeTotal !== null ? (invoiceNumber ? 'billed' : 'draft') :
        applicableRate !== null && service.billing_method === 'fixed' ? 'configured' : 'none',
      meters: meterRows,
    }
  })

  return { cycles, services: mapped, selectedCycle, invoiceNumber }
}
