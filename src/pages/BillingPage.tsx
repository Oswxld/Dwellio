import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import {
  approveBillDraft,
  createCurrentBillingCycle,
  fetchBillingCycles,
  fetchBillingDashboard,
  fetchBillingProperties,
  fetchDraftDetail,
  fetchWorkspaceIdentity,
  finalizeBillingCycle,
  generatePropertyBillDrafts,
} from '../features/billing/data/billingRepository'

import type {
  BillDraftRow,
  BillingCycle,
  BillingDashboardData,
  BillingIssue,
  BillingProperty,
  DraftDetail,
  GenerateDraftsResult,
  WorkspaceIdentity,
} from '../features/billing/data/types'


function money(
  amount: number,
) {
  return new Intl
    .NumberFormat(
      'en-KE',
      {
        style: 'currency',
        currency: 'KES',
        maximumFractionDigits: 0,
      },
    )
    .format(amount)
}


function cycleLabel(
  cycle: BillingCycle,
) {
  const date =
    new Date(
      `${cycle.period_start}T00:00:00`,
    )

  return date
    .toLocaleDateString(
      'en-KE',
      {
        month: 'long',
        year: 'numeric',
      },
    )
}


function initials(
  name: string,
) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(
      part => part[0],
    )
    .join('')
    .toUpperCase()
}


function displayContext(
  context: string,
) {
  switch (context) {
    case 'move_in':
      return 'Move-in'

    case 'move_out':
      return 'Move-out'

    case 'renewal':
      return 'Renewal'

    default:
      return 'Normal'
  }
}


function issueActionLabel(
  issue: BillingIssue,
) {
  switch (issue.action) {
    case 'reading':
      return 'Enter reading'

    case 'meter':
      return 'Configure meter'

    case 'service':
      return 'Review service'

    default:
      return 'Review'
  }
}


