import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'

import PageSkeleton from '../components/loading/PageSkeleton'
import BillingReadingsPanel from '../features/billing/components/BillingReadingsPanel'
import BillingServicesPanel from '../features/billing/components/BillingServicesPanel'

import type { BillingReadingsWorkspace } from '../features/billing/data/billingReadingsRepository'

import {
  createCurrentBillingCycle,
  fetchBillingCycles,
  fetchBillingDashboard,
  fetchBillingProperties,
  fetchDraftDetail,
  generatePropertyBillDrafts,
} from '../features/billing/data/billingRepository'

import type {
  BillDraftRow,
  BillingCycle,
  BillingDashboardData,
  BillingProperty,
  DraftDetail,
  GenerateDraftsResult,
} from '../features/billing/data/types'

type BillingStep =
  | 'services'
  | 'readings'
  | 'generate'
  | 'review'

const emptyDashboard: BillingDashboardData = {
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

const emptyReadings: BillingReadingsWorkspace = {
  services: [],
  savedCount: 0,
  totalCount: 0,
  missingMeterCount: 0,
  complete: false,
}

function money(amount: number) {
  return new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: 'KES',
    maximumFractionDigits: 2,
  }).format(amount)
}

function cycleLabel(cycle: BillingCycle) {
  return new Date(`${cycle.period_start}T00:00:00`).toLocaleDateString(
    'en-KE',
    { month: 'long', year: 'numeric' },
  )
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message

  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message
  }

  return fallback
}

function displayContext(value: string) {
  if (value === 'move_in') return 'Move-in'
  if (value === 'move_out') return 'Move-out'
  if (value === 'renewal') return 'Renewal'
  return 'Normal'
}

const steps: Array<{
  id: BillingStep
  number: number
  title: string
}> = [
  { id: 'services', number: 1, title: 'Billing services' },
  { id: 'readings', number: 2, title: 'Meter readings' },
  { id: 'generate', number: 3, title: 'Generate drafts' },
  { id: 'review', number: 4, title: 'Review drafts' },
]

