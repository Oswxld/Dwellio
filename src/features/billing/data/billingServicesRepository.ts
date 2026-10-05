import { supabase } from '../../../lib/supabase'

export type ManagedBillingMethod = 'fixed' | 'usage'
export type ManagedBillingApplicability = 'mandatory' | 'optional' | 'off'

export type ManagedBillingUnit = {
  id: string
  name: string
}

export type ManagedBillingService = {
  id: string
  name: string
  billingMethod: ManagedBillingMethod
  applicability: ManagedBillingApplicability
  isActive: boolean
  currentRate: number | null
  meterCount: number
  unitCount: number
  meteredUnitIds: string[]
}

export type BillingServicesManagerData = {
  services: ManagedBillingService[]
  units: ManagedBillingUnit[]
}

export type OpeningReadingInput = {
  unitId: string
  value: number
}

export type CreateBillingServiceInput = {
  propertyId: string
  name: string
  billingMethod: ManagedBillingMethod
  applicability: Exclude<ManagedBillingApplicability, 'off'>
  isActive: boolean
  rate: number
  effectiveFrom: string
  openingReadings?: OpeningReadingInput[]
}

export type UpdateBillingServiceInput = {
  serviceId: string
  propertyId: string
  name: string
  billingMethod: ManagedBillingMethod
  applicability: ManagedBillingApplicability
  isActive: boolean
  rate: number
  effectiveFrom: string
  openingReadings?: OpeningReadingInput[]
}

