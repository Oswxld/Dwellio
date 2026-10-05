import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react'

import {
  createBillingServiceConfiguration,
  fetchBillingServicesManagerData,
  updateBillingServiceConfiguration,
  type BillingServicesManagerData,
  type ManagedBillingApplicability,
  type ManagedBillingMethod,
  type ManagedBillingService,
} from '../data/billingServicesRepository'

type BillingServicesPanelProps = {
  propertyId: string
  effectiveFrom: string
  effectiveDate: string
  onChanged: () => Promise<void>
}

type ServiceFormState = {
  name: string
  billingMethod: ManagedBillingMethod
  applicability: ManagedBillingApplicability
  isActive: boolean
  rate: string
}

type PanelMode =
  | { type: 'closed' }
  | { type: 'detail'; serviceId: string }
  | { type: 'create' }
  | { type: 'edit'; serviceId: string }

type FormStage = 'form' | 'review'

const emptyManagerData: BillingServicesManagerData = {
  services: [],
  units: [],
}

const createDefaults: ServiceFormState = {
  name: '',
  billingMethod: 'fixed',
  applicability: 'mandatory',
  isActive: true,
  rate: '',
}

function money(value: number | null) {
  if (value === null) return 'No rate set'

  return new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: 'KES',
    maximumFractionDigits: 2,
  }).format(value)
}

function serviceIcon(name: string, method: ManagedBillingMethod) {
  const normalized = name.toLowerCase()

  if (normalized.includes('water')) return 'water_drop'
  if (normalized.includes('electric')) return 'bolt'
  if (normalized.includes('garbage') || normalized.includes('waste')) {
    return 'delete_sweep'
  }
  if (normalized.includes('parking')) return 'local_parking'
  if (normalized.includes('internet') || normalized.includes('wifi')) return 'wifi'

  return method === 'usage' ? 'speed' : 'payments'
}

function applicabilityLabel(value: ManagedBillingApplicability) {
  if (value === 'mandatory') return 'Mandatory'
  if (value === 'optional') return 'Optional'
  return 'Off'
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message

  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message
  }

  return 'The billing service operation failed.'
}

