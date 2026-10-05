import {
  useEffect,
  useMemo,
  useState,
} from 'react'

import type { BillingCycle } from '../data/types'

import {
  fetchBillingReadingsWorkspace,
  saveBillingCycleReadings,
  type BillingReadingsWorkspace,
  type UsageBillingServiceReadings,
} from '../data/billingReadingsRepository'

type BillingReadingsPanelProps = {
  propertyId: string
  cycle: BillingCycle
  onCompletionChange: (
    complete: boolean,
    workspace: BillingReadingsWorkspace,
  ) => void
}

const emptyWorkspace: BillingReadingsWorkspace = {
  services: [],
  savedCount: 0,
  totalCount: 0,
  missingMeterCount: 0,
  complete: false,
}

function money(value: number | null) {
  if (value === null) return 'Rate not configured'

  return new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: 'KES',
    maximumFractionDigits: 2,
  }).format(value)
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

  return 'Could not save meter readings.'
}

function serviceIcon(name: string) {
  const normalized = name.toLowerCase()

  if (normalized.includes('electric')) return 'bolt'
  if (normalized.includes('water')) return 'water_drop'
  if (normalized.includes('wifi') || normalized.includes('internet')) return 'wifi'
  if (normalized.includes('gas')) return 'local_fire_department'

  return 'speed'
}

function serviceStatus(service: UsageBillingServiceReadings) {
  if (service.missingMeterCount > 0) return 'Needs attention'
  if (service.savedCount === 0) return 'Not started'
  if (service.savedCount === service.totalCount) return 'Complete'
  return 'In progress'
}