type ErrorLike = {
  message?: unknown
  code?: unknown
  details?: unknown
  hint?: unknown
}

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function logServiceError(
  operation: string,
  error: unknown,
  context: Record<string, unknown> = {},
) {
  const payload =
    typeof error === 'object' && error !== null
      ? error as ErrorLike
      : {}

  console.error(`[BillingServices] ${operation} failed`, {
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

async function getCurrentUserId() {
  const { data, error } = await supabase.auth.getUser()

  if (error) {
    logServiceError('get current user', error)
    throw error
  }

  if (!data.user) {
    throw new Error('You are not signed in.')
  }

  return data.user.id
}

export async function fetchBillingServicesManagerData(
  propertyId: string,
  effectiveDate: string,
): Promise<BillingServicesManagerData> {
  const [servicesResult, unitsResult] = await Promise.all([
    supabase
      .from('billing_services')
      .select('id, name, billing_method, applicability, is_active')
      .eq('property_id', propertyId)
      .order('name'),

    supabase
      .from('units')
      .select('id, name')
      .eq('property_id', propertyId)
      .is('deleted_at', null)
      .order('name'),
  ])

  if (servicesResult.error) {
    logServiceError('load billing services', servicesResult.error, { propertyId })
    throw servicesResult.error
  }

  if (unitsResult.error) {
    logServiceError('load billing units', unitsResult.error, { propertyId })
    throw unitsResult.error
  }

  const services = servicesResult.data ?? []
  const units = (unitsResult.data ?? []) as ManagedBillingUnit[]
  const serviceIds = services.map(service => service.id)

  let rates: Array<{
    service_id: string
    rate: number | string
    effective_from: string
    effective_to: string | null
  }> = []

  let meters: Array<{
    id: string
    unit_id: string
    service_id: string
    status: string
  }> = []

  if (serviceIds.length > 0) {
    const [ratesResult, metersResult] = await Promise.all([
      supabase
        .from('billing_service_rates')
        .select('service_id, rate, effective_from, effective_to')
        .in('service_id', serviceIds),

      supabase
        .from('meters')
        .select('id, unit_id, service_id, status')
        .in('service_id', serviceIds),
    ])

    if (ratesResult.error) {
      logServiceError('load billing service rates', ratesResult.error, {
        propertyId,
        serviceIds,
      })
      throw ratesResult.error
    }

    if (metersResult.error) {
      logServiceError('load billing service meters', metersResult.error, {
        propertyId,
        serviceIds,
      })
      throw metersResult.error
    }

    rates = ratesResult.data ?? []
    meters = metersResult.data ?? []
  }

  return {
    units,
    services: services.map(service => {
      const applicableRates = rates
        .filter(
          rate =>
            rate.service_id === service.id &&
            rateApplies(
              rate.effective_from,
              rate.effective_to,
              effectiveDate,
            ),
        )
        .sort((a, b) => b.effective_from.localeCompare(a.effective_from))

      const activeMeters = meters.filter(
        meter =>
          meter.service_id === service.id &&
          meter.status === 'active',
      )

      return {
        id: service.id,
        name: service.name,
        billingMethod: service.billing_method as ManagedBillingMethod,
        applicability: service.applicability as ManagedBillingApplicability,
        isActive: service.is_active === true,
        currentRate:
          applicableRates.length > 0
            ? numberValue(applicableRates[0].rate)
            : null,
        meterCount: activeMeters.length,
        unitCount: units.length,
        meteredUnitIds: [
          ...new Set(activeMeters.map(meter => meter.unit_id)),
        ],
      }
    }),
  }
}

async function saveRate(
  serviceId: string,
  rate: number,
  effectiveFrom: string,
) {
  const { data: existing, error: lookupError } = await supabase
    .from('billing_service_rates')
    .select('service_id, effective_from')
    .eq('service_id', serviceId)
    .eq('effective_from', effectiveFrom)
    .maybeSingle()

  if (lookupError) {
    logServiceError('check billing service rate', lookupError, {
      serviceId,
      effectiveFrom,
    })
    throw lookupError
  }

  if (existing) {
    const { error } = await supabase
      .from('billing_service_rates')
      .update({ rate })
      .eq('service_id', serviceId)
      .eq('effective_from', effectiveFrom)

    if (error) {
      logServiceError('update billing service rate', error, {
        serviceId,
        effectiveFrom,
        rate,
      })
      throw error
    }

    return
  }

  const { error } = await supabase
    .from('billing_service_rates')
    .insert({
      service_id: serviceId,
      rate,
      effective_from: effectiveFrom,
      effective_to: null,
    })

  if (error) {
    logServiceError('insert billing service rate', error, {
      serviceId,
      effectiveFrom,
      rate,
    })
    throw error
  }
}

async function ensureUsageMetersAndOpeningReadings(
  serviceId: string,
  effectiveFrom: string,
  openingReadings: OpeningReadingInput[],
) {
  if (openingReadings.length === 0) return

  const userId = await getCurrentUserId()
  const unitIds = openingReadings.map(item => item.unitId)

  const { data: existingMeters, error: existingError } = await supabase
    .from('meters')
    .select('id, unit_id')
    .eq('service_id', serviceId)
    .eq('status', 'active')
    .in('unit_id', unitIds)

  if (existingError) {
    logServiceError('check existing usage meters', existingError, {
      serviceId,
      unitIds,
    })
    throw existingError
  }

  const existingUnitIds = new Set(
    (existingMeters ?? []).map(meter => meter.unit_id),
  )

  const missingRows = openingReadings.filter(
    item => !existingUnitIds.has(item.unitId),
  )

  if (missingRows.length === 0) return

  const { data: createdMeters, error: meterError } = await supabase
    .from('meters')
    .insert(
      missingRows.map(item => ({
        unit_id: item.unitId,
        service_id: serviceId,
        status: 'active',
        installed_at: effectiveFrom,
      })),
    )
    .select('id, unit_id')

  if (meterError) {
    logServiceError('create usage meters', meterError, {
      serviceId,
      effectiveFrom,
      unitIds: missingRows.map(item => item.unitId),
    })
    throw meterError
  }

  const readingMap = new Map(
    missingRows.map(item => [item.unitId, item.value]),
  )

  const recordedAt = new Date().toISOString()

  const { error: readingError } = await supabase
    .from('meter_readings')
    .insert(
      (createdMeters ?? []).map(meter => ({
        meter_id: meter.id,
        reading_date: effectiveFrom,
        value: readingMap.get(meter.unit_id) ?? 0,
        status: 'active',
        recorded_by: userId,
        recorded_at: recordedAt,
      })),
    )

  if (readingError) {
    logServiceError('create opening meter readings', readingError, {
      serviceId,
      effectiveFrom,
      meterIds: (createdMeters ?? []).map(meter => meter.id),
    })
    throw readingError
  }
}

export async function createBillingServiceConfiguration(
  input: CreateBillingServiceInput,
) {
  const servicePayload = {
    property_id: input.propertyId,
    name: input.name.trim(),
    billing_method: input.billingMethod,
    applicability: input.applicability,
    is_active: input.isActive,
  }

  const { data: service, error: serviceError } = await supabase
    .from('billing_services')
    .insert(servicePayload)
    .select('id')
    .single()

  if (serviceError) {
    logServiceError('create billing service', serviceError, {
      ...servicePayload,
      rate: input.rate,
      effectiveFrom: input.effectiveFrom,
    })
    throw serviceError
  }

  try {
    await saveRate(service.id, input.rate, input.effectiveFrom)

    if (input.billingMethod === 'usage') {
      await ensureUsageMetersAndOpeningReadings(
        service.id,
        input.effectiveFrom,
        input.openingReadings ?? [],
      )
    }
  } catch (error) {
    logServiceError('finish billing service setup', error, {
      serviceId: service.id,
      billingMethod: input.billingMethod,
    })
    throw error
  }

  console.info('[BillingServices] Billing service created', {
    serviceId: service.id,
    propertyId: input.propertyId,
    billingMethod: input.billingMethod,
  })

  return service.id
}

export async function updateBillingServiceConfiguration(
  input: UpdateBillingServiceInput,
) {
  const payload = {
    name: input.name.trim(),
    billing_method: input.billingMethod,
    applicability: input.applicability,
    is_active: input.isActive,
  }

  const { error } = await supabase
    .from('billing_services')
    .update(payload)
    .eq('id', input.serviceId)
    .eq('property_id', input.propertyId)

  if (error) {
    logServiceError('update billing service', error, {
      serviceId: input.serviceId,
      propertyId: input.propertyId,
      ...payload,
    })
    throw error
  }

  await saveRate(
    input.serviceId,
    input.rate,
    input.effectiveFrom,
  )

  if (input.billingMethod === 'usage') {
    await ensureUsageMetersAndOpeningReadings(
      input.serviceId,
      input.effectiveFrom,
      input.openingReadings ?? [],
    )
  }

  console.info('[BillingServices] Billing service updated', {
    serviceId: input.serviceId,
    propertyId: input.propertyId,
    billingMethod: input.billingMethod,
  })
}
