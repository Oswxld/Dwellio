import { useEffect, useMemo, useState } from 'react'

import type { PropertyUnit } from '../data/propertyStructureRepository'
import {
  fetchUnitBillingBreakdown,
  fetchUnitBillingCycles,
  type UnitBillingBreakdown,
  type UnitBillingCycle,
  type UnitMeterUsage,
} from '../data/unitBillingRepository'

type Props = {
  propertyId: string
  unit: PropertyUnit
  buildingName: string
  floorName: string
  onClose: () => void
}

function currency(value: number | null) {
  if (value === null) return '—'
  return 'KSh ' + value.toLocaleString('en-KE', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })
}

function number(value: number | null) {
  if (value === null) return '—'
  return value.toLocaleString('en-KE', { maximumFractionDigits: 3 })
}

function monthLabel(cycle: UnitBillingCycle) {
  return new Date(`${cycle.period_start}T12:00:00`)
    .toLocaleDateString('en-KE', { month: 'long', year: 'numeric' })
}

function historyMonth(value: string | null) {
  return value ? new Date(`${value}T12:00:00`).toLocaleDateString('en-KE', {
    month: 'short', year: 'numeric',
  }) : 'Cycle reading'
}

function shortDate(value: string | null) {
  if (!value) return '—'
  return new Date(`${value}T12:00:00`)
    .toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })
}

function amountCaption(kind: UnitMeterUsage['amountKind']) {
  switch (kind) {
    case 'billed': return 'Billed calculation'
    case 'draft': return 'Draft calculation'
    case 'estimate': return 'Estimated from readings'
    default: return 'Awaiting readings'
  }
}