export default function BillingReadingsPanel({
  propertyId,
  cycle,
  onCompletionChange,
}: BillingReadingsPanelProps) {
  const [workspace, setWorkspace] = useState(emptyWorkspace)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [dirtyMeterIds, setDirtyMeterIds] = useState<Set<string>>(new Set())

  const selectedService = useMemo(
    () =>
      workspace.services.find(service => service.serviceId === selectedServiceId) ?? null,
    [workspace.services, selectedServiceId],
  )

  useEffect(() => {
    void loadWorkspace()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId, cycle.id])

  useEffect(() => {
    onCompletionChange(workspace.complete, workspace)
  }, [workspace, onCompletionChange])

  async function loadWorkspace() {
    try {
      setLoading(true)
      setError('')

      const next = await fetchBillingReadingsWorkspace(propertyId, cycle)
      setWorkspace(next)
      hydrateValues(next)

      if (
        selectedServiceId &&
        !next.services.some(service => service.serviceId === selectedServiceId)
      ) {
        setSelectedServiceId(null)
      }
    } catch (loadError) {
      console.error('[BillingReadingsPanel] load failed', loadError)
      setError(errorMessage(loadError))
    } finally {
      setLoading(false)
    }
  }

  function hydrateValues(next: BillingReadingsWorkspace) {
    const nextValues: Record<string, string> = {}

    next.services.forEach(service => {
      service.units.forEach(unit => {
        nextValues[unit.meterId] =
          unit.currentValue === null
            ? ''
            : String(unit.currentValue)
      })
    })

    setValues(nextValues)
    setDirtyMeterIds(new Set())
  }

  function updateValue(meterId: string, value: string) {
    setValues(previous => ({
      ...previous,
      [meterId]: value,
    }))

    setDirtyMeterIds(previous => {
      const next = new Set(previous)
      next.add(meterId)
      return next
    })

    setSuccess('')
  }

  async function saveSelectedService() {
    if (!selectedService) return

    const changedUnits = selectedService.units.filter(unit =>
      dirtyMeterIds.has(unit.meterId),
    )

    if (changedUnits.length === 0) {
      setSuccess('There are no unsaved reading changes.')
      return
    }

    const payload = []

    for (const unit of changedUnits) {
      const raw = values[unit.meterId]?.trim() ?? ''

      if (!raw) {
        setError(`Enter a current reading for ${unit.unitName} before saving that row.`)
        return
      }

      const value = Number(raw)

      if (!Number.isFinite(value) || value < 0) {
        setError(`${unit.unitName} needs a valid current reading.`)
        return
      }

      if (
        unit.previousValue !== null &&
        value < unit.previousValue
      ) {
        setError(
          `${unit.unitName}'s current reading cannot be below its previous reading of ${unit.previousValue}.`,
        )
        return
      }

      payload.push({
        meterId: unit.meterId,
        value,
        previousValue: unit.previousValue,
      })
    }

    try {
      setSaving(true)
      setError('')
      setSuccess('')

      await saveBillingCycleReadings(cycle, payload)
      const next = await fetchBillingReadingsWorkspace(propertyId, cycle)

      setWorkspace(next)
      hydrateValues(next)
      setSuccess(`${selectedService.serviceName} readings saved successfully.`)
    } catch (saveError) {
      console.error('[BillingReadingsPanel] save failed', saveError)
      setError(errorMessage(saveError))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <section className="rounded-2xl border border-[#c2c8c4]/60 bg-white p-6 shadow-[0_14px_40px_rgba(22,42,35,0.06)]">
        <div className="h-5 w-48 animate-pulse rounded bg-[#e7f7ee]" />
        <div className="mt-4 h-24 animate-pulse rounded-xl bg-[#edfdf3]" />
      </section>
    )
  }

  if (selectedService) {
    const unsavedCount = selectedService.units.filter(unit =>
      dirtyMeterIds.has(unit.meterId),
    ).length

    return (
      <section className="space-y-5">
        <div className="flex flex-col gap-3 rounded-2xl border border-[#c2c8c4]/60 bg-white p-5 shadow-[0_14px_40px_rgba(22,42,35,0.06)] md:flex-row md:items-center md:justify-between">
          <div>
            <button
              type="button"
              className="mb-2 inline-flex items-center gap-1 text-sm font-semibold text-[#1e6a59]"
              onClick={() => {
                setSelectedServiceId(null)
                setError('')
                setSuccess('')
              }}
            >
              <span className="material-symbols-outlined text-[18px]">arrow_back</span>
              Back to meter readings
            </button>

            <h3 className="text-xl font-semibold text-[#111e19]">
              {selectedService.serviceName} readings
            </h3>
            <p className="mt-1 text-sm text-[#424845]">
              Previous values come from the last billed cycle, or from the opening baseline when this is the first cycle.
            </p>
          </div>

          <div className="rounded-xl bg-[#e7f7ee] px-4 py-3 text-sm text-[#424845]">
            <strong className="text-[#111e19]">
              {selectedService.savedCount} / {selectedService.totalCount} saved
            </strong>
            <span className="mx-2">•</span>
            {unsavedCount} unsaved change{unsavedCount === 1 ? '' : 's'}
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-[#ba1a1a]/20 bg-[#ffdad6] px-4 py-3 text-sm text-[#93000a]">
            {error}
          </div>
        )}

        {success && (
          <div className="rounded-xl border border-[#1e6a59]/20 bg-[#a8f1db]/45 px-4 py-3 text-sm font-medium text-[#005142]">
            {success}
          </div>
        )}

        <div className="overflow-hidden rounded-2xl border border-[#c2c8c4]/60 bg-white shadow-[0_14px_40px_rgba(22,42,35,0.06)]">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-left text-sm">
              <thead className="bg-[#e7f7ee] text-[11px] uppercase tracking-[0.08em] text-[#424845]">
                <tr>
                  <th className="px-5 py-3">Unit / tenant</th>
                  <th className="px-4 py-3">Meter</th>
                  <th className="px-4 py-3 text-right">Previous</th>
                  <th className="px-4 py-3">Current reading</th>
                  <th className="px-4 py-3 text-right">Usage</th>
                  <th className="px-4 py-3 text-right">Projected charge</th>
                  <th className="px-5 py-3 text-center">Status</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-[#c2c8c4]/35">
                {selectedService.units.map(unit => {
                  const raw = values[unit.meterId] ?? ''
                  const parsed = raw.trim() === '' ? null : Number(raw)
                  const invalid =
                    parsed !== null &&
                    (
                      !Number.isFinite(parsed) ||
                      parsed < 0 ||
                      (
                        unit.previousValue !== null &&
                        parsed < unit.previousValue
                      )
                    )

                  const usage =
                    parsed !== null &&
                    Number.isFinite(parsed) &&
                    unit.previousValue !== null
                      ? parsed - unit.previousValue
                      : null

                  const projected =
                    usage !== null &&
                    usage >= 0 &&
                    selectedService.rate !== null
                      ? usage * selectedService.rate
                      : null

                  const dirty = dirtyMeterIds.has(unit.meterId)
                  const saved = unit.currentReadingId !== null && !dirty

                  return (
                    <tr
                      key={unit.meterId}
                      className={invalid ? 'bg-[#ffdad6]/35' : 'hover:bg-[#edfdf3]/55'}
                    >
                      <td className="px-5 py-4">
                        <div className="font-semibold text-[#111e19]">{unit.unitName}</div>
                        <div className="text-xs text-[#737875]">{unit.tenantName}</div>
                      </td>

                      <td className="px-4 py-4 font-mono text-xs text-[#424845]">
                        {unit.serialNumber}
                      </td>

                      <td className="px-4 py-4 text-right">
                        <div className="font-mono font-semibold text-[#111e19]">
                          {unit.previousValue ?? '—'}
                        </div>
                        <div className="text-[11px] text-[#737875]">
                          {unit.previousSource === 'opening'
                            ? 'Opening baseline'
                            : unit.previousSource === 'periodic'
                              ? 'Previous cycle'
                              : 'No previous reading'}
                        </div>
                      </td>

                      <td className="px-4 py-4">
                        <input
                          type="number"
                          min={unit.previousValue ?? 0}
                          value={raw}
                          onChange={event => updateValue(unit.meterId, event.target.value)}
                          className={`h-10 w-36 rounded-lg border px-3 font-mono font-semibold outline-none transition ${
                            invalid
                              ? 'border-[#ba1a1a] bg-[#ffdad6]/30 text-[#93000a]'
                              : 'border-[#c2c8c4] bg-white text-[#111e19] focus:border-[#1e6a59]'
                          }`}
                          placeholder="Enter reading"
                        />
                      </td>

                      <td className={`px-4 py-4 text-right font-mono font-semibold ${invalid ? 'text-[#ba1a1a]' : 'text-[#111e19]'}`}>
                        {invalid
                          ? 'Invalid'
                          : usage === null
                            ? '—'
                            : usage}
                      </td>

                      <td className="px-4 py-4 text-right font-mono font-semibold text-[#1e6a59]">
                        {projected === null ? '—' : money(projected)}
                      </td>

                      <td className="px-5 py-4 text-center">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                          invalid
                            ? 'bg-[#ffdad6] text-[#93000a]'
                            : dirty
                              ? 'bg-[#dcece2] text-[#424845]'
                              : saved
                                ? 'bg-[#a8f1db]/55 text-[#005142]'
                                : 'bg-[#e7f7ee] text-[#737875]'
                        }`}>
                          {invalid
                            ? 'Needs correction'
                            : dirty
                              ? 'Unsaved'
                              : saved
                                ? 'Saved'
                                : 'Not entered'}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-3 border-t border-[#c2c8c4]/45 bg-[#edfdf3] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-[#424845]">
              Saving writes these values as the current readings for this billing cycle. Reopening this cycle keeps them as current—not previous.
            </p>

            <button
              type="button"
              onClick={() => void saveSelectedService()}
              disabled={saving || unsavedCount === 0}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#1e6a59] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#175748] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[18px]">
                {saving ? 'progress_activity' : 'save'}
              </span>
              {saving ? 'Saving readings…' : 'Save readings'}
            </button>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="space-y-5">
      {error && (
        <div className="rounded-xl border border-[#ba1a1a]/20 bg-[#ffdad6] px-4 py-3 text-sm text-[#93000a]">
          {error}
        </div>
      )}

      {workspace.services.length === 0 ? (
        <div className="rounded-2xl border border-[#c2c8c4]/60 bg-white p-8 text-center shadow-[0_14px_40px_rgba(22,42,35,0.06)]">
          <span className="material-symbols-outlined text-3xl text-[#1e6a59]">check_circle</span>
          <h3 className="mt-2 text-lg font-semibold text-[#111e19]">No usage readings required</h3>
          <p className="mt-1 text-sm text-[#424845]">
            This property currently has no active usage-based billing services for this cycle.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {workspace.services.map(service => {
            const status = serviceStatus(service)
            const complete = status === 'Complete'
            const needsAttention = status === 'Needs attention'

            return (
              <button
                key={service.serviceId}
                type="button"
                onClick={() => {
                  setSelectedServiceId(service.serviceId)
                  setError('')
                  setSuccess('')
                }}
                className="rounded-2xl border border-[#c2c8c4]/60 bg-white p-5 text-left shadow-[0_14px_40px_rgba(22,42,35,0.06)] transition hover:-translate-y-0.5 hover:border-[#1e6a59]/50 hover:shadow-[0_18px_45px_rgba(22,42,35,0.09)]"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <span className="material-symbols-outlined flex h-10 w-10 items-center justify-center rounded-xl bg-[#e2f2e8] text-[22px] text-[#1e6a59]">
                      {serviceIcon(service.serviceName)}
                    </span>

                    <div>
                      <h3 className="font-semibold text-[#111e19]">{service.serviceName}</h3>
                      <p className="mt-0.5 text-xs uppercase tracking-wide text-[#737875]">
                        Usage-based · {service.applicability === 'optional' ? 'Optional' : 'Mandatory'}
                      </p>
                    </div>
                  </div>

                  <span className="material-symbols-outlined text-[#737875]">arrow_forward</span>
                </div>

                <div className="mt-5 rounded-xl bg-[#edfdf3] p-4">
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <div className="text-2xl font-bold text-[#111e19]">
                        {service.savedCount} / {service.totalCount}
                      </div>
                      <div className="text-xs text-[#424845]">readings saved</div>
                    </div>

                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                      needsAttention
                        ? 'bg-[#ffdad6] text-[#93000a]'
                        : complete
                          ? 'bg-[#a8f1db]/55 text-[#005142]'
                          : 'bg-[#dcece2] text-[#424845]'
                    }`}>
                      {status}
                    </span>
                  </div>

                  <div className="mt-3 flex items-center justify-between border-t border-[#c2c8c4]/40 pt-3 text-xs text-[#424845]">
                    <span>{money(service.rate)} per unit consumed</span>
                    {service.missingMeterCount > 0 && (
                      <span className="font-semibold text-[#ba1a1a]">
                        {service.missingMeterCount} meter{service.missingMeterCount === 1 ? '' : 's'} missing
                      </span>
                    )}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}

      <div className={`rounded-xl border px-4 py-3 text-sm ${
        workspace.complete
          ? 'border-[#1e6a59]/20 bg-[#a8f1db]/35 text-[#005142]'
          : 'border-[#c2c8c4]/50 bg-[#e7f7ee] text-[#424845]'
      }`}>
        {workspace.complete
          ? 'All required current-cycle meter readings are saved.'
          : `${workspace.totalCount - workspace.savedCount} reading${workspace.totalCount - workspace.savedCount === 1 ? '' : 's'} still need to be saved before draft generation.${workspace.missingMeterCount > 0 ? ` ${workspace.missingMeterCount} meter configuration issue${workspace.missingMeterCount === 1 ? '' : 's'} also need attention.` : ''}`}
      </div>
    </section>
  )
}