export default function BillingPage() {
  const [properties, setProperties] = useState<BillingProperty[]>([])
  const [propertyId, setPropertyId] = useState('')
  const [cycles, setCycles] = useState<BillingCycle[]>([])
  const [cycleId, setCycleId] = useState('')
  const [dashboard, setDashboard] = useState(emptyDashboard)
  const [readings, setReadings] = useState(emptyReadings)
  const [step, setStep] = useState<BillingStep>('services')
  const [selectedDraft, setSelectedDraft] = useState<DraftDetail | null>(null)
  const [generationResult, setGenerationResult] = useState<GenerateDraftsResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [creatingCycle, setCreatingCycle] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [openingDraft, setOpeningDraft] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const property = useMemo(
    () => properties.find(item => item.id === propertyId) ?? null,
    [properties, propertyId],
  )

  const cycle = useMemo(
    () => cycles.find(item => item.id === cycleId) ?? null,
    [cycles, cycleId],
  )

  const currentStepNumber =
    steps.find(item => item.id === step)?.number ?? 1

  const draftsExist = dashboard.draftCount > 0

  const configurationReady =
    dashboard.configurationIssues.every(issue =>
      issue.type !== 'missing_meter' && issue.type !== 'missing_rate',
    )

  useEffect(() => {
    async function loadProperties() {
      try {
        setLoading(true)
        setError('')

        const rows = await fetchBillingProperties()
        setProperties(rows)
        setPropertyId(rows[0]?.id ?? '')
      } catch (loadError) {
        console.error('[BillingPage] property load failed', loadError)
        setError(errorMessage(loadError, 'Could not load billing properties.'))
      } finally {
        setLoading(false)
      }
    }

    void loadProperties()
  }, [])

  useEffect(() => {
    if (!property) {
      setCycles([])
      setCycleId('')
      setDashboard(emptyDashboard)
      return
    }

    async function loadPropertyCycles() {
      try {
        setLoading(true)
        setError('')
        setSuccess('')
        setGenerationResult(null)
        setSelectedDraft(null)

        const rows = await fetchBillingCycles(property!.id)
        setCycles(rows)

        const currentMonth = new Date().toISOString().slice(0, 7)
        const current = rows.find(item => item.period_start.startsWith(currentMonth))

        setCycleId((current ?? rows[0])?.id ?? '')
      } catch (loadError) {
        console.error('[BillingPage] cycle load failed', loadError)
        setError(errorMessage(loadError, 'Could not load billing cycles.'))
      } finally {
        setLoading(false)
      }
    }

    void loadPropertyCycles()
  }, [property])

  const refreshDashboard = useCallback(async () => {
    if (!property || !cycle) return

    try {
      const next = await fetchBillingDashboard(property.id, cycle)
      setDashboard(next)

      if (next.draftCount > 0) {
        setStep('review')
      }
    } catch (loadError) {
      console.error('[BillingPage] dashboard refresh failed', loadError)
      setError(errorMessage(loadError, 'Could not refresh the billing cycle.'))
    }
  }, [property, cycle])

  useEffect(() => {
    if (!cycle || !property) {
      setDashboard(emptyDashboard)
      return
    }

    void refreshDashboard()
  }, [cycle, property, refreshDashboard])

  const handleReadingsCompletion = useCallback((
    _complete: boolean,
    workspace: BillingReadingsWorkspace,
  ) => {
    setReadings(workspace)
  }, [])

  async function createCycle() {
    if (!property) return

    try {
      setCreatingCycle(true)
      setError('')
      setSuccess('')

      const newCycleId = await createCurrentBillingCycle(property.id)
      const rows = await fetchBillingCycles(property.id)

      setCycles(rows)
      setCycleId(newCycleId)
      setStep('services')
      setSuccess('Billing cycle created. Confirm the property billing configuration before continuing.')
    } catch (createError) {
      console.error('[BillingPage] cycle creation failed', createError)
      setError(errorMessage(createError, 'Could not create billing cycle.'))
    } finally {
      setCreatingCycle(false)
    }
  }

  async function generateDrafts() {
    if (!cycle || !readings.complete || !configurationReady) return

    try {
      setGenerating(true)
      setError('')
      setSuccess('')
      setGenerationResult(null)

      const result = await generatePropertyBillDrafts(cycle.id)
      setGenerationResult(result)

      await refreshDashboard()

      if (result.fatal_errors > 0 || result.missing_meter_readings > 0) {
        setStep('generate')
        setError(
          `Draft generation needs attention: ${result.missing_meter_readings} missing reading issue${result.missing_meter_readings === 1 ? '' : 's'} and ${result.fatal_errors} generation error${result.fatal_errors === 1 ? '' : 's'}.`,
        )
        return
      }

      setStep('review')
      setSuccess(
        result.drafts_generated > 0
          ? `${result.drafts_generated} invoice draft${result.drafts_generated === 1 ? '' : 's'} generated.`
          : 'Draft check complete. Existing drafts were preserved without duplication.',
      )
    } catch (generationError) {
      console.error('[BillingPage] draft generation failed', generationError)
      setError(errorMessage(generationError, 'Draft generation failed.'))
    } finally {
      setGenerating(false)
    }
  }

  async function openDraft(draft: BillDraftRow) {
    try {
      setOpeningDraft(true)
      setError('')
      setSelectedDraft(await fetchDraftDetail(draft))
    } catch (draftError) {
      console.error('[BillingPage] draft detail failed', draftError)
      setError(errorMessage(draftError, 'Could not load the invoice draft.'))
    } finally {
      setOpeningDraft(false)
    }
  }

  function navigate(target: BillingStep) {
    if (!cycle) return

    if (draftsExist && target !== 'review') {
      setError('Drafts already exist for this cycle. Finish reviewing them before changing the billing inputs.')
      return
    }

    const targetNumber = steps.find(item => item.id === target)?.number ?? 1

    if (targetNumber > currentStepNumber) {
      if (target === 'generate' && !readings.complete) return
      if (target === 'review' && !draftsExist) return
    }

    setError('')
    setSuccess('')
    setStep(target)
  }

  if (loading && properties.length === 0) {
    return <PageSkeleton variant="billing" />
  }

  return (
    <div className="min-h-full bg-[#edfdf3] px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-5">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#1e6a59]">
              Billing
            </span>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-[#111e19]">
              Monthly billing
            </h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-[#424845]">
              Confirm property charges, record current-cycle meter readings, generate tenant drafts, then review every amount before invoices are issued.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="rounded-xl border border-[#c2c8c4]/55 bg-white px-4 py-2 shadow-sm">
              <span className="block text-[10px] font-semibold uppercase tracking-wide text-[#737875]">Property</span>
              <select
                value={propertyId}
                onChange={event => setPropertyId(event.target.value)}
                className="mt-0.5 bg-transparent text-sm font-semibold text-[#111e19] outline-none"
              >
                {properties.map(item => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </label>

            {cycle && (
              <div className="rounded-xl border border-[#c2c8c4]/55 bg-white px-4 py-2 shadow-sm">
                <span className="block text-[10px] font-semibold uppercase tracking-wide text-[#737875]">Cycle</span>
                <span className="text-sm font-semibold text-[#111e19]">{cycleLabel(cycle)}</span>
              </div>
            )}
          </div>
        </header>

        {error && (
          <div className="rounded-xl border border-[#ba1a1a]/20 bg-[#ffdad6] px-4 py-3 text-sm text-[#93000a]">
            {error}
          </div>
        )}

        {success && (
          <div className="rounded-xl border border-[#1e6a59]/20 bg-[#a8f1db]/40 px-4 py-3 text-sm font-medium text-[#005142]">
            {success}
          </div>
        )}

        {!property ? (
          <section className="rounded-2xl border border-[#c2c8c4]/60 bg-white p-8 text-center shadow-[0_14px_40px_rgba(22,42,35,0.06)]">
            <h2 className="text-xl font-semibold text-[#111e19]">No active property found</h2>
          </section>
        ) : !cycle ? (
          <section className="overflow-hidden rounded-2xl border border-[#c2c8c4]/60 bg-white shadow-[0_18px_50px_rgba(22,42,35,0.07)]">
            <div className="max-w-3xl p-7 sm:p-9">
              <div className="inline-flex items-center gap-2 rounded-full bg-[#a8f1db]/45 px-3 py-1 text-xs font-semibold text-[#005142]">
                <span className="h-2 w-2 rounded-full bg-[#1e6a59]" />
                Ready to start
              </div>

              <h2 className="mt-4 text-2xl font-semibold text-[#111e19]">
                Create this month&apos;s billing cycle
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[#424845]">
                Creating the cycle opens a draft billing period. Nothing is invoiced or sent to tenants yet.
              </p>

              <button
                type="button"
                onClick={() => void createCycle()}
                disabled={creatingCycle}
                className="mt-6 inline-flex items-center gap-2 rounded-lg bg-[#1e6a59] px-5 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-[#175748] disabled:opacity-60"
              >
                <span className="material-symbols-outlined text-[20px]">
                  {creatingCycle ? 'progress_activity' : 'add_circle'}
                </span>
                {creatingCycle ? 'Creating billing cycle…' : 'Create billing cycle'}
              </button>
            </div>
          </section>
        ) : (
          <>
            <section className="rounded-2xl border border-[#c2c8c4]/60 bg-white p-4 shadow-[0_14px_40px_rgba(22,42,35,0.06)] sm:p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold text-[#111e19]">
                      {cycleLabel(cycle)} billing run
                    </h2>
                    <span className="rounded-full bg-[#e2f2e8] px-2.5 py-1 text-xs font-semibold capitalize text-[#424845]">
                      {cycle.status.replaceAll('_', ' ')}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-[#424845]">{property.name}</p>
                </div>

                <div className="grid flex-1 grid-cols-2 gap-2 md:grid-cols-4 lg:max-w-3xl">
                  {steps.map(item => {
                    const active = item.id === step
                    const completed = item.number < currentStepNumber || (item.id === 'review' && draftsExist)
                    const locked = draftsExist && item.id !== 'review'

                    return (
                      <button
                        key={item.id}
                        type="button"
                        disabled={locked || (item.number > currentStepNumber && item.id !== 'review')}
                        onClick={() => navigate(item.id)}
                        className={`flex items-center gap-2 rounded-xl border p-3 text-left transition ${
                          active
                            ? 'border-[#1e6a59]/35 bg-[#e7f7ee]'
                            : 'border-transparent bg-[#edfdf3]/70'
                        } disabled:cursor-default disabled:opacity-55`}
                      >
                        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                          completed
                            ? 'bg-[#1e6a59] text-white'
                            : active
                              ? 'bg-[#a8f1db] text-[#005142]'
                              : 'bg-[#dcece2] text-[#424845]'
                        }`}>
                          {completed ? '✓' : item.number}
                        </span>
                        <span className="min-w-0 text-xs font-semibold text-[#111e19] sm:text-sm">
                          {item.title}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </section>

            {step === 'services' && (
              <section className="space-y-5">
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#1e6a59]">Property configuration</span>
                  <h2 className="mt-1 text-2xl font-semibold text-[#111e19]">Billing services</h2>
                  <p className="mt-1 text-sm text-[#424845]">
                    Confirm what this property charges, who receives each charge, and how each rate is calculated.
                  </p>
                </div>

                <BillingServicesPanel
                  propertyId={property.id}
                  effectiveFrom={cycle.period_start}
                  effectiveDate={cycle.period_end}
                  onChanged={refreshDashboard}
                />

                <div className="flex justify-end rounded-xl border border-[#c2c8c4]/50 bg-[#e7f7ee] p-4">
                  <button
                    type="button"
                    onClick={() => navigate('readings')}
                    className="inline-flex items-center gap-2 rounded-lg bg-[#1e6a59] px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#175748]"
                  >
                    Next: Meter readings
                    <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                  </button>
                </div>
              </section>
            )}

            {step === 'readings' && (
              <section className="space-y-5">
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#1e6a59]">Cycle readings</span>
                  <h2 className="mt-1 text-2xl font-semibold text-[#111e19]">Meter readings</h2>
                  <p className="mt-1 max-w-3xl text-sm leading-6 text-[#424845]">
                    Record current readings for {cycleLabel(cycle)}. Previous values are loaded from the most recent earlier cycle, or from each meter&apos;s opening reading when this is its first billed cycle.
                  </p>
                </div>

                <BillingReadingsPanel
                  propertyId={property.id}
                  cycle={cycle}
                  onCompletionChange={handleReadingsCompletion}
                />

                <div className="flex flex-col gap-3 rounded-xl border border-[#c2c8c4]/50 bg-[#e7f7ee] p-4 sm:flex-row sm:items-center sm:justify-between">
                  <button
                    type="button"
                    onClick={() => navigate('services')}
                    className="inline-flex items-center gap-1 text-sm font-semibold text-[#424845] hover:text-[#111e19]"
                  >
                    <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                    Back to billing services
                  </button>

                  <div className="flex items-center gap-3">
                    {!readings.complete && (
                      <span className="text-xs font-medium text-[#424845]">
                        Complete and save all required readings first.
                      </span>
                    )}
                    <button
                      type="button"
                      disabled={!readings.complete}
                      onClick={() => navigate('generate')}
                      className="inline-flex items-center gap-2 rounded-lg bg-[#1e6a59] px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#175748] disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      Next: Generate drafts
                      <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                    </button>
                  </div>
                </div>
              </section>
            )}

            {step === 'generate' && (
              <section className="mx-auto w-full max-w-4xl space-y-5">
                <div className="rounded-2xl border border-[#c2c8c4]/60 bg-white p-6 shadow-[0_18px_50px_rgba(22,42,35,0.07)] sm:p-8">
                  <div className="mx-auto max-w-2xl text-center">
                    <span className="material-symbols-outlined flex h-14 w-14 items-center justify-center rounded-full bg-[#a8f1db]/50 text-3xl text-[#1e6a59] mx-auto">
                      checklist_rtl
                    </span>
                    <h2 className="mt-4 text-2xl font-semibold text-[#111e19]">Generate invoice drafts</h2>
                    <p className="mt-2 text-sm leading-6 text-[#424845]">
                      Dwellio will calculate rent, fixed services, usage charges, lease context, and any previous unpaid balance carried forward for each tenant.
                    </p>
                  </div>

                  <div className="mt-7 grid gap-3 sm:grid-cols-2">
                    <ReadinessRow
                      label="Billing services"
                      value={`${dashboard.services.length} active services`}
                      ready={configurationReady}
                    />
                    <ReadinessRow
                      label="Usage readings"
                      value={`${readings.savedCount} / ${readings.totalCount} saved`}
                      ready={readings.complete}
                    />
                    <ReadinessRow
                      label="Meter configuration"
                      value={readings.missingMeterCount === 0 ? 'All required meters configured' : `${readings.missingMeterCount} missing meters`}
                      ready={readings.missingMeterCount === 0}
                    />
                    <ReadinessRow
                      label="Active leases"
                      value={`${dashboard.leaseCount} lease${dashboard.leaseCount === 1 ? '' : 's'} in scope`}
                      ready={dashboard.leaseCount > 0}
                    />
                  </div>

                  {generationResult && (
                    <div className="mt-5 rounded-xl bg-[#edfdf3] p-4 text-sm text-[#424845]">
                      Last run checked {generationResult.leases_checked} leases and generated {generationResult.drafts_generated} drafts.
                    </div>
                  )}

                  <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <button
                      type="button"
                      onClick={() => navigate('readings')}
                      className="inline-flex items-center gap-1 text-sm font-semibold text-[#424845] hover:text-[#111e19]"
                    >
                      <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                      Back to meter readings
                    </button>

                    <button
                      type="button"
                      disabled={generating || !readings.complete || !configurationReady || dashboard.leaseCount === 0}
                      onClick={() => void generateDrafts()}
                      className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#1e6a59] px-6 py-3 text-sm font-semibold text-white shadow-md hover:bg-[#175748] disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <span className="material-symbols-outlined text-[20px]">
                        {generating ? 'progress_activity' : 'auto_fix_high'}
                      </span>
                      {generating ? 'Generating invoice drafts…' : 'Generate invoice drafts'}
                    </button>
                  </div>
                </div>
              </section>
            )}

            {step === 'review' && (
              <section className="space-y-5">
                <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#1e6a59]">Draft review</span>
                    <h2 className="mt-1 text-2xl font-semibold text-[#111e19]">Invoice drafts</h2>
                    <p className="mt-1 max-w-3xl text-sm leading-6 text-[#424845]">
                      Review current-cycle charges separately from carried-forward arrears before we design and connect the final tenant invoice screen.
                    </p>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <Metric label="Drafts" value={String(dashboard.draftCount)} />
                    <Metric
                      label="Current charges"
                      value={money(dashboard.drafts.reduce((sum, draft) => sum + draft.current_charges, 0))}
                    />
                    <Metric
                      label="Previous balances"
                      value={money(dashboard.drafts.reduce((sum, draft) => sum + draft.previous_balance, 0))}
                      danger={dashboard.drafts.some(draft => draft.previous_balance > 0)}
                    />
                  </div>
                </div>

                <div className="overflow-hidden rounded-2xl border border-[#c2c8c4]/60 bg-white shadow-[0_14px_40px_rgba(22,42,35,0.06)]">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[950px] border-collapse text-left text-sm">
                      <thead className="bg-[#e7f7ee] text-[11px] uppercase tracking-[0.08em] text-[#424845]">
                        <tr>
                          <th className="px-5 py-3">Tenant</th>
                          <th className="px-4 py-3">Unit</th>
                          <th className="px-4 py-3">Context</th>
                          <th className="px-4 py-3 text-right">Current charges</th>
                          <th className="px-4 py-3 text-right">Previous balance / arrears</th>
                          <th className="px-4 py-3 text-right">Total payable</th>
                          <th className="px-4 py-3 text-center">Status</th>
                          <th className="px-5 py-3 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#c2c8c4]/35">
                        {dashboard.drafts.map(draft => (
                          <tr key={draft.id} className="hover:bg-[#edfdf3]/55">
                            <td className="px-5 py-4 font-semibold text-[#111e19]">{draft.tenantName}</td>
                            <td className="px-4 py-4 text-[#424845]">{draft.unitName}</td>
                            <td className="px-4 py-4">
                              <span className="rounded-full bg-[#e2f2e8] px-2.5 py-1 text-xs font-semibold text-[#424845]">
                                {displayContext(draft.billing_context)}
                              </span>
                            </td>
                            <td className="px-4 py-4 text-right font-mono font-semibold text-[#111e19]">
                              {money(draft.current_charges)}
                            </td>
                            <td className={`px-4 py-4 text-right font-mono font-semibold ${draft.previous_balance > 0 ? 'text-[#ba1a1a]' : 'text-[#737875]'}`}>
                              {money(draft.previous_balance)}
                            </td>
                            <td className="px-4 py-4 text-right font-mono font-bold text-[#1e6a59]">
                              {money(draft.total_payable)}
                            </td>
                            <td className="px-4 py-4 text-center">
                              <span className="rounded-full bg-[#dcece2] px-2.5 py-1 text-xs font-semibold capitalize text-[#424845]">
                                {draft.status}
                              </span>
                            </td>
                            <td className="px-5 py-4 text-right">
                              <button
                                type="button"
                                disabled={openingDraft}
                                onClick={() => void openDraft(draft)}
                                className="rounded-lg bg-[#e2f2e8] px-3 py-1.5 text-xs font-semibold text-[#1e6a59] hover:bg-[#d6e6dd] disabled:opacity-50"
                              >
                                Review
                              </button>
                            </td>
                          </tr>
                        ))}

                        {dashboard.drafts.length === 0 && (
                          <tr>
                            <td colSpan={8} className="px-5 py-10 text-center text-sm text-[#737875]">
                              No invoice drafts exist for this cycle yet.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="rounded-xl border border-[#1e6a59]/20 bg-[#a8f1db]/30 p-4 text-sm text-[#005142]">
                  Drafts are review records only. The next screen we design will be the final tenant-facing invoice and finalization/dispatch step.
                </div>
              </section>
            )}
          </>
        )}
      </div>

      {selectedDraft && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/35 backdrop-blur-sm">
          <div className="flex h-full w-full max-w-xl flex-col overflow-y-auto bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-[#c2c8c4]/50 pb-4">
              <div>
                <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#1e6a59]">Invoice draft inspection</span>
                <h3 className="mt-1 text-xl font-semibold text-[#111e19]">
                  {selectedDraft.draft.unitName} · {selectedDraft.draft.tenantName}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedDraft(null)}
                className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#edfdf3] text-[#424845]"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <div className="mt-5 space-y-3">
              {selectedDraft.charges.map(charge => (
                <div key={charge.id} className="rounded-xl bg-[#edfdf3] p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="font-semibold text-[#111e19]">{charge.description}</div>
                      <div className="mt-0.5 text-xs uppercase tracking-wide text-[#737875]">{charge.charge_type}</div>
                    </div>
                    <div className="font-mono font-bold text-[#111e19]">{money(charge.amount)}</div>
                  </div>

                  {charge.details.map(detail => (
                    <div key={detail.id} className="mt-3 rounded-lg bg-white px-3 py-2 text-xs text-[#424845]">
                      {detail.previous_reading !== null && detail.current_reading !== null
                        ? `${detail.previous_reading} → ${detail.current_reading} · ${detail.consumption ?? 0} units × ${money(detail.rate ?? 0)}`
                        : 'No meter detail for this charge.'}
                    </div>
                  ))}
                </div>
              ))}
            </div>

            <div className="mt-6 rounded-2xl border border-[#c2c8c4]/55 p-5">
              <div className="flex justify-between gap-3 py-2 text-sm">
                <span className="text-[#424845]">Current-cycle charges</span>
                <strong className="font-mono text-[#111e19]">{money(selectedDraft.draft.current_charges)}</strong>
              </div>
              <div className="flex justify-between gap-3 border-t border-[#c2c8c4]/40 py-2 text-sm">
                <span className="text-[#424845]">Previous balance / arrears</span>
                <strong className={`font-mono ${selectedDraft.draft.previous_balance > 0 ? 'text-[#ba1a1a]' : 'text-[#111e19]'}`}>
                  {money(selectedDraft.draft.previous_balance)}
                </strong>
              </div>

              {selectedDraft.balanceSources.length > 0 && (
                <div className="my-2 rounded-xl bg-[#ffdad6]/35 p-3">
                  <div className="text-xs font-bold uppercase tracking-wide text-[#93000a]">Arrears carried from</div>
                  {selectedDraft.balanceSources.map(source => (
                    <div key={source.source_invoice_id} className="mt-2 flex justify-between gap-3 text-xs text-[#424845]">
                      <span>{source.invoiceNumber}</span>
                      <span className="font-mono font-semibold text-[#93000a]">{money(source.amount)}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex justify-between gap-3 border-t border-[#c2c8c4]/55 pt-4 text-base">
                <span className="font-semibold text-[#111e19]">Total payable</span>
                <strong className="font-mono text-xl text-[#1e6a59]">{money(selectedDraft.draft.total_payable)}</strong>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ReadinessRow({
  label,
  value,
  ready,
}: {
  label: string
  value: string
  ready: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-[#edfdf3] p-4">
      <div>
        <div className="text-sm font-semibold text-[#111e19]">{label}</div>
        <div className="mt-0.5 text-xs text-[#424845]">{value}</div>
      </div>
      <span className={`material-symbols-outlined ${ready ? 'text-[#1e6a59]' : 'text-[#ba1a1a]'}`}>
        {ready ? 'check_circle' : 'error'}
      </span>
    </div>
  )
}

function Metric({
  label,
  value,
  danger = false,
}: {
  label: string
  value: string
  danger?: boolean
}) {
  return (
    <div className="min-w-[120px] rounded-xl border border-[#c2c8c4]/50 bg-white px-4 py-3 shadow-sm">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-[#737875]">{label}</div>
      <div className={`mt-1 text-sm font-bold ${danger ? 'text-[#ba1a1a]' : 'text-[#111e19]'}`}>
        {value}
      </div>
    </div>
  )
}
