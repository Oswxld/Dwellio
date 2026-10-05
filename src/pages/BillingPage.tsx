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
  approveAllBillDrafts,
  approveBillDraft,
  correctMeterReading,
  createCurrentBillingCycle,
  fetchBillingCycles,
  fetchBillingDashboard,
  fetchBillingProperties,
  fetchDraftDetail,
  generatePropertyBillDrafts,
} from '../features/billing/data/billingRepository'

import type {
  BillChargeDetail,
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
  | 'invoices'
  | 'send'

type ReadingCorrectionTarget = {
  chargeDescription: string
  detail: BillChargeDetail
}

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
  { id: 'invoices', number: 5, title: 'View invoices' },
  { id: 'send', number: 6, title: 'Send invoices' },
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
  const [approvingDraft, setApprovingDraft] = useState(false)
  const [approvingAll, setApprovingAll] = useState(false)
  const [readingCorrection, setReadingCorrection] = useState<ReadingCorrectionTarget | null>(null)
  const [newReadingValue, setNewReadingValue] = useState('')
  const [savingReadingCorrection, setSavingReadingCorrection] = useState(false)
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
  const allDraftsApproved =
    dashboard.draftCount > 0 &&
    dashboard.approvedCount === dashboard.draftCount
  const currentChargesTotal = dashboard.drafts.reduce(
    (sum, draft) => sum + draft.current_charges,
    0,
  )
  const previousBalancesTotal = dashboard.drafts.reduce(
    (sum, draft) => sum + draft.previous_balance,
    0,
  )
  const totalPayable = dashboard.drafts.reduce(
    (sum, draft) => sum + draft.total_payable,
    0,
  )
  const approvalPercent = dashboard.draftCount > 0
    ? Math.round((dashboard.approvedCount / dashboard.draftCount) * 100)
    : 0

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

      if (result.errors.length > 0) {
        console.error('[BillingPage] backend draft generation errors', {
          billingCycleId: cycle.id,
          fatalErrors: result.fatal_errors,
          errors: result.errors,
          fullResult: result,
        })

        result.errors.forEach((generationIssue, index) => {
          console.error(
            `[BillingPage] generation error ${index + 1}`,
            generationIssue,
          )
        })
      }

      if (result.missing_readings.length > 0) {
        console.warn('[BillingPage] missing billing readings', {
          billingCycleId: cycle.id,
          missingReadings: result.missing_readings,
        })
      }

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


  async function approveSelectedDraft() {
    if (!selectedDraft || selectedDraft.draft.status === 'approved') return

    try {
      setApprovingDraft(true)
      setError('')
      setSuccess('')

      await approveBillDraft(selectedDraft.draft.id)

      const approvedDraft: BillDraftRow = {
        ...selectedDraft.draft,
        status: 'approved',
      }

      setSelectedDraft(await fetchDraftDetail(approvedDraft))
      await refreshDashboard()
      setSuccess(`${selectedDraft.draft.tenantName}'s invoice draft was approved.`)
    } catch (approvalError) {
      console.error('[BillingPage] draft approval failed', approvalError)
      setError(errorMessage(approvalError, 'Could not approve this invoice draft.'))
    } finally {
      setApprovingDraft(false)
    }
  }

  async function approveAllDrafts() {
    if (!cycle || !draftsExist || allDraftsApproved) return

    try {
      setApprovingAll(true)
      setError('')
      setSuccess('')

      const approvedNow = await approveAllBillDrafts(cycle.id)

      if (selectedDraft && selectedDraft.draft.status !== 'approved') {
        const approvedDraft: BillDraftRow = {
          ...selectedDraft.draft,
          status: 'approved',
        }
        setSelectedDraft(await fetchDraftDetail(approvedDraft))
      }

      await refreshDashboard()
      setSuccess(
        approvedNow > 0
          ? `${approvedNow} invoice draft${approvedNow === 1 ? '' : 's'} approved for ${cycleLabel(cycle)}.`
          : 'All invoice drafts are already approved.',
      )
    } catch (approvalError) {
      console.error('[BillingPage] approve all drafts failed', approvalError)
      setError(errorMessage(approvalError, 'Could not approve all invoice drafts.'))
    } finally {
      setApprovingAll(false)
    }
  }

  function openReadingCorrection(
    chargeDescription: string,
    detail: BillChargeDetail,
  ) {
    if (
      !detail.current_reading_id ||
      detail.current_reading === null ||
      detail.previous_reading === null
    ) {
      return
    }

    setError('')
    setSuccess('')
    setReadingCorrection({ chargeDescription, detail })
    setNewReadingValue(String(detail.current_reading))
  }

  async function saveReadingCorrection() {
    if (!readingCorrection || !selectedDraft || !property || !cycle) return

    const nextValue = Number(newReadingValue)
    const previousValue = readingCorrection.detail.previous_reading

    if (!Number.isFinite(nextValue) || nextValue < 0) {
      setError('Enter a valid meter reading.')
      return
    }

    if (previousValue !== null && nextValue < previousValue) {
      setError(`Current reading cannot be lower than the previous reading of ${previousValue}.`)
      return
    }

    if (!readingCorrection.detail.current_reading_id) {
      setError('This usage charge is missing its current meter reading record.')
      return
    }

    try {
      setSavingReadingCorrection(true)
      setError('')
      setSuccess('')

      await correctMeterReading(
        readingCorrection.detail.current_reading_id,
        nextValue,
      )

      const nextDashboard = await fetchBillingDashboard(property.id, cycle)
      setDashboard(nextDashboard)

      const refreshedDraft = nextDashboard.drafts.find(
        draft => draft.id === selectedDraft.draft.id,
      )

      if (!refreshedDraft) {
        throw new Error('The recalculated draft could not be refetched.')
      }

      setSelectedDraft(await fetchDraftDetail(refreshedDraft))
      setReadingCorrection(null)
      setNewReadingValue('')
      setSuccess(
        `${readingCorrection.chargeDescription} reading updated. The invoice draft was recalculated and refetched.`,
      )
    } catch (correctionError) {
      console.error('[BillingPage] meter reading correction failed', correctionError)
      setError(errorMessage(correctionError, 'Could not correct this meter reading.'))
    } finally {
      setSavingReadingCorrection(false)
    }
  }

  function navigate(target: BillingStep) {
    if (!cycle) return

    if (target === 'invoices' || target === 'send') {
      return
    }

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

                <div className="grid flex-1 grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6 xl:max-w-5xl">
                  {steps.map(item => {
                    const active = item.id === step
                    const completed = item.id === 'review'
                      ? allDraftsApproved
                      : item.number < currentStepNumber
                    const futureStep = item.number > 4
                    const locked = futureStep || (draftsExist && item.number < 4)

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
                    <div className="mt-5 space-y-3">
                      <div className="rounded-xl bg-[#edfdf3] p-4 text-sm text-[#424845]">
                        Last run checked {generationResult.leases_checked} leases and generated {generationResult.drafts_generated} drafts.
                      </div>

                      {generationResult.errors.length > 0 && (
                        <div className="rounded-2xl border border-[#ba1a1a]/25 bg-[#fff4f2] p-4 sm:p-5">
                          <div className="flex items-start gap-3">
                            <span className="material-symbols-outlined mt-0.5 text-[22px] text-[#ba1a1a]">
                              error
                            </span>
                            <div>
                              <h3 className="font-semibold text-[#93000a]">
                                Generation errors
                              </h3>
                              <p className="mt-1 text-sm leading-5 text-[#6f3b36]">
                                Dwellio received the following backend errors while generating tenant drafts. These details are also logged in the browser console.
                              </p>
                            </div>
                          </div>

                          <div className="mt-4 space-y-2">
                            {generationResult.errors.map((generationIssue, index) => (
                              <div
                                key={`${generationIssue.lease_id ?? 'unknown'}-${index}`}
                                className="rounded-xl border border-[#ba1a1a]/15 bg-white p-4"
                              >
                                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                                  <div className="text-sm font-semibold text-[#111e19]">
                                    {generationIssue.unit_name
                                      ? `Unit ${generationIssue.unit_name}`
                                      : `Generation error ${index + 1}`}
                                  </div>
                                  {generationIssue.lease_id && (
                                    <div className="font-mono text-[11px] text-[#737875]">
                                      Lease {generationIssue.lease_id}
                                    </div>
                                  )}
                                </div>
                                <div className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-[#fff4f2] px-3 py-2 font-mono text-xs leading-5 text-[#93000a]">
                                  {generationIssue.error ?? 'The backend returned a generation error without a message.'}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {generationResult.missing_readings.length > 0 && (
                        <div className="rounded-xl border border-[#8b6508]/20 bg-[#fff8df] p-4 text-sm text-[#6d5208]">
                          <div className="font-semibold">Missing reading details</div>
                          <div className="mt-2 space-y-1">
                            {generationResult.missing_readings.map((readingIssue, index) => (
                              <div key={`${readingIssue.meter_id ?? 'missing'}-${index}`}>
                                {readingIssue.unit_name ?? 'Unit'}
                                {readingIssue.service_name ? ` · ${readingIssue.service_name}` : ''}
                                {readingIssue.missing ? ` · ${readingIssue.missing}` : ''}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
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
              <section className="space-y-6">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <div className="mb-1 flex items-center gap-2">
                      <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#1e6a59]">Billing Reconciliation</span>
                      <span className="h-1.5 w-1.5 rounded-full bg-[#1e6a59]" />
                      <span className="text-[11px] font-semibold text-[#737875]">Step 4 of 6</span>
                    </div>
                    <h2 className="font-[Newsreader] text-3xl font-medium tracking-tight text-[#111e19]">Invoice drafts</h2>
                    <p className="mt-1 max-w-3xl text-sm leading-6 text-[#424845]">Review each tenant&apos;s current charges and carried-forward balance before invoices are finalized and issued.</p>
                  </div>

                  <button
                    type="button"
                    onClick={() => void approveAllDrafts()}
                    disabled={approvingAll || allDraftsApproved || dashboard.draftCount === 0}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#1e6a59] px-5 py-3 text-sm font-bold text-white shadow-[0_10px_28px_rgba(30,106,89,0.32)] ring-1 ring-[#1e6a59]/20 transition hover:-translate-y-0.5 hover:bg-[#175748] hover:shadow-[0_14px_34px_rgba(30,106,89,0.38)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
                  >
                    <span className="material-symbols-outlined text-[19px] text-white">{approvingAll ? 'progress_activity' : 'done_all'}</span>
                    {allDraftsApproved ? 'All drafts approved' : approvingAll ? 'Approving drafts…' : 'Approve all drafts at once'}
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-2xl bg-white p-5 shadow-[0_10px_28px_rgba(16,33,28,0.05)]">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#737875]">Total drafts</span>
                      <span className="material-symbols-outlined flex h-9 w-9 items-center justify-center rounded-xl bg-[#e7f7ee] text-[19px] text-[#1e6a59]">receipt_long</span>
                    </div>
                    <div className="mt-4 text-3xl font-bold tracking-tight text-[#111e19]">{dashboard.draftCount}</div>
                    <div className="mt-1 text-xs text-[#737875]">Tenant ledgers generated for this cycle</div>
                  </div>

                  <div className="rounded-2xl bg-white p-5 shadow-[0_10px_28px_rgba(16,33,28,0.05)]">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#737875]">Current charges</span>
                      <span className="material-symbols-outlined flex h-9 w-9 items-center justify-center rounded-xl bg-[#e7f7ee] text-[19px] text-[#1e6a59]">payments</span>
                    </div>
                    <div className="mt-4 text-2xl font-bold tracking-tight text-[#111e19]">{money(currentChargesTotal)}</div>
                    <div className="mt-1 text-xs text-[#1e6a59]">Rent + fixed + usage charges</div>
                  </div>

                  <div className="rounded-2xl bg-white p-5 shadow-[0_10px_28px_rgba(16,33,28,0.05)]">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#737875]">Carried arrears</span>
                      <span className="material-symbols-outlined flex h-9 w-9 items-center justify-center rounded-xl bg-[#fff8df] text-[19px] text-[#8b6508]">history</span>
                    </div>
                    <div className="mt-4 text-2xl font-bold tracking-tight text-[#111e19]">{money(previousBalancesTotal)}</div>
                    <div className="mt-1 text-xs text-[#737875]">Previous unpaid balances preserved</div>
                  </div>

                  <div className="relative overflow-hidden rounded-2xl bg-[#10211c] p-5 text-white shadow-[0_14px_36px_rgba(16,33,28,0.14)]">
                    <div className="absolute -bottom-8 -right-8 h-28 w-28 rounded-full bg-[#1e6a59]/30 blur-2xl" />
                    <div className="relative flex items-center justify-between">
                      <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#b7cbc3]">Total payable</span>
                      <span className="material-symbols-outlined flex h-9 w-9 items-center justify-center rounded-xl bg-[#00231b] text-[19px] text-[#a8f1da]">account_balance</span>
                    </div>
                    <div className="relative mt-4 text-2xl font-bold tracking-tight">{money(totalPayable)}</div>
                    <div className="relative mt-1 text-xs text-[#8dd4bf]">Gross receivable if finalized</div>
                  </div>
                </div>

                <div className="rounded-2xl bg-white p-5 shadow-sm">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                      <span className={`material-symbols-outlined flex h-10 w-10 items-center justify-center rounded-full ${allDraftsApproved ? 'bg-[#a8f1db]/55 text-[#005142]' : 'bg-[#fff8df] text-[#8b6508]'}`}>{allDraftsApproved ? 'verified' : 'rule'}</span>
                      <div>
                        <div className="font-semibold text-[#111e19]">{dashboard.approvedCount} / {dashboard.draftCount} drafts approved</div>
                        <div className="mt-0.5 text-xs text-[#737875]">{allDraftsApproved ? 'Review is complete. These drafts are ready for finalization.' : 'Approve individually or approve the whole billing cycle at once.'}</div>
                      </div>
                    </div>
                    <div className="w-full sm:w-72">
                      <div className="mb-1.5 flex justify-between text-[11px] font-semibold text-[#737875]"><span>Approval completion</span><span>{approvalPercent}%</span></div>
                      <div className="h-2.5 overflow-hidden rounded-full bg-[#e2f2e8]"><div className="h-full rounded-full bg-[#1e6a59] transition-all duration-500" style={{ width: `${approvalPercent}%` }} /></div>
                    </div>
                  </div>
                </div>

                <div className="overflow-hidden rounded-2xl bg-white shadow-[0_10px_28px_rgba(16,33,28,0.05)]">
                  <div className="flex flex-col gap-2 bg-[#e7f7ee]/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2"><span className="font-semibold text-[#111e19]">Tenant draft ledgers</span><span className="rounded-full bg-[#dcece2] px-2 py-0.5 text-xs font-semibold text-[#424845]">{dashboard.draftCount} drafts</span></div>
                    <div className="flex items-center gap-1.5 text-xs text-[#737875]"><span className="material-symbols-outlined text-[16px] text-[#1e6a59]">info</span>Review any draft before approval if you want to inspect its billables.</div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[980px] border-collapse text-left text-sm">
                      <thead className="bg-[#edfdf3]/60 text-[11px] uppercase tracking-[0.08em] text-[#424845]">
                        <tr><th className="px-5 py-3">Tenant</th><th className="px-4 py-3">Unit</th><th className="px-4 py-3">Context</th><th className="px-4 py-3 text-right">Current charges</th><th className="px-4 py-3 text-right">Carried arrears</th><th className="px-4 py-3 text-right">Total payable</th><th className="px-4 py-3 text-center">Status</th><th className="px-5 py-3 text-right">Action</th></tr>
                      </thead>
                      <tbody className="divide-y divide-[#c2c8c4]/25">
                        {dashboard.drafts.map(draft => (
                          <tr key={draft.id} className="transition hover:bg-[#edfdf3]/55">
                            <td className="px-5 py-4 font-semibold text-[#111e19]">{draft.tenantName}</td>
                            <td className="px-4 py-4 font-semibold text-[#1e6a59]">{draft.unitName}</td>
                            <td className="px-4 py-4"><span className="rounded-full bg-[#e2f2e8] px-2.5 py-1 text-xs font-semibold text-[#424845]">{displayContext(draft.billing_context)}</span></td>
                            <td className="px-4 py-4 text-right font-mono font-semibold text-[#111e19]">{money(draft.current_charges)}</td>
                            <td className="px-4 py-4 text-right font-mono font-semibold text-[#8b6508]">{money(draft.previous_balance)}</td>
                            <td className="px-4 py-4 text-right font-mono font-bold text-[#111e19]">{money(draft.total_payable)}</td>
                            <td className="px-4 py-4 text-center"><span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${draft.status === 'approved' ? 'bg-[#a8f1db]/50 text-[#005142]' : 'bg-[#fff8df] text-[#6d5208]'}`}>{draft.status === 'approved' && <span className="material-symbols-outlined text-[14px]">check</span>}{draft.status}</span></td>
                            <td className="px-5 py-4 text-right"><button type="button" disabled={openingDraft} onClick={() => void openDraft(draft)} className="inline-flex items-center gap-1 rounded-lg bg-[#e2f2e8] px-3 py-1.5 text-xs font-semibold text-[#1e6a59] transition hover:bg-[#d6e6dd] disabled:opacity-50">Review<span className="material-symbols-outlined text-[14px]">arrow_forward</span></button></td>
                          </tr>
                        ))}
                        {dashboard.drafts.length === 0 && <tr><td colSpan={8} className="px-5 py-12 text-center text-sm text-[#737875]">No invoice drafts exist for this cycle yet.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="flex flex-col gap-3 rounded-2xl border border-[#1e6a59]/15 bg-[#a8f1db]/25 p-5 sm:flex-row sm:items-center sm:justify-between">
                  <div><div className="font-semibold text-[#005142]">{allDraftsApproved ? 'All drafts approved' : 'Finalization is locked'}</div><div className="mt-1 text-sm text-[#26705f]">{allDraftsApproved ? 'The next backend step will finalize these drafts and unlock Step 5: View invoices.' : 'Approve every draft before the billing cycle can be finalized.'}</div></div>
                  <button type="button" disabled className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#10211c] px-5 py-3 text-sm font-semibold text-white opacity-45">Finalize invoices<span className="material-symbols-outlined text-[18px]">arrow_forward</span></button>
                </div>
              </section>
            )}
          </>
        )}
      </div>

      {selectedDraft && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-[#edfdf3]">
          <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <button type="button" onClick={() => setSelectedDraft(null)} className="inline-flex w-fit items-center gap-2 text-sm font-semibold text-[#1e6a59] hover:underline"><span className="material-symbols-outlined text-[18px]">arrow_back</span>Back to invoice drafts</button>
              <button type="button" onClick={() => void approveSelectedDraft()} disabled={approvingDraft || selectedDraft.draft.status === 'approved'} className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#1e6a59] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#175748] disabled:cursor-not-allowed disabled:opacity-50"><span className="material-symbols-outlined text-[18px]">{approvingDraft ? 'progress_activity' : selectedDraft.draft.status === 'approved' ? 'verified' : 'check_circle'}</span>{selectedDraft.draft.status === 'approved' ? 'Approved' : approvingDraft ? 'Approving…' : 'Approve draft'}</button>
            </div>

            <article className="relative overflow-hidden rounded-2xl bg-white p-6 shadow-[0_16px_48px_rgba(16,33,28,0.08)] sm:p-10">
              <div className="absolute right-6 top-7 rotate-6 rounded-lg border-2 border-dashed border-[#737875]/45 px-4 py-2 text-xs font-bold uppercase tracking-[0.18em] text-[#737875]/60">Draft invoice — not finalized</div>

              <div className="flex flex-col gap-5 border-b border-[#c2c8c4]/40 pb-6 sm:flex-row sm:items-start sm:justify-between">
                <div><div className="flex items-center gap-2"><span className="material-symbols-outlined flex h-8 w-8 items-center justify-center rounded-lg bg-[#1e6a59] text-[18px] text-white">apartment</span><span className="font-[Newsreader] text-xl font-semibold tracking-tight text-[#111e19]">{property?.name ?? 'Property'}</span></div><div className="mt-2 text-sm text-[#737875]">{cycle ? `${cycleLabel(cycle)} billing run` : 'Billing run'}</div></div>
                <div className="text-left sm:text-right"><div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#737875]">Draft status</div><span className={`mt-1 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${selectedDraft.draft.status === 'approved' ? 'bg-[#a8f1db]/50 text-[#005142]' : 'bg-[#fff8df] text-[#6d5208]'}`}>{selectedDraft.draft.status}</span></div>
              </div>

              <div className="grid grid-cols-2 gap-4 border-b border-[#c2c8c4]/40 py-6 sm:grid-cols-4">
                <div><div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#737875]">Tenant</div><div className="mt-1 font-semibold text-[#111e19]">{selectedDraft.draft.tenantName}</div></div>
                <div><div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#737875]">Unit</div><div className="mt-1 font-semibold text-[#1e6a59]">{selectedDraft.draft.unitName}</div></div>
                <div><div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#737875]">Billing period</div><div className="mt-1 font-medium text-[#111e19]">{cycle ? cycleLabel(cycle) : 'Current cycle'}</div></div>
                <div><div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#737875]">Context</div><div className="mt-1 font-medium text-[#111e19]">{displayContext(selectedDraft.draft.billing_context)}</div></div>
              </div>

              <div className="py-6">
                <div className="mb-4 flex items-end justify-between gap-4"><div><div className="font-[Newsreader] text-xl font-medium text-[#111e19]">Current charges</div><div className="mt-1 text-xs text-[#737875]">Charges calculated for this billing cycle</div></div><div className="font-mono text-lg font-bold text-[#111e19]">{money(selectedDraft.draft.current_charges)}</div></div>
                <div className="overflow-hidden rounded-xl bg-[#edfdf3]/70"><div className="divide-y divide-[#c2c8c4]/25">{selectedDraft.charges.map(charge => {
                  const correctableDetail = charge.details.find(detail =>
                    detail.current_reading_id !== null &&
                    detail.previous_reading !== null &&
                    detail.current_reading !== null
                  )

                  return (
                    <div key={charge.id} className="grid gap-3 p-4 md:grid-cols-[1.35fr_1.35fr_auto_auto] md:items-center">
                      <div>
                        <div className="font-semibold text-[#111e19]">{charge.description}</div>
                        <div className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-[#737875]">{charge.charge_type}</div>
                      </div>
                      <div className="text-xs leading-5 text-[#424845]">
                        {charge.details.length > 0
                          ? charge.details.map(detail => (
                              <div key={detail.id}>
                                {detail.previous_reading !== null && detail.current_reading !== null
                                  ? `Prev ${detail.previous_reading} → Current ${detail.current_reading} · ${detail.consumption ?? 0} units × ${money(detail.rate ?? 0)}`
                                  : 'No meter detail for this charge.'}
                              </div>
                            ))
                          : 'Fixed charge'}
                      </div>
                      <div className="font-mono font-bold text-[#111e19]">{money(charge.amount)}</div>
                      <div className="md:text-right">
                        {correctableDetail ? (
                          <button
                            type="button"
                            onClick={() => openReadingCorrection(charge.description, correctableDetail)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-[#1e6a59]/10 px-3 py-2 text-xs font-semibold text-[#1e6a59] transition hover:bg-[#1e6a59]/20"
                          >
                            <span className="material-symbols-outlined text-[16px]">edit</span>
                            Correct reading
                          </button>
                        ) : (
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-[#737875]">Fixed</span>
                        )}
                      </div>
                    </div>
                  )
                })}</div></div>
              </div>

              <div className="border-t border-[#c2c8c4]/40 py-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><div className="font-[Newsreader] text-xl font-medium text-[#111e19]">Previous balance / arrears</div><div className="mt-1 text-xs text-[#737875]">Carried forward separately from current-cycle charges</div></div><div className="font-mono text-lg font-bold text-[#8b6508]">{money(selectedDraft.draft.previous_balance)}</div></div>
                {selectedDraft.balanceSources.length > 0 && <div className="mt-4 space-y-2 rounded-xl bg-[#fff8df]/70 p-4"><div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#6d5208]">Balance source</div>{selectedDraft.balanceSources.map(source => (<div key={source.source_invoice_id} className="flex justify-between gap-4 text-sm text-[#424845]"><span>{source.invoiceNumber}</span><span className="font-mono font-semibold text-[#8b6508]">{money(source.amount)}</span></div>))}</div>}
              </div>

              <div className="border-t border-[#c2c8c4]/40 pt-6"><div className="rounded-2xl bg-[#e7f7ee] p-5 sm:flex sm:items-center sm:justify-between"><div className="space-y-1 text-sm text-[#424845]"><div>Current charges: <strong className="text-[#111e19]">{money(selectedDraft.draft.current_charges)}</strong></div><div>Carried arrears: <strong className="text-[#111e19]">{money(selectedDraft.draft.previous_balance)}</strong></div></div><div className="mt-4 sm:mt-0 sm:text-right"><div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#737875]">Total payable</div><div className="mt-1 font-[Newsreader] text-4xl font-medium tracking-tight text-[#111e19]">{money(selectedDraft.draft.total_payable)}</div></div></div></div>
            </article>
          </div>
        </div>
      )}

      {readingCorrection && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#10211c]/45 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#1e6a59]">Utility action</div>
                <h3 className="mt-1 font-[Newsreader] text-2xl font-medium text-[#111e19]">Correct reading</h3>
                <p className="mt-1 text-sm text-[#424845]">{readingCorrection.chargeDescription} · {selectedDraft?.draft.unitName}</p>
              </div>
              <button
                type="button"
                onClick={() => setReadingCorrection(null)}
                disabled={savingReadingCorrection}
                className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#edfdf3] text-[#424845] disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-[#edfdf3] p-4">
                <div className="text-[10px] font-bold uppercase tracking-wide text-[#737875]">Previous reading</div>
                <div className="mt-1 font-mono text-lg font-bold text-[#111e19]">{readingCorrection.detail.previous_reading}</div>
              </div>
              <div className="rounded-xl bg-[#edfdf3] p-4">
                <div className="text-[10px] font-bold uppercase tracking-wide text-[#737875]">Currently saved</div>
                <div className="mt-1 font-mono text-lg font-bold text-[#111e19]">{readingCorrection.detail.current_reading}</div>
              </div>
            </div>

            <label className="mt-5 block">
              <span className="text-xs font-bold uppercase tracking-wide text-[#424845]">New current reading</span>
              <input
                type="number"
                min={readingCorrection.detail.previous_reading ?? 0}
                step="any"
                value={newReadingValue}
                onChange={event => setNewReadingValue(event.target.value)}
                className="mt-2 w-full rounded-xl border border-[#c2c8c4] bg-white px-4 py-3 font-mono text-lg font-semibold text-[#111e19] outline-none focus:border-[#1e6a59] focus:ring-2 focus:ring-[#1e6a59]/15"
              />
            </label>

            {Number.isFinite(Number(newReadingValue)) && readingCorrection.detail.previous_reading !== null && Number(newReadingValue) >= readingCorrection.detail.previous_reading && (
              <div className="mt-4 rounded-xl bg-[#e7f7ee] p-4 text-sm text-[#424845]">
                New consumption: <strong className="text-[#111e19]">{Number(newReadingValue) - readingCorrection.detail.previous_reading}</strong> units
                {readingCorrection.detail.rate !== null && (
                  <span> · Estimated charge: <strong className="text-[#1e6a59]">{money((Number(newReadingValue) - readingCorrection.detail.previous_reading) * readingCorrection.detail.rate)}</strong></span>
                )}
              </div>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setReadingCorrection(null)}
                disabled={savingReadingCorrection}
                className="rounded-lg px-4 py-2.5 text-sm font-semibold text-[#424845] hover:bg-[#edfdf3] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveReadingCorrection()}
                disabled={savingReadingCorrection}
                className="inline-flex items-center gap-2 rounded-lg bg-[#1e6a59] px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#175748] disabled:opacity-60"
              >
                <span className="material-symbols-outlined text-[18px]">{savingReadingCorrection ? 'progress_activity' : 'save'}</span>
                {savingReadingCorrection ? 'Saving & recalculating…' : 'Save correction'}
              </button>
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
