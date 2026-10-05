import { supabase } from '../../../lib/supabase'

import type { BillingCycle } from './types'

export type BillingReadingUnit = {
  meterId: string
  serialNumber: string
  unitId: string
  unitName: string
  tenantName: string
  previousReadingId: string | null
  previousValue: number | null
  previousDate: string | null
  previousSource: 'opening' | 'periodic' | null
  currentReadingId: string | null
  currentValue: number | null
  currentDate: string | null
}

export type UsageBillingServiceReadings = {
  serviceId: string
  serviceName: string
  applicability: 'mandatory' | 'optional' | 'off'
  rate: number | null
  units: BillingReadingUnit[]
  savedCount: number
  totalCount: number
  missingMeterCount: number
}

export type BillingReadingsWorkspace = {
  services: UsageBillingServiceReadings[]
  savedCount: number
  totalCount: number
  missingMeterCount: number
  complete: boolean
}

export type SaveBillingReadingInput = {
  meterId: string
  value: number
  previousValue: number | null
}

type RawReading = {
  id: string
  meter_id: string
  billing_cycle_id: string | null
  reading_type: 'opening' | 'periodic'
  reading_date: string
  value: number | string
  status: string
  recorded_at: string | null
}

function numeric(value: unknown) {
  const result = Number(value)
  return Number.isFinite(result) ? result : null
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

function newestReading(a: RawReading, b: RawReading) {
  const byDate = b.reading_date.localeCompare(a.reading_date)
  if (byDate !== 0) return byDate

  return (b.recorded_at ?? '').localeCompare(a.recorded_at ?? '')
}

export async function fetchBillingReadingsWorkspace(
  propertyId: string,
  cycle: BillingCycle,
): Promise<BillingReadingsWorkspace> {
  const [unitsResult, servicesResult, cyclesResult] = await Promise.all([
    supabase
      .from('units')
      .select('id, name')
      .eq('property_id', propertyId)
      .is('deleted_at', null)
      .order('name'),

    supabase
      .from('billing_services')
      .select('id, name, applicability')
      .eq('property_id', propertyId)
      .eq('billing_method', 'usage')
      .eq('is_active', true)
      .neq('applicability', 'off')
      .order('name'),

    supabase
      .from('billing_cycles')
      .select('id, period_start')
      .eq('property_id', propertyId),
  ])

  if (unitsResult.error) throw unitsResult.error
  if (servicesResult.error) throw servicesResult.error
  if (cyclesResult.error) throw cyclesResult.error

  const units = unitsResult.data ?? []
  const services = servicesResult.data ?? []
  const unitIds = units.map(unit => unit.id)
  const serviceIds = services.map(service => service.id)

  if (unitIds.length === 0 || serviceIds.length === 0) {
    return {
      services: [],
      savedCount: 0,
      totalCount: 0,
      missingMeterCount: 0,
      complete: true,
    }
  }

  const leasesResult = await supabase
    .from('leases')
    .select('id, unit_id, tenant_id, status')
    .in('unit_id', unitIds)
    .in('status', ['active', 'notice_given'])

  if (leasesResult.error) throw leasesResult.error

  const leases = leasesResult.data ?? []
  const leaseIds = leases.map(lease => lease.id)
  const tenantIds = [...new Set(leases.map(lease => lease.tenant_id))]

  const [metersResult, ratesResult, tenantsResult, subscriptionsResult] =
    await Promise.all([
      supabase
        .from('meters')
        .select('id, serial_number, unit_id, service_id, status')
        .in('unit_id', unitIds)
        .in('service_id', serviceIds)
        .eq('status', 'active'),

      supabase
        .from('billing_service_rates')
        .select('service_id, rate, effective_from, effective_to')
        .in('service_id', serviceIds),

      tenantIds.length > 0
        ? supabase
            .from('tenants')
            .select('id, full_name')
            .in('id', tenantIds)
        : Promise.resolve({ data: [], error: null }),

      leaseIds.length > 0
        ? supabase
            .from('tenant_service_subscriptions')
            .select('lease_id, service_id, status, started_at, ended_at')
            .in('lease_id', leaseIds)
            .in('service_id', serviceIds)
            .eq('status', 'active')
        : Promise.resolve({ data: [], error: null }),
    ])

  if (metersResult.error) throw metersResult.error
  if (ratesResult.error) throw ratesResult.error
  if (tenantsResult.error) throw tenantsResult.error
  if (subscriptionsResult.error) throw subscriptionsResult.error

  const meters = metersResult.data ?? []
  const meterIds = meters.map(meter => meter.id)

  const readingsResult = meterIds.length > 0
    ? await supabase
        .from('meter_readings')
        .select(`
          id,
          meter_id,
          billing_cycle_id,
          reading_type,
          reading_date,
          value,
          status,
          recorded_at
        `)
        .in('meter_id', meterIds)
        .eq('status', 'active')
    : { data: [], error: null }

  if (readingsResult.error) throw readingsResult.error

  const readings = (readingsResult.data ?? []) as RawReading[]
  const cycleStartById = new Map(
    (cyclesResult.data ?? []).map(item => [item.id, item.period_start]),
  )
  const unitNameById = new Map(units.map(unit => [unit.id, unit.name]))
  const tenantNameById = new Map(
    (tenantsResult.data ?? []).map(tenant => [tenant.id, tenant.full_name]),
  )
  const leaseByUnitId = new Map(leases.map(lease => [lease.unit_id, lease]))
  const subscriptions = subscriptionsResult.data ?? []

  const resultServices: UsageBillingServiceReadings[] = services.map(service => {
    const applicableRate = (ratesResult.data ?? [])
      .filter(rate =>
        rate.service_id === service.id &&
        rateApplies(rate.effective_from, rate.effective_to, cycle.period_end),
      )
      .sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0]

    const expectedLeases = service.applicability === 'optional'
      ? leases.filter(lease =>
          subscriptions.some(subscription =>
            subscription.lease_id === lease.id &&
            subscription.service_id === service.id &&
            subscription.started_at <= cycle.period_end &&
            (
              subscription.ended_at === null ||
              subscription.ended_at >= cycle.period_start
            ),
          ),
        )
      : leases

    let missingMeterCount = 0

    const serviceUnits = expectedLeases.flatMap(lease => {
      const meter = meters.find(item =>
        item.service_id === service.id && item.unit_id === lease.unit_id,
      )

      if (!meter) {
        missingMeterCount += 1
        return []
      }

      const meterReadings = readings.filter(item => item.meter_id === meter.id)

      const current = meterReadings.find(item =>
        item.reading_type === 'periodic' &&
        item.billing_cycle_id === cycle.id,
      ) ?? null

      const previousPeriodic = meterReadings
        .filter(item => {
          if (item.reading_type !== 'periodic' || !item.billing_cycle_id) {
            return false
          }

          const readingCycleStart = cycleStartById.get(item.billing_cycle_id)
          return Boolean(readingCycleStart && readingCycleStart < cycle.period_start)
        })
        .sort((a, b) => {
          const aStart = cycleStartById.get(a.billing_cycle_id ?? '') ?? ''
          const bStart = cycleStartById.get(b.billing_cycle_id ?? '') ?? ''
          const byCycle = bStart.localeCompare(aStart)
          return byCycle !== 0 ? byCycle : newestReading(a, b)
        })[0] ?? null

      const opening = meterReadings
        .filter(item => item.reading_type === 'opening')
        .sort(newestReading)[0] ?? null

      const previous = previousPeriodic ?? opening

      return [{
        meterId: meter.id,
        serialNumber: meter.serial_number,
        unitId: lease.unit_id,
        unitName: unitNameById.get(lease.unit_id) ?? 'Unit',
        tenantName: tenantNameById.get(lease.tenant_id) ?? 'Tenant',
        previousReadingId: previous?.id ?? null,
        previousValue: previous ? numeric(previous.value) : null,
        previousDate: previous?.reading_date ?? null,
        previousSource: previous?.reading_type ?? null,
        currentReadingId: current?.id ?? null,
        currentValue: current ? numeric(current.value) : null,
        currentDate: current?.reading_date ?? null,
      }]
    })

    const savedCount = serviceUnits.filter(unit => unit.currentReadingId !== null).length

    return {
      serviceId: service.id,
      serviceName: service.name,
      applicability: service.applicability,
      rate: applicableRate ? numeric(applicableRate.rate) : null,
      units: serviceUnits,
      savedCount,
      totalCount: serviceUnits.length,
      missingMeterCount,
    }
  })

  const savedCount = resultServices.reduce((sum, service) => sum + service.savedCount, 0)
  const totalCount = resultServices.reduce((sum, service) => sum + service.totalCount, 0)
  const missingMeterCount = resultServices.reduce(
    (sum, service) => sum + service.missingMeterCount,
    0,
  )

  return {
    services: resultServices,
    savedCount,
    totalCount,
    missingMeterCount,
    complete: missingMeterCount === 0 && savedCount === totalCount,
  }
}

export async function saveBillingCycleReadings(
  cycle: BillingCycle,
  readings: SaveBillingReadingInput[],
) {
  if (readings.length === 0) return

  const invalid = readings.find(reading =>
    !Number.isFinite(reading.value) ||
    reading.value < 0 ||
    (
      reading.previousValue !== null &&
      reading.value < reading.previousValue
    ),
  )

  if (invalid) {
    throw new Error(
      'Current readings must be zero or greater and cannot be below the previous reading.',
    )
  }

  const { data: userResult, error: userError } = await supabase.auth.getUser()
  if (userError) throw userError
  if (!userResult.user) throw new Error('You are not signed in.')

  const recordedAt = new Date().toISOString()

  const payload = readings.map(reading => ({
    meter_id: reading.meterId,
    billing_cycle_id: cycle.id,
    reading_type: 'periodic',
    reading_date: cycle.period_end,
    value: reading.value,
    status: 'active',
    recorded_by: userResult.user.id,
    recorded_at: recordedAt,
  }))

  const { error } = await supabase
    .from('meter_readings')
    .upsert(payload, {
      onConflict: 'meter_id,billing_cycle_id',
    })

  if (error) throw error
}