function MeterCard({ meter, serviceName }: { meter: UnitMeterUsage; serviceName: string }) {
  const [historyOpen, setHistoryOpen] = useState(false)
  return (
    <article className="rounded-2xl border border-[#dcece2] bg-[#f3fbf6] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#737875]">Meter</div>
          <div className="truncate font-mono text-xs font-semibold text-[#111e19]" title={meter.serial}>{meter.serial}</div>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${
          meter.status === 'active' ? 'bg-[#a8f1db]/45 text-[#005142]' : 'bg-[#dcece2] text-[#65776c]'
        }`}>{meter.status === 'active' ? 'Active meter' : meter.status.replaceAll('_', ' ')}</span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: 'Previous', value: number(meter.previous), sub: meter.previousDate ? shortDate(meter.previousDate) : 'No baseline' },
          { label: 'Current', value: number(meter.current), sub: meter.currentDate ? shortDate(meter.currentDate) : 'Not recorded' },
          { label: 'Consumption', value: number(meter.consumption), sub: meter.consumption !== null ? 'units consumed' : 'Not available' },
          { label: 'Rate per unit', value: currency(meter.rate), sub: 'KES per consumed unit' },
        ].map(metric => (
          <div key={metric.label} className="rounded-xl bg-white p-3">
            <div className="text-[10px] font-semibold text-[#737875]">{metric.label}</div>
            <div className="mt-2 text-sm font-bold text-[#111e19]">{metric.value}</div>
            <div className="mt-1 text-[10px] text-[#737875]">{metric.sub}</div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#dcece2] bg-white p-3">
        <div>
          <div className="text-[10px] font-semibold text-[#737875]">{amountCaption(meter.amountKind)}</div>
          <div className="mt-1 font-['Newsreader'] text-xl font-semibold text-[#111e19]">{currency(meter.amount)}</div>
        </div>
        <span className="text-[10px] leading-5 text-[#737875]">
          {meter.consumption !== null && meter.rate !== null
            ? `${number(meter.consumption)} units × ${currency(meter.rate)}`
            : 'Both readings and a rate are needed'}
        </span>
      </div>

      <button type="button" aria-expanded={historyOpen}
        onClick={() => setHistoryOpen(current => !current)}
        className="mt-3 inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-semibold text-[#1e6a59] hover:bg-white">
        <span className="material-symbols-outlined text-[18px]">history</span>
        {historyOpen ? 'Hide reading history' : `View reading history (${meter.history.length})`}
        <span className="material-symbols-outlined text-[16px]">{historyOpen ? 'expand_less' : 'expand_more'}</span>
      </button>

      {historyOpen && (
        <div className="mt-3 overflow-x-auto rounded-xl border border-[#dcece2] bg-white">
          {meter.history.length === 0 ? (
            <p className="p-4 text-xs text-[#737875]">No recorded readings for this meter.</p>
          ) : (
            <table className="w-full min-w-[370px] text-left text-xs">
              <thead className="bg-[#e7f7ee] text-[#424845]">
                <tr><th className="p-3">Date</th><th className="p-3">Reading</th><th className="p-3">Type</th><th className="p-3">Billing month</th></tr>
              </thead>
              <tbody>
                {meter.history.map(reading => (
                  <tr key={reading.id} className="border-t border-[#edf3ef] text-[#111e19]">
                    <td className="p-3">{shortDate(reading.date)}</td>
                    <td className="p-3 font-mono font-semibold">{number(reading.value)}</td>
                    <td className="p-3 capitalize">{reading.type}</td>
                    <td className="p-3">
                      {reading.cycleId
                        ? historyMonth(reading.cycleLabel)
                        : 'Opening / baseline'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      <span className="sr-only">{serviceName} meter information</span>
    </article>
  )
}

export default function UnitBillingPanel({ propertyId, unit, buildingName, floorName, onClose }: Props) {
  const [cycles, setCycles] = useState<UnitBillingCycle[]>([])
  const [selectedCycleId, setSelectedCycleId] = useState<string | null>(null)
  const [data, setData] = useState<UnitBillingBreakdown | null>(null)
  const [loadingCycles, setLoadingCycles] = useState(true)
  const [loadingData, setLoadingData] = useState(false)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function initialize() {
      setLoadingCycles(true)
      setError('')
      try {
        const nextCycles = await fetchUnitBillingCycles(propertyId, unit.id)
        if (cancelled) return
        setCycles(nextCycles)
        // Open the most recent actual billing period when available.
        const nowParts = new Intl.DateTimeFormat('en-GB', {
          timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit',
        }).formatToParts(new Date())
        const year = nowParts.find(part => part.type === 'year')?.value ?? ''
        const month = nowParts.find(part => part.type === 'month')?.value ?? ''
        const todayMonth = `${year}-${month}`
        const preferred = nextCycles.find(cycle => cycle.period_start.startsWith(todayMonth)) ??
          nextCycles.find(cycle => cycle.period_start.slice(0, 7) < todayMonth) ??
          nextCycles[0]
        setSelectedCycleId(preferred?.id ?? null)
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Could not load billing months.')
      } finally {
        if (!cancelled) setLoadingCycles(false)
      }
    }
    void initialize()
    return () => { cancelled = true }
  }, [propertyId, unit.id, retry])

  useEffect(() => {
    if (loadingCycles || error) return
    let cancelled = false
    async function load() {
      setLoadingData(true)
      setData(null)
      try {
        const next = await fetchUnitBillingBreakdown(propertyId, unit.id, cycles, selectedCycleId)
        if (!cancelled) setData(next)
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Could not load meter consumption.')
      } finally {
        if (!cancelled) setLoadingData(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [propertyId, unit.id, cycles, selectedCycleId, loadingCycles, error])

  const hasReadings = useMemo(() => data?.services.some(service => service.meters.some(meter => meter.history.length > 0)) ?? false, [data])

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-[#10211c]/50 p-0 backdrop-blur-[2px] sm:items-center sm:p-5">
      <section role="dialog" aria-modal="true" aria-label={`Unit ${unit.name} billing details`}
        className="flex max-h-[96vh] w-full max-w-5xl flex-col overflow-hidden rounded-t-3xl bg-[#edfdf3] shadow-[0_28px_90px_rgba(16,33,28,.26)] sm:rounded-2xl">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#dcece2] bg-[#edfdf3] px-5 py-4 sm:px-6">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#1e6a59]">Property units / Unit details</div>
            <h2 className="mt-1 font-['Newsreader'] text-2xl font-semibold text-[#111e19]">{unit.name}</h2>
            <p className="mt-1 text-xs text-[#737875]">{buildingName} · {floorName}</p>
          </div>
          <button type="button" onClick={onClose}
            className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-xs font-semibold text-[#1e6a59] shadow-sm">
            <span className="material-symbols-outlined text-[18px]">arrow_back</span>
            Back to units
          </button>
        </header>

        <div className="space-y-5 overflow-y-auto p-5 sm:p-6">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-white p-4">
              <div className="text-[10px] font-semibold text-[#737875]">Unit status</div>
              <div className="mt-1 text-sm font-semibold capitalize text-[#111e19]">{unit.status.replaceAll('_', ' ')}</div>
            </div>
            <div className="rounded-xl bg-white p-4">
              <div className="text-[10px] font-semibold text-[#737875]">Default rent</div>
              <div className="mt-1 text-sm font-semibold text-[#111e19]">{currency(unit.default_rent_amount)}</div>
            </div>
            <div className="rounded-xl bg-white p-4">
              <label className="block text-[10px] font-semibold text-[#737875]" htmlFor="unit-billing-cycle">Billing month</label>
              <select id="unit-billing-cycle" disabled={loadingCycles || cycles.length === 0}
                value={selectedCycleId ?? ''} onChange={event => { setError(''); setSelectedCycleId(event.target.value || null) }}
                className="mt-1 w-full rounded-lg border border-[#dcece2] bg-[#edfdf3] px-2 py-1.5 text-sm font-semibold text-[#111e19]">
                {cycles.length === 0 && <option value="">No billing cycles yet</option>}
                {cycles.map(cycle => <option key={cycle.id} value={cycle.id}>{monthLabel(cycle)}</option>)}
              </select>
            </div>
          </div>

          <div className="rounded-xl border border-[#dcece2] bg-white p-4 text-xs leading-5 text-[#424845]">
            <strong className="text-[#111e19]">How the numbers are calculated:</strong>{' '}
            Consumption = current reading − previous reading. Cost = consumption × applicable rate.
            Where Dwellio has already generated a bill charge, its recorded consumption and rate take priority.
            Estimates are not finalized invoices.
          </div>

          {error ? (
            <div role="alert" className="rounded-2xl bg-white p-6">
              <p className="text-sm text-[#93000a]">{error}</p>
              <button type="button" className="mt-3 rounded-lg bg-[#10211c] px-4 py-2 text-sm font-semibold text-white"
                onClick={() => { setError(''); setRetry(value => value + 1) }}>Retry</button>
            </div>
          ) : loadingCycles || loadingData || !data ? (
            <div className="space-y-3" aria-label="Loading unit billing details">
              {[1, 2, 3].map(item => <div key={item} className="h-28 animate-pulse rounded-xl bg-[#dcece2]"/>)}
            </div>
          ) : (
            <>
              {!data.selectedCycle && (
                <div className="rounded-xl border border-[#dcece2] bg-white p-4 text-xs text-[#424845]">
                  There is no billing cycle yet. You can inspect existing meter opening readings,
                  but period consumption and bill amounts are not available until readings are recorded for a cycle.
                </div>
              )}
              {data.invoiceNumber && <div className="rounded-xl bg-[#e7f7ee] p-4 text-xs text-[#005142]">
                Finalized invoice for this unit: <strong>{data.invoiceNumber}</strong>
              </div>}

              {data.services.length === 0 ? (
                <div className="rounded-2xl bg-white p-8 text-center">
                  <span className="material-symbols-outlined text-3xl text-[#1e6a59]">water_drop</span>
                  <h3 className="mt-2 font-semibold text-[#111e19]">No billing services configured</h3>
                  <p className="mt-1 text-sm text-[#737875]">Add services under this property's Billing Services configuration.</p>
                </div>
              ) : data.services.map(service => (
                <section key={service.id} className="rounded-2xl border border-[#dcece2] bg-white p-5 shadow-[0_10px_24px_rgba(16,33,28,.04)]">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="font-['Newsreader'] text-xl font-semibold text-[#111e19]">{service.name}</h3>
                      <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-semibold">
                        <span className="rounded-full bg-[#e7f7ee] px-2.5 py-1 text-[#1e6a59]">{service.method === 'usage' ? 'Usage-based' : 'Fixed'}</span>
                        <span className="rounded-full bg-[#e7f7ee] px-2.5 py-1 capitalize text-[#424845]">{service.applicability}</span>
                        <span className={`rounded-full px-2.5 py-1 ${
                          service.isActive ? 'bg-[#a8f1db]/45 text-[#005142]' : 'bg-[#dcece2] text-[#737875]'
                        }`}>{service.isActive ? 'Active' : 'Inactive'}</span>
                      </div>
                    </div>
                    <div className="text-left sm:text-right">
                      <div className="text-[10px] font-semibold text-[#737875]">{service.method === 'usage' ? 'Applicable rate per unit' : 'Applicable rate per period'}</div>
                      <div className="mt-1 font-semibold text-[#111e19]">{currency(service.applicableRate)}</div>
                    </div>
                  </div>

                  {service.method === 'fixed' ? (
                    <div className="mt-4 rounded-xl bg-[#f3fbf6] p-4">
                      <p className="text-xs text-[#424845]">Fixed services do not have consumption readings.</p>
                      <div className="mt-3 text-[10px] font-semibold text-[#737875]">
                        {service.chargeKind === 'billed' ? 'Billed charge'
                          : service.chargeKind === 'draft' ? 'Draft charge'
                          : 'Configured rate — not billed'}
                      </div>
                      <div className="mt-1 font-['Newsreader'] text-2xl font-semibold text-[#111e19]">
                        {currency(service.chargedAmount ?? service.applicableRate)}
                      </div>
                    </div>
                  ) : service.meters.length === 0 ? (
                    <div className="mt-4 rounded-xl bg-[#fff5dc] p-4 text-sm text-[#7e621a]">
                      No meter configured for {unit.name} under {service.name}.
                      Configure a meter in the property's Billing Services section.
                    </div>
                  ) : (
                    <div className="mt-4 space-y-3">
                      {service.chargeKind === 'billed' || service.chargeKind === 'draft' ? (
                        <div className="rounded-xl bg-[#e7f7ee] px-4 py-3">
                          <div className="text-[10px] font-semibold text-[#737875]">
                            {service.chargeKind === 'billed' ? 'Recorded billed service charge' : 'Recorded draft service charge'}
                          </div>
                          <div className="mt-1 font-['Newsreader'] text-xl font-semibold text-[#005142]">{currency(service.chargedAmount)}</div>
                        </div>
                      ) : null}
                      {service.meters.map(meter => <MeterCard key={meter.id} meter={meter} serviceName={service.name}/>)}
                    </div>
                  )}
                </section>
              ))}

              {!hasReadings && <p className="text-xs text-[#737875]">
                No opening or periodic meter readings have been recorded yet for this unit.
              </p>}
            </>
          )}
        </div>
      </section>
    </div>
  )
}