export default function BillingServicesPanel({
  propertyId,
  effectiveFrom,
  effectiveDate,
  onChanged,
}: BillingServicesPanelProps) {
  const [data, setData] = useState<BillingServicesManagerData>(
    emptyManagerData,
  )
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [mode, setMode] = useState<PanelMode>({ type: 'closed' })
  const [form, setForm] = useState<ServiceFormState>(createDefaults)
  const [stage, setStage] = useState<FormStage>('form')
  const [unitSearch, setUnitSearch] = useState('')
  const [openingReadings, setOpeningReadings] = useState<Record<string, string>>({})

  const selectedService = useMemo(() => {
    if (mode.type !== 'detail' && mode.type !== 'edit') return null
    return data.services.find(service => service.id === mode.serviceId) ?? null
  }, [data.services, mode])

  const visibleUnits = useMemo(() => {
    const query = unitSearch.trim().toLowerCase()
    if (!query) return data.units

    return data.units.filter(unit => unit.name.toLowerCase().includes(query))
  }, [data.units, unitSearch])

  const changedOpeningReadings = useMemo(
    () =>
      Object.values(openingReadings).filter(value => {
        const numeric = Number(value)
        return Number.isFinite(numeric) && numeric !== 0
      }).length,
    [openingReadings],
  )

  useEffect(() => {
    void loadManagerData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId, effectiveDate])

  async function loadManagerData() {
    try {
      setLoading(true)
      setError('')

      const nextData = await fetchBillingServicesManagerData(
        propertyId,
        effectiveDate,
      )

      setData(nextData)
    } catch (loadError) {
      console.error('[BillingServicesPanel] load failed', loadError)
      setError(errorMessage(loadError))
    } finally {
      setLoading(false)
    }
  }

  function initializeOpeningReadings(service?: ManagedBillingService | null) {
    const metered = new Set(service?.meteredUnitIds ?? [])

    setOpeningReadings(
      Object.fromEntries(
        data.units.map(unit => [
          unit.id,
          metered.has(unit.id) ? '' : '0',
        ]),
      ),
    )
  }

  function openCreate() {
    setError('')
    setSuccess('')
    setForm(createDefaults)
    setStage('form')
    setUnitSearch('')
    initializeOpeningReadings(null)
    setMode({ type: 'create' })
  }

  function openDetail(service: ManagedBillingService) {
    setError('')
    setSuccess('')
    setMode({ type: 'detail', serviceId: service.id })
  }

  function openEdit(service: ManagedBillingService) {
    setError('')
    setSuccess('')
    setForm({
      name: service.name,
      billingMethod: service.billingMethod,
      applicability: service.applicability,
      isActive: service.isActive,
      rate: service.currentRate === null ? '' : String(service.currentRate),
    })
    setStage('form')
    setUnitSearch('')
    initializeOpeningReadings(service)
    setMode({ type: 'edit', serviceId: service.id })
  }

  function closePanel() {
    if (saving) return
    setMode({ type: 'closed' })
    setError('')
    setStage('form')
  }

  function updateOpeningReading(unitId: string, value: string) {
    setOpeningReadings(previous => ({
      ...previous,
      [unitId]: value,
    }))
  }

  function resetOpeningReadings() {
    setOpeningReadings(previous =>
      Object.fromEntries(
        Object.keys(previous).map(unitId => [unitId, '0']),
      ),
    )
  }

  function missingMeterUnitIds(service?: ManagedBillingService | null) {
    const existing = new Set(service?.meteredUnitIds ?? [])
    return data.units.filter(unit => !existing.has(unit.id)).map(unit => unit.id)
  }

  function validateForm() {
    const rate = Number(form.rate)

    if (!form.name.trim()) {
      setError('Enter a billing service name.')
      return false
    }

    if (!Number.isFinite(rate) || rate < 0) {
      setError('Enter a valid rate of zero or more.')
      return false
    }

    if (form.billingMethod === 'usage') {
      const service = mode.type === 'edit' ? selectedService : null
      const missingIds = new Set(missingMeterUnitIds(service))

      for (const [unitId, value] of Object.entries(openingReadings)) {
        if (!missingIds.has(unitId)) continue

        const numeric = Number(value)
        if (!Number.isFinite(numeric) || numeric < 0) {
          setError('Every new meter needs a valid opening reading of zero or more.')
          return false
        }
      }
    }

    setError('')
    return true
  }

  function openingReadingPayload(service?: ManagedBillingService | null) {
    if (form.billingMethod !== 'usage') return []

    const missingIds = new Set(missingMeterUnitIds(service))

    return data.units
      .filter(unit => missingIds.has(unit.id))
      .map(unit => ({
        unitId: unit.id,
        value: Number(openingReadings[unit.id] ?? 0),
      }))
  }

  async function submitCreate() {
    if (!validateForm()) return

    try {
      setSaving(true)
      setError('')
      setSuccess('')

      await createBillingServiceConfiguration({
        propertyId,
        name: form.name,
        billingMethod: form.billingMethod,
        applicability:
          form.applicability === 'off'
            ? 'mandatory'
            : form.applicability,
        isActive: form.isActive,
        rate: Number(form.rate),
        effectiveFrom,
        openingReadings: openingReadingPayload(null),
      })

      await Promise.all([
        loadManagerData(),
        onChanged(),
      ])

      setSuccess(`${form.name.trim()} billing service created.`)
      setMode({ type: 'closed' })
    } catch (saveError) {
      console.error('[BillingServicesPanel] create failed', saveError)
      setError(errorMessage(saveError))
    } finally {
      setSaving(false)
    }
  }

  async function submitEdit() {
    if (!selectedService || !validateForm()) return

    try {
      setSaving(true)
      setError('')
      setSuccess('')

      await updateBillingServiceConfiguration({
        serviceId: selectedService.id,
        propertyId,
        name: form.name,
        billingMethod: form.billingMethod,
        applicability: form.applicability,
        isActive: form.isActive,
        rate: Number(form.rate),
        effectiveFrom,
        openingReadings: openingReadingPayload(selectedService),
      })

      await Promise.all([
        loadManagerData(),
        onChanged(),
      ])

      setSuccess(`${form.name.trim()} billing service updated.`)
      setMode({ type: 'closed' })
    } catch (saveError) {
      console.error('[BillingServicesPanel] update failed', saveError)
      setError(errorMessage(saveError))
    } finally {
      setSaving(false)
    }
  }

  function handleReview(event: FormEvent) {
    event.preventDefault()
    if (validateForm()) setStage('review')
  }

  return (
    <>
      <section className="rounded-xl bg-white p-5 sm:p-6 shadow-[0_14px_40px_rgba(22,42,35,.06)]">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[.14em] text-[#1e6a59]">
              Property configuration
            </div>
            <h2 className="mt-1 font-['Newsreader'] text-xl text-[#111e19]">
              Billing services
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-[#424845]">
              Manage what this property charges, who receives each charge, and how the rate is calculated.
            </p>
          </div>

          <button
            type="button"
            onClick={openCreate}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#10211c] px-4 text-sm font-semibold text-white shadow-[0_4px_14px_rgba(16,33,28,.16)] transition hover:-translate-y-0.5"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            Add billing service
          </button>
        </div>

        {error && mode.type === 'closed' && (
          <div className="mt-4 rounded-lg bg-[#ffdad6] px-4 py-3 text-sm text-[#93000a]">
            {error}
          </div>
        )}

        {success && (
          <div className="mt-4 rounded-lg bg-[#a8f1db]/40 px-4 py-3 text-sm text-[#005142]">
            {success}
          </div>
        )}

        {loading ? (
          <div className="mt-5 grid gap-3 lg:grid-cols-2">
            {[0, 1, 2, 3].map(item => (
              <div
                key={item}
                className="h-28 animate-pulse rounded-xl bg-[#e7f7ee]"
              />
            ))}
          </div>
        ) : data.services.length === 0 ? (
          <div className="mt-5 rounded-xl bg-[#e7f7ee] p-6 text-center">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg bg-white text-[#1e6a59] shadow-sm">
              <span className="material-symbols-outlined">receipt_long</span>
            </div>
            <div className="mt-3 text-sm font-semibold">No billing services yet</div>
            <p className="mt-1 text-xs text-[#424845]">
              Add rent-related charges, utilities, garbage, internet, parking or any other property service.
            </p>
          </div>
        ) : (
          <div className="mt-5 grid gap-3 lg:grid-cols-2">
            {data.services.map(service => {
              const usage = service.billingMethod === 'usage'
              const missingMeters = Math.max(0, service.unitCount - service.meterCount)

              return (
                <button
                  key={service.id}
                  type="button"
                  onClick={() => openDetail(service)}
                  className="group flex w-full items-start justify-between gap-4 rounded-xl bg-[#e7f7ee] p-4 text-left transition hover:-translate-y-0.5 hover:bg-[#e2f2e8] hover:shadow-[0_10px_24px_rgba(22,42,35,.06)]"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white text-[#1e6a59] shadow-sm">
                      <span className="material-symbols-outlined text-[20px]">
                        {serviceIcon(service.name, service.billingMethod)}
                      </span>
                    </div>

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <strong className="truncate text-sm text-[#111e19]">
                          {service.name}
                        </strong>
                        <span className="rounded bg-[#dcece2] px-2 py-0.5 text-[10px] font-medium text-[#424845]">
                          {usage ? 'Usage-based' : 'Fixed'} · {applicabilityLabel(service.applicability)}
                        </span>
                      </div>

                      <div className="mt-1 text-xs text-[#424845]">
                        {usage
                          ? `${service.meterCount} / ${service.unitCount} meters`
                          : `${money(service.currentRate)} / billing period`}
                      </div>

                      {usage && (
                        <div className="mt-1 text-xs font-semibold text-[#111e19]">
                          {money(service.currentRate)} per unit consumed
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <span
                      className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${
                        service.isActive
                          ? 'bg-[#a8f1db]/40 text-[#26705f]'
                          : 'bg-[#dcece2] text-[#737875]'
                      }`}
                    >
                      {service.isActive ? 'Active' : 'Inactive'}
                    </span>

                    {usage && missingMeters > 0 && (
                      <span className="text-[10px] font-semibold text-[#93000a]">
                        {missingMeters} meter{missingMeters === 1 ? '' : 's'} missing
                      </span>
                    )}

                    <span className="material-symbols-outlined text-[18px] text-[#737875] transition group-hover:translate-x-0.5">
                      arrow_forward
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </section>

      {mode.type !== 'closed' && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-[#10211c]/35 p-0 backdrop-blur-[2px] sm:items-center sm:p-6">
          <div className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-[#edfdf3] shadow-[0_28px_70px_rgba(16,33,28,.22)] sm:max-w-4xl sm:rounded-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#dcece2] bg-[#edfdf3]/95 px-5 py-4 backdrop-blur-xl sm:px-6">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[.14em] text-[#1e6a59]">
                  Billing services
                </div>
                <h3 className="mt-0.5 font-['Newsreader'] text-2xl">
                  {mode.type === 'create'
                    ? stage === 'review'
                      ? 'Review new service'
                      : 'Add billing service'
                    : mode.type === 'edit'
                      ? 'Edit billing service'
                      : selectedService?.name ?? 'Billing service'}
                </h3>
              </div>

              <button
                type="button"
                onClick={closePanel}
                className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-[#424845] shadow-sm"
                aria-label="Close billing service panel"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <div className="p-5 sm:p-6">
              {error && (
                <div className="mb-5 rounded-lg bg-[#ffdad6] px-4 py-3 text-sm text-[#93000a]">
                  {error}
                </div>
              )}

              {mode.type === 'detail' && selectedService && (
                <ServiceDetails
                  service={selectedService}
                  onEdit={() => openEdit(selectedService)}
                />
              )}

              {(mode.type === 'create' || mode.type === 'edit') && stage === 'form' && (
                <ServiceForm
                  form={form}
                  setForm={setForm}
                  units={visibleUnits}
                  allUnitCount={data.units.length}
                  unitSearch={unitSearch}
                  setUnitSearch={setUnitSearch}
                  openingReadings={openingReadings}
                  updateOpeningReading={updateOpeningReading}
                  resetOpeningReadings={resetOpeningReadings}
                  existingMeteredUnitIds={
                    mode.type === 'edit' && selectedService
                      ? new Set(selectedService.meteredUnitIds)
                      : new Set<string>()
                  }
                  changedOpeningReadings={changedOpeningReadings}
                  onSubmit={handleReview}
                  saving={saving}
                />
              )}

              {(mode.type === 'create' || mode.type === 'edit') && stage === 'review' && (
                <ServiceReview
                  form={form}
                  unitCount={data.units.length}
                  meterCount={
                    form.billingMethod === 'usage'
                      ? mode.type === 'edit' && selectedService
                        ? Math.max(
                            0,
                            data.units.length - selectedService.meteredUnitIds.length,
                          )
                        : data.units.length
                      : 0
                  }
                  changedOpeningReadings={changedOpeningReadings}
                  effectiveFrom={effectiveFrom}
                  saving={saving}
                  onBack={() => setStage('form')}
                  onConfirm={() =>
                    void (
                      mode.type === 'create'
                        ? submitCreate()
                        : submitEdit()
                    )
                  }
                />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function ServiceDetails({
  service,
  onEdit,
}: {
  service: ManagedBillingService
  onEdit: () => void
}) {
  const usage = service.billingMethod === 'usage'

  return (
    <div className="space-y-5">
      <div className="rounded-xl bg-white p-5 shadow-[0_14px_40px_rgba(22,42,35,.05)]">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#e7f7ee] text-[#1e6a59]">
              <span className="material-symbols-outlined">
                {serviceIcon(service.name, service.billingMethod)}
              </span>
            </div>
            <div>
              <h4 className="text-lg font-semibold">{service.name}</h4>
              <div className="mt-2 flex flex-wrap gap-2">
                <Pill>{usage ? 'Usage-based' : 'Fixed'}</Pill>
                <Pill>{applicabilityLabel(service.applicability)}</Pill>
                <Pill tone={service.isActive ? 'green' : 'muted'}>
                  {service.isActive ? 'Active' : 'Inactive'}
                </Pill>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onEdit}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#10211c] px-4 text-sm font-semibold text-white"
          >
            <span className="material-symbols-outlined text-[18px]">edit</span>
            Edit service
          </button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <DetailCard label={usage ? 'Rate per unit consumed' : 'Rate per billing period'} value={money(service.currentRate)} />
        <DetailCard label="Applicability" value={applicabilityLabel(service.applicability)} />
        <DetailCard label="Status" value={service.isActive ? 'Active' : 'Inactive'} />
        {usage && (
          <>
            <DetailCard label="Meters configured" value={`${service.meterCount} / ${service.unitCount}`} />
            <DetailCard label="Units missing meters" value={String(Math.max(0, service.unitCount - service.meterCount))} />
          </>
        )}
      </div>
    </div>
  )
}

function ServiceForm({
  form,
  setForm,
  units,
  allUnitCount,
  unitSearch,
  setUnitSearch,
  openingReadings,
  updateOpeningReading,
  resetOpeningReadings,
  existingMeteredUnitIds,
  changedOpeningReadings,
  onSubmit,
  saving,
}: {
  form: ServiceFormState
  setForm: React.Dispatch<React.SetStateAction<ServiceFormState>>
  units: BillingServicesManagerData['units']
  allUnitCount: number
  unitSearch: string
  setUnitSearch: (value: string) => void
  openingReadings: Record<string, string>
  updateOpeningReading: (unitId: string, value: string) => void
  resetOpeningReadings: () => void
  existingMeteredUnitIds: Set<string>
  changedOpeningReadings: number
  onSubmit: (event: FormEvent) => void
  saving: boolean
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <section className="rounded-xl bg-white p-5 shadow-[0_14px_40px_rgba(22,42,35,.05)]">
        <h4 className="font-['Newsreader'] text-xl">Service information</h4>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="sm:col-span-2">
            <span className="text-xs font-semibold text-[#424845]">Service name</span>
            <input
              id="billing-service-name"
              name="billing-service-name"
              value={form.name}
              onChange={event =>
                setForm(previous => ({ ...previous, name: event.target.value }))
              }
              placeholder="e.g. Water"
              className="mt-1 h-11 w-full rounded-lg bg-[#e7f7ee] px-3 text-sm outline-none ring-[#1e6a59] focus:bg-white focus:ring-2"
            />
          </label>

          <div>
            <div className="text-xs font-semibold text-[#424845]">Applicability</div>
            <div className="mt-1 grid grid-cols-2 gap-2">
              {(['mandatory', 'optional'] as const).map(value => (
                <ChoiceButton
                  key={value}
                  active={form.applicability === value}
                  onClick={() =>
                    setForm(previous => ({ ...previous, applicability: value }))
                  }
                >
                  {value === 'mandatory' ? 'Mandatory' : 'Optional'}
                </ChoiceButton>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs font-semibold text-[#424845]">Service status</div>
            <button
              type="button"
              onClick={() =>
                setForm(previous => ({ ...previous, isActive: !previous.isActive }))
              }
              className={`mt-1 flex h-11 w-full items-center justify-between rounded-lg px-3 text-sm font-semibold ${
                form.isActive
                  ? 'bg-[#a8f1db]/40 text-[#26705f]'
                  : 'bg-[#dcece2] text-[#737875]'
              }`}
            >
              <span>{form.isActive ? 'Active' : 'Inactive'}</span>
              <span className="material-symbols-outlined text-[18px]">
                {form.isActive ? 'toggle_on' : 'toggle_off'}
              </span>
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-xl bg-white p-5 shadow-[0_14px_40px_rgba(22,42,35,.05)]">
        <h4 className="font-['Newsreader'] text-xl">Billing method</h4>
        <p className="mt-1 text-xs text-[#424845]">
          Choose whether this service uses a constant charge or consumption readings.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <MethodCard
            active={form.billingMethod === 'fixed'}
            icon="payments"
            title="Fixed"
            description="Charge the same amount every billing period."
            onClick={() =>
              setForm(previous => ({ ...previous, billingMethod: 'fixed' }))
            }
          />
          <MethodCard
            active={form.billingMethod === 'usage'}
            icon="speed"
            title="Usage-based"
            description="Calculate the charge from meter readings."
            onClick={() =>
              setForm(previous => ({ ...previous, billingMethod: 'usage' }))
            }
          />
        </div>

        <label className="mt-4 block max-w-sm">
          <span className="text-xs font-semibold text-[#424845]">
            {form.billingMethod === 'usage'
              ? 'Rate per unit consumed'
              : 'Rate per billing period'}
          </span>
          <div className="mt-1 flex h-11 items-center rounded-lg bg-[#e7f7ee] px-3 focus-within:bg-white focus-within:ring-2 focus-within:ring-[#1e6a59]">
            <span className="mr-2 text-xs font-semibold text-[#737875]">KES</span>
            <input
              id="billing-service-rate"
              name="billing-service-rate"
              type="number"
              min="0"
              step="0.01"
              value={form.rate}
              onChange={event =>
                setForm(previous => ({ ...previous, rate: event.target.value }))
              }
              placeholder="0"
              className="h-full min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none"
            />
          </div>
        </label>
      </section>

      {form.billingMethod === 'usage' && (
        <section className="rounded-xl bg-white p-5 shadow-[0_14px_40px_rgba(22,42,35,.05)]">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h4 className="font-['Newsreader'] text-xl">Initial meter setup</h4>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-[#424845]">
                Dwellio will create a meter for each unit that does not already have one for this service. Every new meter starts at 0 unless you enter the real opening reading.
              </p>
            </div>
            <button
              type="button"
              onClick={resetOpeningReadings}
              className="rounded-lg bg-[#e7f7ee] px-3 py-2 text-xs font-semibold text-[#26705f]"
            >
              Set new meters to 0
            </button>
          </div>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs text-[#424845]">
              <strong className="text-[#111e19]">{allUnitCount} units</strong>
              {' · '}
              {changedOpeningReadings} opening reading{changedOpeningReadings === 1 ? '' : 's'} changed from 0
            </div>

            <input
              id="billing-service-unit-search"
              name="billing-service-unit-search"
              value={unitSearch}
              onChange={event => setUnitSearch(event.target.value)}
              placeholder="Search units..."
              className="h-9 rounded-lg bg-[#e7f7ee] px-3 text-xs outline-none focus:bg-white focus:ring-2 focus:ring-[#1e6a59]"
            />
          </div>

          <div className="mt-4 overflow-hidden rounded-xl border border-[#dcece2]">
            <div className="grid grid-cols-[1fr_1fr] bg-[#e7f7ee] px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-[#737875] sm:grid-cols-[1.2fr_1fr_1fr]">
              <span>Unit</span>
              <span className="hidden sm:block">Meter</span>
              <span>Opening reading</span>
            </div>

            <div className="max-h-72 overflow-y-auto bg-white">
              {units.map(unit => {
                const alreadyMetered = existingMeteredUnitIds.has(unit.id)

                return (
                  <div
                    key={unit.id}
                    className="grid grid-cols-[1fr_1fr] items-center gap-3 border-t border-[#edf3ef] px-4 py-3 text-sm first:border-t-0 sm:grid-cols-[1.2fr_1fr_1fr]"
                  >
                    <strong>{unit.name}</strong>
                    <span className="hidden text-xs text-[#424845] sm:block">
                      {alreadyMetered ? 'Existing meter' : 'New meter'}
                    </span>
                    {alreadyMetered ? (
                      <span className="text-xs font-semibold text-[#26705f]">Configured</span>
                    ) : (
                      <input
                        id={`opening-reading-${unit.id}`}
                        name={`opening-reading-${unit.id}`}
                        type="number"
                        min="0"
                        step="0.01"
                        value={openingReadings[unit.id] ?? '0'}
                        onChange={event =>
                          updateOpeningReading(unit.id, event.target.value)
                        }
                        className="h-9 w-full rounded-lg bg-[#e7f7ee] px-3 text-sm font-semibold outline-none focus:bg-white focus:ring-2 focus:ring-[#1e6a59]"
                      />
                    )}
                  </div>
                )
              })}

              {units.length === 0 && (
                <div className="px-4 py-6 text-center text-xs text-[#737875]">
                  No units match your search.
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={saving}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#10211c] px-5 text-sm font-semibold text-white disabled:opacity-50"
        >
          Review service
          <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
        </button>
      </div>
    </form>
  )
}

function ServiceReview({
  form,
  unitCount,
  meterCount,
  changedOpeningReadings,
  effectiveFrom,
  saving,
  onBack,
  onConfirm,
}: {
  form: ServiceFormState
  unitCount: number
  meterCount: number
  changedOpeningReadings: number
  effectiveFrom: string
  saving: boolean
  onBack: () => void
  onConfirm: () => void
}) {
  return (
    <div className="space-y-5">
      <section className="rounded-xl bg-white p-5 shadow-[0_14px_40px_rgba(22,42,35,.05)]">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#e7f7ee] text-[#1e6a59]">
            <span className="material-symbols-outlined">
              {serviceIcon(form.name, form.billingMethod)}
            </span>
          </div>
          <div>
            <h4 className="text-lg font-semibold">{form.name.trim()}</h4>
            <div className="mt-2 flex flex-wrap gap-2">
              <Pill>{form.billingMethod === 'usage' ? 'Usage-based' : 'Fixed'}</Pill>
              <Pill>{applicabilityLabel(form.applicability)}</Pill>
              <Pill tone={form.isActive ? 'green' : 'muted'}>
                {form.isActive ? 'Active' : 'Inactive'}
              </Pill>
            </div>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <DetailCard
            label={form.billingMethod === 'usage' ? 'Rate per unit' : 'Rate per period'}
            value={money(Number(form.rate))}
          />
          <DetailCard label="Effective from" value={effectiveFrom} />
          {form.billingMethod === 'usage' && (
            <>
              <DetailCard label="Property units" value={String(unitCount)} />
              <DetailCard label="Meters to create" value={String(meterCount)} />
              <DetailCard label="Opening readings changed" value={String(changedOpeningReadings)} />
            </>
          )}
        </div>
      </section>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onBack}
          disabled={saving}
          className="h-11 rounded-lg bg-[#e7f7ee] px-5 text-sm font-semibold text-[#111e19] disabled:opacity-50"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={saving}
          className="h-11 rounded-lg bg-[#1e6a59] px-5 text-sm font-semibold text-white shadow-[0_4px_14px_rgba(29,105,88,.24)] disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save billing service'}
        </button>
      </div>
    </div>
  )
}

function ChoiceButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-11 rounded-lg px-3 text-sm font-semibold transition ${
        active
          ? 'bg-[#10211c] text-white shadow-sm'
          : 'bg-[#e7f7ee] text-[#424845]'
      }`}
    >
      {children}
    </button>
  )
}

function MethodCard({
  active,
  icon,
  title,
  description,
  onClick,
}: {
  active: boolean
  icon: string
  title: string
  description: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl p-4 text-left transition ${
        active
          ? 'bg-[#10211c] text-white shadow-[0_8px_20px_rgba(16,33,28,.14)]'
          : 'bg-[#e7f7ee] text-[#111e19]'
      }`}
    >
      <span className="material-symbols-outlined text-[22px]">{icon}</span>
      <div className="mt-2 text-sm font-semibold">{title}</div>
      <div className={`mt-1 text-xs ${active ? 'text-[#b7cbc3]' : 'text-[#424845]'}`}>
        {description}
      </div>
    </button>
  )
}

function DetailCard({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="rounded-xl bg-[#e7f7ee] p-4">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[#737875]">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold text-[#111e19]">{value}</div>
    </div>
  )
}

function Pill({
  children,
  tone = 'default',
}: {
  children: React.ReactNode
  tone?: 'default' | 'green' | 'muted'
}) {
  const toneClass =
    tone === 'green'
      ? 'bg-[#a8f1db]/40 text-[#26705f]'
      : tone === 'muted'
        ? 'bg-[#dcece2] text-[#737875]'
        : 'bg-[#e2f2e8] text-[#424845]'

  return (
    <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${toneClass}`}>
      {children}
    </span>
  )
}