const emptyDashboard:
BillingDashboardData = {
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


export default function BillingPage() {

  const [
    properties,
    setProperties,
  ] =
    useState<BillingProperty[]>(
      [],
    )


  const [
    propertyId,
    setPropertyId,
  ] =
    useState('')


  const [
    cycles,
    setCycles,
  ] =
    useState<BillingCycle[]>(
      [],
    )


  const [
    cycleId,
    setCycleId,
  ] =
    useState('')


  const [
    identity,
    setIdentity,
  ] =
    useState<WorkspaceIdentity>({
      organizationName:
        'Your organization',

      role:
        'Landlord',

      firstName:
        'there',
    })


  const [
    dashboard,
    setDashboard,
  ] =
    useState<BillingDashboardData>(
      emptyDashboard,
    )


  const [
    generationResult,
    setGenerationResult,
  ] =
    useState<
      GenerateDraftsResult |
      null
    >(null)


  const [
    selectedDraft,
    setSelectedDraft,
  ] =
    useState<DraftDetail | null>(
      null,
    )


  const [
    search,
    setSearch,
  ] =
    useState('')


  const [
    filter,
    setFilter,
  ] =
    useState<
      | 'all'
      | 'review'
      | 'approved'
      | 'move_in'
      | 'move_out'
    >('all')


  const [
    loading,
    setLoading,
  ] =
    useState(true)


  const [
    generating,
    setGenerating,
  ] =
    useState(false)


  const [
    creatingCycle,
    setCreatingCycle,
  ] =
    useState(false)


  const [
    openingDraft,
    setOpeningDraft,
  ] =
    useState(false)


  const [
    approving,
    setApproving,
  ] =
    useState(false)


  const [
    finalizing,
    setFinalizing,
  ] =
    useState(false)


  const [
    error,
    setError,
  ] =
    useState('')


  const [
    success,
    setSuccess,
  ] =
    useState('')


  const draftsSectionRef =
    useRef<HTMLElement | null>(
      null,
    )


  const property =
    useMemo(
      () =>
        properties.find(
          item =>
            item.id ===
            propertyId,
        )
        ??
        null,

      [
        properties,
        propertyId,
      ],
    )


  const cycle =
    useMemo(
      () =>
        cycles.find(
          item =>
            item.id ===
            cycleId,
        )
        ??
        null,

      [
        cycles,
        cycleId,
      ],
    )



  // ==========================================================
  // INITIAL PROPERTY LOAD
  // ==========================================================

  useEffect(() => {

    async function load() {

      try {

        setLoading(true)

        setError('')


        const propertyRows =
          await fetchBillingProperties()


        setProperties(
          propertyRows,
        )


        if (
          propertyRows.length > 0
        ) {
          setPropertyId(
            propertyRows[0].id,
          )
        }

      } catch (err) {

        setError(
          err instanceof Error
            ? err.message
            : 'Could not load billing properties.',
        )

      } finally {

        setLoading(false)

      }

    }


    void load()

  }, [])



  // ==========================================================
  // PROPERTY CHANGED
  // ==========================================================

  useEffect(() => {

    if (!property) {
      return
    }


    async function loadProperty() {

      try {

        setLoading(true)

        setError('')

        setGenerationResult(
          null,
        )


        const [
          cycleRows,
          workspace,
        ] =
          await Promise.all([

            fetchBillingCycles(
              property!.id,
            ),

            fetchWorkspaceIdentity(
              property!,
            ),

          ])


        setCycles(
          cycleRows,
        )


        setIdentity(
          workspace,
        )


        if (
          cycleRows.length > 0
        ) {

          const currentMonth =
            new Date()
              .toISOString()
              .slice(
                0,
                7,
              )


          const current =
            cycleRows.find(
              item =>
                item.period_start
                  .startsWith(
                    currentMonth,
                  ),
            )


          setCycleId(
            (
              current
              ??
              cycleRows[0]
            ).id,
          )

        } else {

          setCycleId('')

          setDashboard(
            emptyDashboard,
          )

        }

      } catch (err) {

        setError(
          err instanceof Error
            ? err.message
            : 'Could not load property billing.',
        )

      } finally {

        setLoading(false)

      }

    }


    void loadProperty()

  }, [property])



  // ==========================================================
  // CYCLE CHANGED
  // ==========================================================

  useEffect(() => {

    if (
      !property ||
      !cycle
    ) {
      return
    }


    void refreshDashboard()

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    property?.id,
    cycle?.id,
  ])



  async function refreshDashboard() {

    if (
      !property ||
      !cycle
    ) {
      return
    }


    try {

      setLoading(true)

      setError('')


      const result =
        await fetchBillingDashboard(
          property.id,
          cycle,
        )


      setDashboard(
        result,
      )


      if (
        selectedDraft
      ) {

        const refreshed =
          result.drafts.find(
            draft =>
              draft.id ===
              selectedDraft
                .draft.id,
          )


        if (refreshed) {

          const details =
            await fetchDraftDetail(
              refreshed,
            )


          setSelectedDraft(
            details,
          )

        } else {

          setSelectedDraft(
            null,
          )

        }
      }

    } catch (err) {

      setError(
        err instanceof Error
          ? err.message
          : 'Could not load the billing cycle.',
      )

    } finally {

      setLoading(false)

    }
  }



  // ==========================================================
  // CREATE CURRENT CYCLE
  // ==========================================================

  async function createCycle() {

    if (!property) {
      return
    }


    try {

      setCreatingCycle(
        true,
      )

      setError('')
      setSuccess('')


      const newCycleId =
        await createCurrentBillingCycle(
          property.id,
        )


      const cycleRows =
        await fetchBillingCycles(
          property.id,
        )


      setCycles(
        cycleRows,
      )


      setCycleId(
        newCycleId,
      )


      setSuccess(
        'Billing cycle created.',
      )

    } catch (err) {

      setError(
        err instanceof Error
          ? err.message
          : 'Could not create billing cycle.',
      )

    } finally {

      setCreatingCycle(
        false,
      )

    }
  }



  // ==========================================================
  // GENERATE DRAFTS
  // ==========================================================

  async function generateDrafts() {

    if (!cycle) {
      return
    }


    try {

      setGenerating(true)

      setError('')
      setSuccess('')


      const result =
        await generatePropertyBillDrafts(
          cycle.id,
        )


      setGenerationResult(
        result,
      )


      await refreshDashboard()


      setSuccess(
        result.drafts_generated > 0
          ? `${result.drafts_generated} bill draft${result.drafts_generated === 1 ? '' : 's'} generated.`
          : 'Billing check complete. No duplicate drafts were created.',
      )

    } catch (err) {

      setError(
        err instanceof Error
          ? err.message
          : 'Draft generation failed.',
      )

    } finally {

      setGenerating(
        false,
      )

    }
  }



  // ==========================================================
  // DRAFT REVIEW
  // ==========================================================

  async function openDraft(
    draft: BillDraftRow,
  ) {

    try {

      setOpeningDraft(true)

      setError('')


      const detail =
        await fetchDraftDetail(
          draft,
        )


      setSelectedDraft(
        detail,
      )

    } catch (err) {

      setError(
        err instanceof Error
          ? err.message
          : 'Could not load bill draft.',
      )

    } finally {

      setOpeningDraft(false)

    }
  }



  async function approveDraft() {

    if (!selectedDraft) {
      return
    }


    try {

      setApproving(true)

      setError('')
      setSuccess('')


      await approveBillDraft(
        selectedDraft.draft.id,
      )


      setSuccess(
        'Bill draft approved.',
      )


      await refreshDashboard()

    } catch (err) {

      setError(
        err instanceof Error
          ? err.message
          : 'Could not approve this bill draft.',
      )

    } finally {

      setApproving(false)

    }
  }



  // ==========================================================
  // FINALIZE
  // ==========================================================

  async function finalizeCycle() {

    if (!cycle) {
      return
    }


    const confirmed =
      window.confirm(
        `Finalize ${dashboard.draftCount} invoices?\n\nThese drafts will become official invoices. Corrections after this should use adjustment or void/replacement workflows.`,
      )


    if (!confirmed) {
      return
    }


    try {

      setFinalizing(true)

      setError('')
      setSuccess('')


      const result =
        await finalizeBillingCycle(
          cycle.id,
        )


      setSuccess(
        `${result?.invoices_created ?? 0} invoices finalized successfully.`,
      )


      const refreshedCycles =
        await fetchBillingCycles(
          cycle.property_id,
        )


      setCycles(
        refreshedCycles,
      )


      await refreshDashboard()

    } catch (err) {

      setError(
        err instanceof Error
          ? err.message
          : 'Could not finalize invoices.',
      )

    } finally {

      setFinalizing(false)

    }
  }



  // ==========================================================
  // ISSUES
  // ==========================================================

  const generationIssues =
    useMemo<
      BillingIssue[]
    >(
      () => {

        if (!generationResult) {
          return []
        }


        const missing:
          BillingIssue[] =
          generationResult
            .missing_readings
            .map(
              (
                item,
                index,
              ) => {

                const reading =
                  item.missing ===
                    'opening_reading'
                    ? 'opening'
                    : item.missing ===
                        'closing_reading'
                      ? 'closing'
                      : item.missing


                return {
                  id:
                    `generation-missing-${index}`,

                  type:
                    item.missing ===
                      'meter'
                      ? 'missing_meter'
                      : 'missing_reading',

                  unitId:
                    item.unit_id,

                  unitName:
                    item.unit_name,

                  serviceId:
                    item.service_id,

                  serviceName:
                    item.service_name,

                  title:
                    item.missing ===
                      'meter'
                      ? `${item.service_name ?? 'Utility'} meter not configured`
                      : `${item.service_name ?? 'Utility'} ${reading ?? ''} reading missing`,

                  description:
                    item.expected_on_or_before
                      ? `Reading expected on or before ${item.expected_on_or_before}.`
                      : undefined,

                  action:
                    item.missing ===
                      'meter'
                      ? 'meter'
                      : 'reading',
                }
              },
            )


        const errors:
          BillingIssue[] =
          generationResult
            .errors
            .map(
              (
                item,
                index,
              ) => ({
                id:
                  `generation-error-${index}`,

                type:
                  'generation_error',

                unitId:
                  item.unit_id,

                unitName:
                  item.unit_name,

                title:
                  'Draft generation error',

                description:
                  item.error
                  ??
                  'The draft could not be generated.',

                action:
                  'none',
              }),
            )


        return [
          ...missing,
          ...errors,
        ]

      },
      [
        generationResult,
      ],
    )


  const issues =
    useMemo(
      () => {

        const map =
          new Map<
            string,
            BillingIssue
          >()


        for (
          const issue
          of [
            ...dashboard
              .configurationIssues,

            ...generationIssues,
          ]
        ) {
          map.set(
            issue.id,
            issue,
          )
        }


        return [
          ...map.values(),
        ]

      },
      [
        dashboard
          .configurationIssues,
        generationIssues,
      ],
    )



  // ==========================================================
  // FILTERED DRAFTS
  // ==========================================================

  const filteredDrafts =
    useMemo(
      () => {

        const query =
          search
            .trim()
            .toLowerCase()


        return dashboard
          .drafts
          .filter(
            draft => {

              if (
                query &&
                !(
                  draft.tenantName
                    .toLowerCase()
                    .includes(query)
                  ||
                  draft.unitName
                    .toLowerCase()
                    .includes(query)
                )
              ) {
                return false
              }


              switch (filter) {

                case 'review':
                  return (
                    draft.status ===
                    'draft'
                    ||
                    draft.status ===
                    'reviewed'
                  )


                case 'approved':
                  return (
                    draft.status ===
                    'approved'
                  )


                case 'move_in':
                  return (
                    draft.billing_context ===
                    'move_in'
                  )


                case 'move_out':
                  return (
                    draft.billing_context ===
                    'move_out'
                  )


                default:
                  return true
              }
            },
          )

      },
      [
        dashboard.drafts,
        search,
        filter,
      ],
    )



  const remainingDrafts =
    Math.max(
      0,
      dashboard.leaseCount
      -
      dashboard.draftCount,
    )


  const allDraftsExist =
    dashboard.leaseCount > 0
    &&
    dashboard.draftCount ===
      dashboard.leaseCount


  const allApproved =
    dashboard.draftCount > 0
    &&
    dashboard.approvedCount ===
      dashboard.draftCount


  const finalized =
    cycle?.status ===
      'invoiced'
    ||
    cycle?.status ===
      'sent'
    ||
    cycle?.status ===
      'closed'


  const canFinalize =
    allDraftsExist
    &&
    allApproved
    &&
    !finalized


  const affectedUnits =
    new Set(
      issues
        .map(
          issue =>
            issue.unitId,
        )
        .filter(Boolean),
    ).size


  const readyCount =
    Math.max(
      dashboard.draftCount,
      dashboard.leaseCount
      -
      affectedUnits,
    )



  function scrollToDrafts() {

    draftsSectionRef.current
      ?.scrollIntoView({
        behavior:
          'smooth',
      })
  }



  function handleIssue(
    issue: BillingIssue,
  ) {

    if (!property) {
      return
    }


    if (
      issue.action ===
      'reading'
    ) {

      window.location.href =
        `/billing/readings?property=${property.id}&cycle=${cycle?.id ?? ''}&unit=${issue.unitId ?? ''}&service=${issue.serviceId ?? ''}`

      return
    }


    if (
      issue.action ===
      'meter'
    ) {

      window.location.href =
        `/properties/${property.id}/billing-services/${issue.serviceId ?? ''}?tab=meters&unit=${issue.unitId ?? ''}`

      return
    }


    if (
      issue.action ===
      'service'
    ) {

      window.location.href =
        `/properties/${property.id}/billing-services/${issue.serviceId ?? ''}?tab=rates`

    }
  }



  if (
    loading &&
    properties.length === 0
  ) {

    return (
      <div className="min-h-screen bg-[#edfdf3] grid place-items-center">
        <div className="w-8 h-8 rounded-full border-[3px] border-[#dcece2] border-t-[#1e6a59] animate-spin" />
      </div>
    )
  }



  return (
    <div
      className="
        min-h-screen
        bg-[#edfdf3]
        font-['Manrope']
        text-[#111e19]
      "
    >

      <DwellioSidebar
        organizationName={
          identity.organizationName
        }
        firstName={
          identity.firstName
        }
        role={
          identity.role
        }
      />


      <div className="lg:pl-[260px]">

        {/* TOPBAR */}

        <header
          className="
            sticky
            top-0
            z-40
            h-16
            bg-white/90
            backdrop-blur-xl
            shadow-[0_1px_8px_rgba(0,0,0,.04)]
            px-4
            sm:px-6
            lg:px-8
            flex
            items-center
            justify-between
          "
        >

          <div className="hidden sm:flex relative w-full max-w-md items-center">

            <span
              className="
                material-symbols-outlined
                absolute
                left-3
                text-[#737875]
                text-[20px]
              "
            >
              search
            </span>

            <input
              value={search}
              onChange={
                event =>
                  setSearch(
                    event.target.value,
                  )
              }
              className="
                w-full
                h-10
                pl-10
                pr-3
                bg-[#e7f7ee]
                rounded-lg
                text-sm
                placeholder:text-[#737875]
                outline-none
                focus:bg-white
              "
              placeholder="Search tenants or units..."
            />

          </div>


          <div className="sm:hidden font-bold text-lg">
            dwellio
            <span className="text-[#1e6a59]">
              .
            </span>
          </div>


          <div className="flex items-center gap-3">

            <button
              type="button"
              className="
                relative
                p-2
                rounded-lg
                text-[#424845]
                hover:bg-[#e7f7ee]
              "
            >
              <span className="material-symbols-outlined text-[22px]">
                notifications
              </span>

              <span
                className="
                  absolute
                  top-1.5
                  right-1.5
                  w-2
                  h-2
                  rounded-full
                  bg-[#ba1a1a]
                "
              />
            </button>


            <div
              className="
                w-8
                h-8
                rounded-full
                bg-[#000504]
                text-white
                flex
                items-center
                justify-center
                text-xs
                font-bold
              "
            >
              {identity.firstName[0]
                ?.toUpperCase()}
            </div>

          </div>

        </header>



        <main
          className="
            px-4
            sm:px-6
            lg:px-10
            py-6
            flex
            flex-col
            gap-6
          "
        >

          {/* HEADER */}

          <header
            className="
              flex
              flex-col
              xl:flex-row
              xl:items-end
              justify-between
              gap-5
            "
          >

            <div className="max-w-2xl">

              <span
                className="
                  text-[11px]
                  tracking-[.14em]
                  text-[#1e6a59]
                  font-semibold
                  uppercase
                "
              >
                Billing
              </span>


              <h1
                className="
                  font-['Newsreader']
                  text-3xl
                  lg:text-4xl
                  mt-1
                  tracking-tight
                "
              >
                Monthly billing
              </h1>


              <p
                className="
                  text-sm
                  text-[#424845]
                  mt-1
                "
              >
                Prepare meter readings,
                generate tenant bills,
                review charges and issue
                invoices.
              </p>

            </div>


            <div
              className="
                flex
                flex-wrap
                items-center
                gap-3
              "
            >

              <div
                className="
                  bg-white
                  px-3
                  py-2
                  rounded-lg
                  shadow-[0_2px_6px_rgba(22,42,35,.04)]
                "
              >
                <div className="text-[10px] text-[#737875]">
                  Property
                </div>

                <select
                  value={propertyId}
                  onChange={
                    event =>
                      setPropertyId(
                        event.target.value,
                      )
                  }
                  className="
                    bg-transparent
                    font-semibold
                    text-sm
                    outline-none
                  "
                >
                  {properties.map(
                    item => (
                      <option
                        key={item.id}
                        value={item.id}
                      >
                        {item.name}
                      </option>
                    ),
                  )}
                </select>
              </div>


              <div
                className="
                  bg-white
                  px-3
                  py-2
                  rounded-lg
                  shadow-[0_2px_6px_rgba(22,42,35,.04)]
                "
              >
                <div className="text-[10px] text-[#737875]">
                  Cycle
                </div>

                {cycles.length > 0
                  ? (
                    <select
                      value={cycleId}
                      onChange={
                        event =>
                          setCycleId(
                            event.target.value,
                          )
                      }
                      className="
                        bg-transparent
                        font-semibold
                        text-sm
                        outline-none
                      "
                    >
                      {cycles.map(
                        item => (
                          <option
                            key={item.id}
                            value={item.id}
                          >
                            {cycleLabel(
                              item,
                            )}
                          </option>
                        ),
                      )}
                    </select>
                  )
                  : (
                    <button
                      type="button"
                      disabled={
                        creatingCycle
                      }
                      onClick={
                        () =>
                          void createCycle()
                      }
                      className="
                        text-sm
                        font-semibold
                        text-[#1e6a59]
                      "
                    >
                      {creatingCycle
                        ? 'Creating…'
                        : 'Create current cycle'}
                    </button>
                  )}
              </div>


              {cycle && (
                <div
                  className="
                    flex
                    items-center
                    gap-2
                    px-3
                    py-2
                    rounded-full
                    bg-[#a8f1db]/40
                    text-[#26705f]
                  "
                >
                  <span
                    className="
                      w-2
                      h-2
                      rounded-full
                      bg-[#1e6a59]
                    "
                  />

                  <span
                    className="
                      text-[11px]
                      font-semibold
                      uppercase
                    "
                  >
                    {cycle.status
                      .replaceAll(
                        '_',
                        ' ',
                      )}
                  </span>
                </div>
              )}

            </div>

          </header>



          {error && (
            <div
              className="
                rounded-xl
                bg-[#ffdad6]
                text-[#93000a]
                px-4
                py-3
                text-sm
              "
            >
              {error}
            </div>
          )}


          {success && (
            <div
              className="
                rounded-xl
                bg-[#a8f1db]/40
                text-[#005142]
                px-4
                py-3
                text-sm
              "
            >
              {success}
            </div>
          )}



          {!cycle ? (

            <section
              className="
                bg-white
                rounded-xl
                shadow-[0_14px_40px_rgba(22,42,35,.06)]
                p-10
                text-center
              "
            >
              <div
                className="
                  w-12
                  h-12
                  mx-auto
                  rounded-xl
                  bg-[#e2f2e8]
                  text-[#1e6a59]
                  flex
                  items-center
                  justify-center
                "
              >
                <span className="material-symbols-outlined">
                  calendar_month
                </span>
              </div>

              <h2
                className="
                  mt-4
                  text-lg
                  font-semibold
                "
              >
                No billing cycle yet
              </h2>

              <p
                className="
                  mt-1
                  text-sm
                  text-[#424845]
                "
              >
                Create this month's billing
                cycle before recording and
                generating bills.
              </p>

              <button
                type="button"
                onClick={
                  () =>
                    void createCycle()
                }
                disabled={
                  creatingCycle
                }
                className="
                  mt-5
                  h-10
                  px-5
                  rounded-lg
                  bg-[#10211c]
                  text-white
                  font-semibold
                  text-sm
                "
              >
                {creatingCycle
                  ? 'Creating…'
                  : 'Create billing cycle'}
              </button>
            </section>

          ) : (
            <>

              {/* WORKFLOW */}

              <WorkflowRail
                dashboard={
                  dashboard
                }
                cycle={
                  cycle
                }
                issueCount={
                  issues.length
                }
              />


              {/* METRICS */}

              <section
                className="
                  grid
                  grid-cols-1
                  sm:grid-cols-2
                  xl:grid-cols-4
                  gap-4
                "
              >

                <MetricCard
                  label="Leases"
                  value={
                    dashboard.leaseCount
                      .toString()
                  }
                  subtitle="Current billable leases"
                  icon="real_estate_agent"
                />


                <MetricCard
                  label="Ready"
                  value={
                    readyCount
                      .toString()
                  }
                  subtitle="Ready for draft generation"
                  icon="verified"
                  accent
                />


                <MetricCard
                  label="Needs attention"
                  value={
                    issues.length
                      .toString()
                  }
                  subtitle="Missing readings or setup"
                  icon="error"
                  danger
                />


                <MetricCard
                  label="Drafts"
                  value={
                    `${dashboard.draftCount} / ${dashboard.leaseCount}`
                  }
                  subtitle="Generated this cycle"
                  icon="receipt"
                />

              </section>



              {/* READINESS + CYCLE */}

              <div
                className="
                  grid
                  grid-cols-1
                  xl:grid-cols-12
                  gap-6
                  items-start
                "
              >

                <div
                  className="
                    xl:col-span-8
                    flex
                    flex-col
                    gap-6
                  "
                >

                  {/* SERVICES */}

                  <section
                    className="
                      bg-white
                      rounded-xl
                      p-6
                      shadow-[0_14px_40px_rgba(22,42,35,.06)]
                    "
                  >

                    <div className="mb-4">

                      <h2
                        className="
                          font-['Newsreader']
                          text-xl
                        "
                      >
                        Billing readiness
                      </h2>

                      <p
                        className="
                          text-xs
                          text-[#424845]
                          mt-1
                        "
                      >
                        Dwellio checks every
                        lease, billing service,
                        meter and reading before
                        generating drafts.
                      </p>

                    </div>


                    <div className="space-y-2">

                      {dashboard.services
                        .map(
                          service => {

                            const usage =
                              service
                                .billingMethod ===
                              'usage'


                            const complete =
                              !usage
                              ||
                              service.meterCount >=
                              service.targetCount


                            return (
                              <div
                                key={
                                  service.id
                                }
                                className="
                                  p-4
                                  rounded-lg
                                  bg-[#e7f7ee]
                                  flex
                                  flex-col
                                  sm:flex-row
                                  sm:items-center
                                  justify-between
                                  gap-3
                                "
                              >

                                <div
                                  className="
                                    flex
                                    items-center
                                    gap-3
                                  "
                                >

                                  <div
                                    className="
                                      w-9
                                      h-9
                                      rounded-lg
                                      bg-white
                                      text-[#1e6a59]
                                      flex
                                      items-center
                                      justify-center
                                      shadow-sm
                                    "
                                  >
                                    <span className="material-symbols-outlined text-[20px]">
                                      {usage
                                        ? 'water_drop'
                                        : 'payments'}
                                    </span>
                                  </div>


                                  <div>

                                    <div
                                      className="
                                        flex
                                        items-center
                                        flex-wrap
                                        gap-2
                                      "
                                    >
                                      <strong className="text-sm">
                                        {service.name}
                                      </strong>

                                      <span
                                        className="
                                          text-[10px]
                                          bg-[#e2f2e8]
                                          px-2
                                          py-1
                                          rounded
                                          text-[#424845]
                                        "
                                      >
                                        {usage
                                          ? 'Usage-based'
                                          : 'Fixed'}
                                        {' · '}
                                        {service.applicability}
                                      </span>
                                    </div>


                                    <div
                                      className="
                                        text-xs
                                        text-[#424845]
                                        mt-1
                                      "
                                    >
                                      {usage
                                        ? `${service.meterCount} / ${service.targetCount} meters configured`
                                        : service.applicability === 'optional'
                                          ? `${service.subscriberCount} subscribers`
                                          : `${service.targetCount} tenants`}

                                      {service.currentRate !== null && (
                                        <>
                                          {' · Rate: '}
                                          <strong>
                                            {money(
                                              service.currentRate,
                                            )}
                                          </strong>
                                        </>
                                      )}
                                    </div>

                                  </div>

                                </div>


                                <span
                                  className={`
                                    text-[11px]
                                    font-semibold
                                    px-3
                                    py-1
                                    rounded-full

                                    ${
                                      complete
                                        ? 'bg-[#a8f1db]/40 text-[#26705f]'
                                        : 'bg-[#ffdad6] text-[#93000a]'
                                    }
                                  `}
                                >
                                  {complete
                                    ? 'Configured'
                                    : `${service.targetCount - service.meterCount} missing`}
                                </span>

                              </div>
                            )
                          },
                        )}


                      {dashboard.services
                        .length === 0 && (
                        <EmptyRow
                          title="No billing services configured"
                          body="Configure billing services for this property before generating bills."
                        />
                      )}

                    </div>

                  </section>



                  {/* ATTENTION */}

                  <section
                    className="
                      bg-white
                      rounded-xl
                      p-6
                      shadow-[0_14px_40px_rgba(22,42,35,.06)]
                    "
                  >

                    <div
                      className="
                        flex
                        items-center
                        justify-between
                        gap-3
                      "
                    >

                      <div
                        className="
                          flex
                          items-center
                          gap-2
                        "
                      >
                        <span className="material-symbols-outlined text-[#ba1a1a]">
                          warning
                        </span>

                        <h2
                          className="
                            font-['Newsreader']
                            text-xl
                          "
                        >
                          Actionable issues
                        </h2>
                      </div>


                      <span
                        className="
                          text-[11px]
                          px-2
                          py-1
                          rounded-full
                          bg-[#ffdad6]
                          text-[#93000a]
                          font-semibold
                        "
                      >
                        {issues.length} issues
                      </span>

                    </div>


                    <p
                      className="
                        text-xs
                        text-[#424845]
                        mt-1
                        mb-4
                      "
                    >
                      These issues prevent draft
                      generation for the affected
                      tenants. Ready tenants can
                      still be processed.
                    </p>


                    <div className="space-y-2">

                      {issues
                        .slice(
                          0,
                          8,
                        )
                        .map(
                          issue => (
                            <div
                              key={
                                issue.id
                              }
                              className="
                                p-4
                                rounded-lg
                                bg-[#e7f7ee]
                                flex
                                flex-col
                                sm:flex-row
                                sm:items-center
                                justify-between
                                gap-3
                              "
                            >

                              <div>

                                <div className="flex items-center gap-2">

                                  {issue.unitName && (
                                    <strong className="text-sm">
                                      {issue.unitName}
                                    </strong>
                                  )}

                                  <span
                                    className="
                                      text-xs
                                      text-[#ba1a1a]
                                      font-medium
                                    "
                                  >
                                    {issue.title}
                                  </span>

                                </div>


                                {issue.description && (
                                  <div
                                    className="
                                      text-xs
                                      text-[#424845]
                                      mt-1
                                    "
                                  >
                                    {issue.description}
                                  </div>
                                )}

                              </div>


                              {issue.action !==
                                'none' && (
                                <button
                                  type="button"
                                  onClick={
                                    () =>
                                      handleIssue(
                                        issue,
                                      )
                                  }
                                  className="
                                    self-end
                                    sm:self-auto
                                    px-4
                                    py-2
                                    rounded-lg
                                    bg-[#1e6a59]
                                    text-white
                                    text-xs
                                    font-semibold
                                  "
                                >
                                  {issueActionLabel(
                                    issue,
                                  )}
                                </button>
                              )}

                            </div>
                          ),
                        )}


                      {issues.length === 0 && (
                        <EmptyRow
                          title="No known billing issues"
                          body="Run draft generation to perform the authoritative backend validation for this cycle."
                        />
                      )}

                    </div>

                  </section>

                </div>



                {/* CURRENT CYCLE */}

                <div
                  className="
                    xl:col-span-4
                    flex
                    flex-col
                    gap-6
                  "
                >

                  <section
                    className="
                      bg-white
                      rounded-xl
                      p-6
                      shadow-[0_14px_40px_rgba(22,42,35,.06)]
                    "
                  >

                    <div
                      className="
                        flex
                        items-center
                        justify-between
                        gap-2
                      "
                    >
                      <h2
                        className="
                          font-['Newsreader']
                          text-xl
                        "
                      >
                        {cycleLabel(
                          cycle,
                        )} billing
                      </h2>

                      <span
                        className="
                          bg-[#a8f1db]
                          text-[#005142]
                          px-2
                          py-1
                          rounded-full
                          text-[10px]
                          font-semibold
                        "
                      >
                        {cycle.status
                          .replaceAll(
                            '_',
                            ' ',
                          )}
                      </span>
                    </div>


                    <div className="mt-4 space-y-3">

                      <CycleRow
                        label="Leases checked"
                        value={
                          generationResult
                            ?.leases_checked
                          ??
                          dashboard.leaseCount
                        }
                      />

                      <CycleRow
                        label="Drafts already generated"
                        value={
                          dashboard.draftCount
                        }
                        green
                      />

                      <CycleRow
                        label="Remaining to generate"
                        value={
                          remainingDrafts
                        }
                        red={
                          remainingDrafts >
                          0
                        }
                      />

                      <CycleRow
                        label="Moving out"
                        value={
                          generationResult
                            ?.moving_out
                          ??
                          dashboard.movingOut
                        }
                      />

                      <CycleRow
                        label="Future move-ins"
                        value={
                          generationResult
                            ?.future_move_ins
                          ??
                          dashboard.futureMoveIns
                        }
                      />

                    </div>


                    <div
                      className="
                        mt-5
                        p-4
                        rounded-lg
                        bg-[#e7f7ee]
                        flex
                        gap-3
                      "
                    >
                      <span className="material-symbols-outlined text-[#1e6a59]">
                        shield
                      </span>

                      <p
                        className="
                          text-xs
                          leading-relaxed
                          text-[#424845]
                        "
                      >
                        <strong className="text-[#111e19]">
                          Safe to run again:
                        </strong>
                        {' '}
                        Existing active drafts
                        will not be duplicated.
                        Dwellio only generates
                        drafts for eligible leases
                        without one.
                      </p>
                    </div>


                    <div className="mt-5 space-y-2">

                      <button
                        type="button"
                        disabled={
                          generating ||
                          finalized
                        }
                        onClick={
                          () =>
                            void generateDrafts()
                        }
                        className="
                          w-full
                          h-11
                          rounded-lg
                          bg-[#10211c]
                          text-white
                          font-semibold
                          text-sm
                          disabled:opacity-50
                          flex
                          items-center
                          justify-center
                          gap-2
                        "
                      >
                        <span className="material-symbols-outlined text-[18px]">
                          bolt
                        </span>

                        {generating
                          ? 'Generating drafts…'
                          : remainingDrafts > 0
                            ? `Generate remaining drafts (${remainingDrafts})`
                            : 'Check for remaining drafts'}
                      </button>


                      {dashboard.draftCount >
                        0 && (
                        <button
                          type="button"
                          onClick={
                            scrollToDrafts
                          }
                          className="
                            w-full
                            h-10
                            rounded-lg
                            bg-[#e7f7ee]
                            text-[#111e19]
                            font-semibold
                            text-sm
                          "
                        >
                          Review existing drafts
                        </button>
                      )}

                    </div>

                  </section>



                  {generationResult && (
                    <section
                      className="
                        bg-[#e2f2e8]
                        rounded-xl
                        p-4
                      "
                    >

                      <div
                        className="
                          text-[10px]
                          uppercase
                          tracking-wider
                          text-[#1e6a59]
                          font-bold
                        "
                      >
                        Draft engine log
                      </div>


                      <p
                        className="
                          text-xs
                          leading-relaxed
                          mt-2
                        "
                      >
                        <strong>
                          {
                            generationResult
                              .leases_checked
                          } leases checked
                        </strong>

                        {' · '}

                        {
                          generationResult
                            .drafts_generated
                        } drafts generated

                        {' · '}

                        {
                          generationResult
                            .missing_meter_readings
                        } missing meter issues

                        {' · '}

                        {
                          generationResult
                            .moving_out
                        } moving out

                        {' · '}

                        {
                          generationResult
                            .future_move_ins
                        } future move-ins

                        {' · '}

                        <strong>
                          {
                            generationResult
                              .fatal_errors
                          } processing errors
                        </strong>
                      </p>

                    </section>
                  )}

                </div>

              </div>



              {/* DRAFT TABLE */}

              <section
                ref={draftsSectionRef}
                className="
                  bg-white
                  rounded-xl
                  p-6
                  shadow-[0_14px_40px_rgba(22,42,35,.06)]
                "
              >

                <div
                  className="
                    flex
                    flex-col
                    md:flex-row
                    md:items-center
                    justify-between
                    gap-4
                  "
                >

                  <div>

                    <h2
                      className="
                        font-['Newsreader']
                        text-xl
                      "
                    >
                      Bill drafts
                    </h2>

                    <p
                      className="
                        text-xs
                        text-[#424845]
                        mt-1
                      "
                    >
                      Review calculated charges
                      and previous balances before
                      invoice finalization.
                    </p>

                  </div>


                  <div className="relative w-full md:w-64">

                    <span
                      className="
                        material-symbols-outlined
                        absolute
                        left-3
                        top-2
                        text-[#737875]
                        text-[18px]
                      "
                    >
                      search
                    </span>

                    <input
                      value={search}
                      onChange={
                        event =>
                          setSearch(
                            event.target.value,
                          )
                      }
                      className="
                        w-full
                        h-9
                        pl-9
                        pr-3
                        rounded-lg
                        bg-[#e7f7ee]
                        text-xs
                        outline-none
                      "
                      placeholder="Search tenant or unit..."
                    />

                  </div>

                </div>


                <div
                  className="
                    flex
                    items-center
                    gap-2
                    overflow-x-auto
                    mt-4
                    pb-1
                  "
                >

                  <FilterButton
                    active={
                      filter ===
                      'all'
                    }
                    onClick={
                      () =>
                        setFilter(
                          'all',
                        )
                    }
                  >
                    All ({
                      dashboard.draftCount
                    })
                  </FilterButton>


                  <FilterButton
                    active={
                      filter ===
                      'review'
                    }
                    onClick={
                      () =>
                        setFilter(
                          'review',
                        )
                    }
                  >
                    Needs review ({
                      dashboard.draftCount
                      -
                      dashboard.approvedCount
                    })
                  </FilterButton>


                  <FilterButton
                    active={
                      filter ===
                      'approved'
                    }
                    onClick={
                      () =>
                        setFilter(
                          'approved',
                        )
                    }
                  >
                    Approved ({
                      dashboard.approvedCount
                    })
                  </FilterButton>


                  <FilterButton
                    active={
                      filter ===
                      'move_in'
                    }
                    onClick={
                      () =>
                        setFilter(
                          'move_in',
                        )
                    }
                  >
                    Move-in
                  </FilterButton>


                  <FilterButton
                    active={
                      filter ===
                      'move_out'
                    }
                    onClick={
                      () =>
                        setFilter(
                          'move_out',
                        )
                    }
                  >
                    Move-out
                  </FilterButton>

                </div>



                <div className="overflow-x-auto mt-4">

                  <table className="w-full min-w-[850px] text-left">

                    <thead>

                      <tr
                        className="
                          bg-[#e7f7ee]
                          text-[#424845]
                          text-[10px]
                          uppercase
                          tracking-wider
                        "
                      >

                        <th className="p-3 rounded-l-lg">
                          Tenant
                        </th>

                        <th className="p-3">
                          Unit
                        </th>

                        <th className="p-3">
                          Context
                        </th>

                        <th className="p-3 text-right">
                          Current charges
                        </th>

                        <th className="p-3 text-right">
                          Previous balance
                        </th>

                        <th className="p-3 text-right">
                          Statement total
                        </th>

                        <th className="p-3 text-center">
                          Status
                        </th>

                        <th className="p-3 text-right rounded-r-lg">
                          Action
                        </th>

                      </tr>

                    </thead>


                    <tbody>

                      {filteredDrafts
                        .map(
                          draft => (

                            <tr
                              key={
                                draft.id
                              }
                              className="
                                border-b
                                border-[#edf2ef]
                                hover:bg-[#e7f7ee]/60
                              "
                            >

                              <td className="p-3">

                                <div
                                  className="
                                    flex
                                    items-center
                                    gap-2
                                  "
                                >
                                  <div
                                    className="
                                      w-7
                                      h-7
                                      rounded-full
                                      bg-[#a8f1db]
                                      text-[#005142]
                                      flex
                                      items-center
                                      justify-center
                                      text-[10px]
                                      font-bold
                                    "
                                  >
                                    {initials(
                                      draft.tenantName,
                                    )}
                                  </div>

                                  <strong className="text-sm">
                                    {draft.tenantName}
                                  </strong>
                                </div>

                              </td>


                              <td className="p-3 text-sm font-medium">
                                {draft.unitName}
                              </td>


                              <td className="p-3">

                                <span
                                  className="
                                    px-2
                                    py-1
                                    rounded
                                    bg-[#d6e6dd]
                                    text-xs
                                    font-semibold
                                  "
                                >
                                  {displayContext(
                                    draft.billing_context,
                                  )}
                                </span>

                              </td>


                              <td className="p-3 text-right text-sm font-semibold">
                                {money(
                                  draft.current_charges,
                                )}
                              </td>


                              <td className="p-3 text-right text-sm">
                                {money(
                                  draft.previous_balance,
                                )}
                              </td>


                              <td className="p-3 text-right text-sm font-bold">
                                {money(
                                  draft.total_payable,
                                )}
                              </td>


                              <td className="p-3 text-center">

                                <span
                                  className={`
                                    inline-flex
                                    items-center
                                    gap-1
                                    px-2
                                    py-1
                                    rounded-full
                                    text-[10px]
                                    font-semibold

                                    ${
                                      draft.status ===
                                      'approved'
                                        ? 'bg-[#a8f1db]/40 text-[#26705f]'
                                        : 'bg-[#dcece2] text-[#424845]'
                                    }
                                  `}
                                >
                                  <span
                                    className={`
                                      w-1.5
                                      h-1.5
                                      rounded-full

                                      ${
                                        draft.status ===
                                        'approved'
                                          ? 'bg-[#1e6a59]'
                                          : 'bg-[#ba1a1a]'
                                      }
                                    `}
                                  />

                                  {draft.status ===
                                  'approved'
                                    ? 'Approved'
                                    : 'Needs review'}
                                </span>

                              </td>


                              <td className="p-3 text-right">

                                <button
                                  type="button"
                                  disabled={
                                    openingDraft
                                  }
                                  onClick={
                                    () =>
                                      void openDraft(
                                        draft,
                                      )
                                  }
                                  className="
                                    px-3
                                    py-1.5
                                    rounded
                                    bg-[#10211c]
                                    text-white
                                    text-xs
                                    font-semibold
                                  "
                                >
                                  Review
                                </button>

                              </td>

                            </tr>

                          ),
                        )}


                      {filteredDrafts
                        .length ===
                        0 && (
                        <tr>
                          <td
                            colSpan={8}
                            className="
                              py-12
                              text-center
                              text-sm
                              text-[#737875]
                            "
                          >
                            No bill drafts match
                            this view.
                          </td>
                        </tr>
                      )}

                    </tbody>

                  </table>

                </div>

              </section>



              {/* FINALIZATION */}

              <section
                className="
                  bg-[#10211c]
                  text-white
                  rounded-xl
                  p-5
                  shadow-[0_14px_40px_rgba(22,42,35,.12)]
                  flex
                  flex-col
                  md:flex-row
                  md:items-center
                  justify-between
                  gap-5
                "
              >

                <div
                  className="
                    flex
                    items-center
                    gap-4
                  "
                >

                  <div
                    className="
                      w-10
                      h-10
                      rounded-full
                      bg-[#1e6a59]
                      flex
                      items-center
                      justify-center
                    "
                  >
                    <span className="material-symbols-outlined">
                      assignment_turned_in
                    </span>
                  </div>


                  <div>

                    <strong>
                      {finalized
                        ? `${dashboard.invoiceCount} invoices finalized`
                        : `${dashboard.approvedCount} of ${dashboard.draftCount} drafts approved`}
                    </strong>


                    <div
                      className="
                        text-xs
                        text-[#b7cbc3]
                        mt-1
                      "
                    >
                      {finalized
                        ? 'This billing cycle has been converted into official invoices.'
                        : !allDraftsExist
                          ? `${remainingDrafts} tenant draft${remainingDrafts === 1 ? '' : 's'} still need to be generated.`
                          : !allApproved
                            ? `${dashboard.draftCount - dashboard.approvedCount} draft${dashboard.draftCount - dashboard.approvedCount === 1 ? '' : 's'} still require review.`
                            : 'All drafts are approved and ready for invoice finalization.'}
                    </div>

                  </div>

                </div>


                {!finalized ? (
                  <button
                    type="button"
                    disabled={
                      !canFinalize ||
                      finalizing
                    }
                    onClick={
                      () =>
                        void finalizeCycle()
                    }
                    className="
                      h-10
                      px-5
                      rounded-lg
                      bg-[#1e6a59]
                      text-white
                      font-bold
                      text-sm
                      disabled:opacity-40
                      disabled:cursor-not-allowed
                    "
                  >
                    {finalizing
                      ? 'Finalizing…'
                      : 'Finalize invoices'}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={
                      () => {
                        window.location.href =
                          `/billing/invoices?cycle=${cycle.id}`
                      }
                    }
                    className="
                      h-10
                      px-5
                      rounded-lg
                      bg-[#1e6a59]
                      text-white
                      font-bold
                      text-sm
                    "
                  >
                    View invoices
                  </button>
                )}

              </section>


            </>
          )}

        </main>

      </div>



      {/* DRAFT DRAWER */}

      {selectedDraft && (

        <DraftDrawer
          detail={
            selectedDraft
          }
          approving={
            approving
          }
          onApprove={
            () =>
              void approveDraft()
          }
          onClose={
            () =>
              setSelectedDraft(
                null,
              )
          }
        />

      )}

    </div>
  )
}



function WorkflowRail({
  dashboard,
  cycle,
  issueCount,
}: {
  dashboard:
    BillingDashboardData

  cycle:
    BillingCycle

  issueCount:
    number
}) {

  const invoiceStarted =
    dashboard.invoiceCount > 0
    ||
    cycle.status ===
      'invoiced'
    ||
    cycle.status ===
      'sent'
    ||
    cycle.status ===
      'closed'


  const sent =
    cycle.status ===
      'sent'
    ||
    cycle.status ===
      'closed'


  const steps = [
    {
      label:
        'Readings',

      value:
        issueCount > 0
          ? `${issueCount} issue${issueCount === 1 ? '' : 's'}`
          : 'Checked',

      complete:
        issueCount === 0,

      active:
        dashboard.draftCount ===
          0,
    },

    {
      label:
        'Readiness',

      value:
        issueCount > 0
          ? 'Attention required'
          : 'Ready',

      complete:
        issueCount === 0,

      active:
        dashboard.draftCount ===
          0,
    },

    {
      label:
        'Drafts',

      value:
        `${dashboard.draftCount}/${dashboard.leaseCount} generated`,

      complete:
        dashboard.draftCount ===
          dashboard.leaseCount
        &&
        dashboard.leaseCount > 0,

      active:
        !invoiceStarted,
    },

    {
      label:
        'Invoices',

      value:
        invoiceStarted
          ? `${dashboard.invoiceCount} invoices`
          : 'Not started',

      complete:
        invoiceStarted,

      active:
        invoiceStarted &&
        !sent,
    },

    {
      label:
        'Sent',

      value:
        sent
          ? 'Delivered'
          : 'Pending delivery',

      complete:
        sent,

      active:
        sent,
    },
  ]


  return (
    <section
      className="
        bg-white
        rounded-xl
        p-5
        shadow-[0_14px_40px_rgba(22,42,35,.06)]
      "
    >

      <div
        className="
          text-[10px]
          uppercase
          tracking-wider
          text-[#737875]
          font-semibold
          mb-3
        "
      >
        Workflow status
      </div>


      <div
        className="
          grid
          grid-cols-1
          sm:grid-cols-2
          xl:grid-cols-5
          gap-2
        "
      >

        {steps.map(
          (
            step,
            index,
          ) => (

            <div
              key={
                step.label
              }
              className={`
                p-3
                rounded-lg
                flex
                items-center
                gap-3

                ${
                  step.active
                    ? 'bg-[#10211c] text-white'
                    : 'bg-[#e7f7ee]'
                }
              `}
            >

              <div
                className={`
                  w-8
                  h-8
                  rounded-full
                  flex
                  items-center
                  justify-center
                  shrink-0
                  text-xs
                  font-bold

                  ${
                    step.complete
                      ? 'bg-[#1e6a59] text-white'
                      : step.active
                        ? 'bg-[#a8f1db] text-[#005142]'
                        : 'bg-[#dcece2] text-[#737875]'
                  }
                `}
              >
                {step.complete
                  ? (
                    <span className="material-symbols-outlined text-[17px]">
                      check
                    </span>
                  )
                  : (
                    String(
                      index + 1,
                    ).padStart(
                      2,
                      '0',
                    )
                  )}
              </div>


              <div className="min-w-0">

                <strong className="text-sm">
                  {index + 1}.{' '}
                  {step.label}
                </strong>

                <div
                  className={`
                    text-[11px]
                    truncate

                    ${
                      step.active
                        ? 'text-[#a8f1db]'
                        : 'text-[#424845]'
                    }
                  `}
                >
                  {step.value}
                </div>

              </div>

            </div>

          ),
        )}

      </div>

    </section>
  )
}



function MetricCard({
  label,
  value,
  subtitle,
  icon,
  accent = false,
  danger = false,
}: {
  label: string
  value: string
  subtitle: string
  icon: string

  accent?: boolean
  danger?: boolean
}) {

  return (
    <article
      className="
        bg-white
        rounded-xl
        p-5
        shadow-[0_14px_40px_rgba(22,42,35,.06)]
        flex
        items-start
        justify-between
      "
    >

      <div>

        <span
          className="
            text-[10px]
            uppercase
            tracking-wider
            text-[#737875]
            font-semibold
          "
        >
          {label}
        </span>


        <strong
          className={`
            block
            mt-1
            text-3xl
            tracking-tight

            ${
              danger
                ? 'text-[#ba1a1a]'
                : accent
                  ? 'text-[#1e6a59]'
                  : 'text-[#111e19]'
            }
          `}
        >
          {value}
        </strong>


        <small
          className="
            text-xs
            text-[#424845]
          "
        >
          {subtitle}
        </small>

      </div>


      <div
        className={`
          w-11
          h-11
          rounded-lg
          flex
          items-center
          justify-center

          ${
            danger
              ? 'bg-[#ffdad6] text-[#93000a]'
              : 'bg-[#e2f2e8] text-[#1e6a59]'
          }
        `}
      >
        <span className="material-symbols-outlined">
          {icon}
        </span>
      </div>

    </article>
  )
}



function CycleRow({
  label,
  value,
  green = false,
  red = false,
}: {
  label: string
  value: number

  green?: boolean
  red?: boolean
}) {

  return (
    <div
      className="
        flex
        items-center
        justify-between
      "
    >

      <span
        className="
          text-sm
          text-[#424845]
        "
      >
        {label}
      </span>


      <strong
        className={
          green
            ? 'text-[#1e6a59]'
            : red
              ? 'text-[#ba1a1a]'
              : ''
        }
      >
        {value}
      </strong>

    </div>
  )
}



function FilterButton({
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
      className={`
        px-3
        py-1.5
        rounded-lg
        text-xs
        font-semibold
        whitespace-nowrap

        ${
          active
            ? 'bg-[#10211c] text-white'
            : 'bg-[#e7f7ee] text-[#424845]'
        }
      `}
    >
      {children}
    </button>
  )
}



function EmptyRow({
  title,
  body,
}: {
  title: string
  body: string
}) {

  return (
    <div
      className="
        p-5
        rounded-lg
        bg-[#e7f7ee]
        text-center
      "
    >
      <strong className="text-sm">
        {title}
      </strong>

      <p
        className="
          mt-1
          text-xs
          text-[#424845]
        "
      >
        {body}
      </p>
    </div>
  )
}



function DraftDrawer({
  detail,
  approving,
  onApprove,
  onClose,
}: {
  detail: DraftDetail

  approving: boolean

  onApprove: () => void
  onClose: () => void
}) {

  const {
    draft,
    charges,
    balanceSources,
  } =
    detail


  return (
    <div
      className="
        fixed
        inset-0
        z-[100]
        bg-black/30
        flex
        justify-end
      "
      onMouseDown={
        event => {
          if (
            event.target ===
            event.currentTarget
          ) {
            onClose()
          }
        }
      }
    >

      <aside
        className="
          w-full
          sm:w-[540px]
          h-full
          bg-[#edfdf3]
          shadow-[-20px_0_60px_rgba(0,0,0,.14)]
          overflow-y-auto
        "
      >

        <div
          className="
            sticky
            top-0
            z-10
            bg-white/95
            backdrop-blur
            p-5
            border-b
            border-[#dcece2]
            flex
            items-center
            justify-between
          "
        >

          <div>

            <div className="flex items-center gap-2">

              <h2
                className="
                  font-['Newsreader']
                  text-xl
                "
              >
                {draft.tenantName}
                {' · '}
                {draft.unitName}
              </h2>

            </div>


            <div
              className="
                text-xs
                text-[#424845]
                mt-1
              "
            >
              Draft review ·{' '}
              {displayContext(
                draft.billing_context,
              )} billing
            </div>

          </div>


          <button
            type="button"
            onClick={onClose}
            className="
              w-9
              h-9
              rounded-lg
              hover:bg-[#e7f7ee]
            "
          >
            <span className="material-symbols-outlined">
              close
            </span>
          </button>

        </div>



        <div className="p-5 space-y-5">

          <section
            className="
              bg-white
              rounded-xl
              p-5
              shadow-[0_14px_40px_rgba(22,42,35,.06)]
            "
          >

            <div
              className="
                text-[10px]
                uppercase
                tracking-wider
                text-[#737875]
                font-semibold
                mb-3
              "
            >
              Charge itemization
            </div>


            <div className="space-y-2">

              {charges.map(
                charge => (

                  <div
                    key={
                      charge.id
                    }
                    className="
                      p-3
                      rounded-lg
                      bg-[#e7f7ee]
                    "
                  >

                    <div
                      className="
                        flex
                        items-center
                        justify-between
                        gap-4
                      "
                    >

                      <div
                        className="
                          flex
                          items-center
                          gap-2
                        "
                      >
                        <span
                          className="
                            material-symbols-outlined
                            text-[#1e6a59]
                            text-[18px]
                          "
                        >
                          {charge.charge_type ===
                          'rent'
                            ? 'roofing'
                            : charge.charge_type ===
                                'utility'
                              ? 'water_drop'
                              : 'payments'}
                        </span>

                        <span className="text-sm font-medium">
                          {charge.description}
                        </span>
                      </div>


                      <strong className="text-sm">
                        {money(
                          charge.amount,
                        )}
                      </strong>

                    </div>


                    {charge.details.map(
                      item => (
                        <div
                          key={item.id}
                          className="
                            pl-7
                            text-xs
                            text-[#424845]
                            mt-1
                          "
                        >
                          {item.previous_reading !==
                            null
                            &&
                            item.current_reading !==
                              null && (
                            <>
                              {item.previous_reading}
                              {' → '}
                              {item.current_reading}
                            </>
                          )}

                          {item.consumption !==
                            null && (
                            <>
                              {' · '}
                              {item.consumption}
                              {' units'}
                            </>
                          )}

                          {item.rate !==
                            null && (
                            <>
                              {' × '}
                              {money(
                                item.rate,
                              )}
                            </>
                          )}
                        </div>
                      ),
                    )}

                  </div>

                ),
              )}

            </div>


            <div
              className="
                mt-3
                p-3
                rounded-lg
                bg-[#e2f2e8]
                flex
                justify-between
                font-bold
              "
            >
              <span>
                Current charges
              </span>

              <span>
                {money(
                  draft.current_charges,
                )}
              </span>
            </div>

          </section>



          <section
            className="
              bg-white
              rounded-xl
              p-5
              shadow-[0_14px_40px_rgba(22,42,35,.06)]
            "
          >

            <div
              className="
                text-[10px]
                uppercase
                tracking-wider
                text-[#737875]
                font-semibold
              "
            >
              Previous balance
            </div>


            <div
              className="
                flex
                justify-between
                items-center
                mt-2
              "
            >
              <span className="text-sm">
                Carried forward
              </span>

              <strong className="text-lg">
                {money(
                  draft.previous_balance,
                )}
              </strong>
            </div>


            {balanceSources.length >
              0 && (
              <div className="mt-4 space-y-2">

                {balanceSources.map(
                  source => (
                    <div
                      key={
                        source
                          .source_invoice_id
                      }
                      className="
                        flex
                        justify-between
                        text-xs
                        bg-[#e7f7ee]
                        p-3
                        rounded-lg
                      "
                    >
                      <span>
                        {source.invoiceNumber}
                      </span>

                      <strong>
                        {money(
                          source.amount,
                        )}
                      </strong>
                    </div>
                  ),
                )}

              </div>
            )}

          </section>



          <section
            className="
              bg-[#10211c]
              text-white
              rounded-xl
              p-5
            "
          >

            <div
              className="
                text-[10px]
                uppercase
                tracking-wider
                text-[#b7cbc3]
              "
            >
              Statement total
            </div>

            <strong
              className="
                block
                text-3xl
                mt-1
              "
            >
              {money(
                draft.total_payable,
              )}
            </strong>

          </section>



          <div className="flex gap-3">

            <button
              type="button"
              onClick={onClose}
              className="
                h-10
                px-4
                rounded-lg
                bg-[#d6e6dd]
                text-sm
                font-semibold
              "
            >
              Close
            </button>


            <button
              type="button"
              disabled={
                approving
                ||
                draft.status ===
                  'approved'
              }
              onClick={onApprove}
              className="
                flex-1
                h-10
                rounded-lg
                bg-[#1e6a59]
                text-white
                text-sm
                font-semibold
                disabled:opacity-50
              "
            >
              {draft.status ===
              'approved'
                ? 'Approved'
                : approving
                  ? 'Approving…'
                  : 'Approve draft'}
            </button>

          </div>

        </div>

      </aside>

    </div>
  )
}



function DwellioSidebar({
  organizationName,
  firstName,
  role,
}: {
  organizationName: string
  firstName: string
  role: string
}) {

  const nav = [
    [
      'Dashboard',
      'dashboard',
      '/',
    ],

    [
      'Properties',
      'apartment',
      '/properties',
    ],

    [
      'Tenants',
      'group',
      '/tenants',
    ],

    [
      'Leases',
      'history_edu',
      '/leases',
    ],

    [
      'Billing',
      'receipt_long',
      '/billing',
    ],

    [
      'Maintenance',
      'build',
      '/maintenance',
    ],

    [
      'Staff',
      'badge',
      '/staff',
    ],

    [
      'Announcements',
      'campaign',
      '/announcements',
    ],

    [
      'Reports',
      'analytics',
      '/reports',
    ],

    [
      'Documents',
      'folder',
      '/documents',
    ],
  ] as const


  return (
    <aside
      className="
        hidden
        lg:flex
        fixed
        left-0
        top-0
        z-50
        h-full
        w-[260px]
        bg-[#10211c]
        text-white
        flex-col
        justify-between
        shadow-[0_14px_40px_rgba(22,42,35,.06)]
      "
    >

      <div>

        <div
          className="
            h-16
            px-6
            flex
            items-center
            gap-2
          "
        >

          <div
            className="
              w-7
              h-7
              rounded-lg
              bg-[#1e6a59]
              flex
              items-center
              justify-center
              font-bold
            "
          >
            d
          </div>


          <span
            className="
              font-['Newsreader']
              text-xl
            "
          >
            dwellio
            <span className="text-[#a8f1da]">
              .
            </span>
          </span>

        </div>


        <div className="px-4">

          <div
            className="
              px-2
              text-[9px]
              tracking-[.16em]
              text-[#778a83]
              uppercase
              font-bold
            "
          >
            Workspace
          </div>


          <div
            className="
              mt-2
              p-3
              rounded-lg
              bg-[#00231b]
            "
          >
            <strong className="block text-sm truncate">
              {organizationName}
            </strong>

            <span className="text-[10px] text-[#778a83]">
              Landlord workspace
            </span>
          </div>

        </div>


        <nav
          className="
            mt-4
            px-4
            space-y-1
          "
        >

          {nav.map(
            (
              [
                label,
                icon,
                href,
              ],
            ) => {

              const active =
                label ===
                'Billing'


              return (
                <button
                  key={label}
                  type="button"
                  onClick={
                    () => {
                      window.location.href =
                        href
                    }
                  }
                  className={`
                    w-full
                    flex
                    items-center
                    gap-3
                    px-4
                    py-2.5
                    rounded-lg
                    text-sm
                    text-left

                    ${
                      active
                        ? 'bg-[#1e6a59] text-white font-semibold'
                        : 'text-[#778a83] hover:bg-[#00231b] hover:text-white'
                    }
                  `}
                >
                  <span className="material-symbols-outlined text-[19px]">
                    {icon}
                  </span>

                  {label}
                </button>
              )
            },
          )}

        </nav>

      </div>


      <div className="p-4">

        <div
          className="
            p-3
            rounded-lg
            bg-[#00231b]/70
            flex
            items-center
            gap-3
          "
        >

          <div
            className="
              w-8
              h-8
              rounded-full
              bg-[#1e6a59]
              flex
              items-center
              justify-center
              font-bold
              text-xs
            "
          >
            {firstName[0]
              ?.toUpperCase()}
          </div>


          <div className="min-w-0">

            <strong
              className="
                block
                text-xs
                truncate
              "
            >
              {firstName}
            </strong>

            <span
              className="
                block
                text-[9px]
                text-[#778a83]
              "
            >
              {role}
            </span>

          </div>

        </div>

      </div>

    </aside>
  )
}