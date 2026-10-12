import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import PageSkeleton from '../components/loading/PageSkeleton'
import {
  decideMoveOutRequest,
  fetchTenantDirectory,
  type TenantDirectoryData,
  type TenantLease,
  type TenantMoveOutRequest,
  type TenantProfile,
} from '../features/tenants/data/tenantManagementRepository'

type Props = { organizationId: string }
type ProfileView = 'overview' | 'lease' | 'invoices' | 'requests' | 'history'

const sectionViews: { id: ProfileView; title: string }[] = [
  { id: 'overview', title: 'Overview' },
  { id: 'lease', title: 'Lease' },
  { id: 'invoices', title: 'Billing & balances' },
  { id: 'requests', title: 'Move-out requests' },
  { id: 'history', title: 'History' },
]

function money(amount: number | null) {
  if (amount === null) return 'Needs review'
  return `KSh ${amount.toLocaleString('en-KE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function formattedDate(value: string | null) {
  if (!value) return '—'
  return new Date(`${value.slice(0, 10)}T12:00:00`)
    .toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })
}

function todayNairobi() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const part = (type: string) => parts.find(row => row.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

function leaseLabel(status: string) {
  const names: Record<string, string> = {
    pending_confirmation: 'Awaiting acceptance',
    pending_acceptance: 'Awaiting acceptance',
    not_moved_in_yet: 'Not moved in yet',
    active: 'Active',
    notice_given: 'Notice given',
    expired: 'Expired',
    declined: 'Declined',
    terminated: 'Terminated',
    draft: 'Draft',
  }
  return names[status] ?? status.replaceAll('_', ' ')
}

function preferredLease(leases: TenantLease[]) {
  return leases.find(lease => ['active', 'notice_given'].includes(lease.status)) ??
    leases.find(lease => ['not_moved_in_yet', 'pending_confirmation', 'pending_acceptance'].includes(lease.status)) ??
    leases[0] ?? null
}

function statusTag(status: string) {
  return ['active'].includes(status) ? 'bg-[#a8f1db]/45 text-[#005142]' :
    ['notice_given', 'pending_acceptance', 'pending_confirmation', 'not_moved_in_yet'].includes(status)
      ? 'bg-[#fff2ca] text-[#775c11]' : 'bg-[#dcece2] text-[#576e62]'
}

function SummaryCard({ label, value, subtitle, icon }: {
  label: string; value: string; subtitle?: string; icon: string
}) {
  return (
    <div className="rounded-2xl border border-[#dcece2] bg-white p-4 shadow-[0_10px_25px_rgba(16,33,28,.04)] sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold text-[#737875]">{label}</span>
        <span className="material-symbols-outlined rounded-xl bg-[#e7f7ee] p-2 text-[#1e6a59]">{icon}</span>
      </div>
      <div className="mt-3 font-['Newsreader'] text-2xl font-semibold text-[#111e19]">{value}</div>
      {subtitle && <p className="mt-1 text-[11px] leading-5 text-[#737875]">{subtitle}</p>}
    </div>
  )
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[#f3fbf6] px-4 py-3">
      <div className="text-[10px] font-semibold text-[#737875]">{label}</div>
      <div className="mt-1 break-words text-sm font-semibold text-[#111e19]">{value}</div>
    </div>
  )
}

export default function TenantsPage({ organizationId }: Props) {
  const navigate = useNavigate()
  const { tenantId } = useParams<{ tenantId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const [data, setData] = useState<TenantDirectoryData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const [search, setSearch] = useState('')
  const [propertyFilter, setPropertyFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [requestBeingReviewed, setRequestBeingReviewed] = useState<TenantMoveOutRequest | null>(null)
  const [decision, setDecision] = useState<'accepted' | 'declined'>('accepted')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    let alive = true
    async function load() {
      setLoading(true)
      setError('')
      try {
        const result = await fetchTenantDirectory(organizationId)
        if (alive) setData(result)
      } catch (caught) {
        if (alive) setError(caught instanceof Error ? caught.message : 'Unable to load tenant information.')
      } finally {
        if (alive) setLoading(false)
      }
    }
    void load()
    return () => { alive = false }
  }, [organizationId, refreshKey])

  const profiles = data?.profiles ?? []
  const selected = profiles.find(profile => profile.tenant.id === tenantId)
  const current = selected ? preferredLease(selected.leases) : null
  const viewParam = searchParams.get('view')
  const profileView: ProfileView = sectionViews.some(item => item.id === viewParam)
    ? viewParam as ProfileView : 'overview'

  const properties = useMemo(() => {
    const items = new Map<string, string>()
    for (const profile of profiles) for (const lease of profile.leases) {
      if (lease.propertyId) items.set(lease.propertyId, lease.propertyName)
    }
    return [...items].sort((a, b) => a[1].localeCompare(b[1]))
  }, [profiles])

  const visibleProfiles = useMemo(() => profiles.filter(profile => {
    const lease = preferredLease(profile.leases)
    const query = search.trim().toLowerCase()
    if (query && ![
      profile.tenant.full_name,
      profile.tenant.email,
      profile.tenant.phone,
      ...profile.leases.flatMap(item => [
        item.propertyName, item.unitName, item.buildingName,
      ]),
    ].some(value => value.toLowerCase().includes(query))) return false
    if (propertyFilter !== 'all' &&
      !profile.leases.some(item => item.propertyId === propertyFilter)) return false
    if (statusFilter === 'all') return true
    if (statusFilter === 'without_lease') return lease === null
    if (statusFilter === 'former') return !lease ||
      ['expired', 'terminated', 'declined'].includes(lease.status)
    return lease?.status === statusFilter ||
      (statusFilter === 'pending' && ['pending_confirmation', 'pending_acceptance'].includes(lease?.status ?? ''))
  }), [profiles, search, propertyFilter, statusFilter])

  const pendingRequests = profiles.flatMap(profile => profile.requests
    .filter(request => request.status === 'pending')
    .map(request => ({ profile, request })))
  const pendingLeases = profiles.filter(profile => {
    const lease = preferredLease(profile.leases)
    return lease && ['pending_acceptance', 'pending_confirmation'].includes(lease.status)
  })
  const dueSoon = profiles.filter(profile => {
    const lease = preferredLease(profile.leases)
    if (!lease || !['active', 'notice_given'].includes(lease.status)) return false
    const days = (Date.parse(`${lease.end_date}T12:00:00Z`) -
      Date.parse(`${todayNairobi()}T12:00:00Z`)) / 86400000
    return days >= 0 && days <= 60
  })
  const unresolved = profiles.filter(profile => profile.balanceIssue !== null)
  const balanceDebtors = profiles.filter(profile => profile.balance !== null && profile.balance > 0.005)
  const verifiedTotal = profiles.reduce((sum, profile) => sum + (profile.balance ?? 0), 0)

  function openReview(request: TenantMoveOutRequest, nextDecision: 'accepted' | 'declined') {
    setRequestBeingReviewed(request)
    setDecision(nextDecision)
    setReason('')
    setActionError('')
  }

  async function submitReview() {
    if (!requestBeingReviewed || saving) return
    if (decision === 'declined' && !reason.trim()) {
      setActionError('Give the tenant a reason for declining the request.')
      return
    }
    setSaving(true)
    setActionError('')
    try {
      await decideMoveOutRequest(
        requestBeingReviewed.id, decision, reason.trim() || null,
      )
      setRequestBeingReviewed(null)
      setSuccess(
        decision === 'accepted'
          ? 'Request accepted. The lease is now in Notice given; inspection and final settlement are separate future steps.'
          : 'Move-out request declined. The tenant will be notified.',
      )
      setRefreshKey(value => value + 1)
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'Unable to review this request.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <PageSkeleton variant="dashboard" />

  if (error || !data) return (
    <div className="min-h-full bg-[#edfdf3] p-6">
      <div role="alert" className="mx-auto max-w-5xl rounded-2xl bg-white p-7">
        <h1 className="font-['Newsreader'] text-2xl font-semibold">Tenants could not be loaded</h1>
        <p className="mt-2 text-sm text-[#93000a]">{error || 'No tenant data was returned.'}</p>
        <button type="button" onClick={() => setRefreshKey(v => v + 1)}
          className="mt-4 rounded-xl bg-[#10211c] px-5 py-2.5 text-sm font-semibold text-white">Retry</button>
      </div>
    </div>
  )

  if (tenantId && !selected) return (
    <div className="min-h-full bg-[#edfdf3] p-6">
      <div className="mx-auto max-w-5xl rounded-2xl bg-white p-7">
        <Link to="/tenants" className="inline-flex items-center gap-1 text-sm font-semibold text-[#1e6a59]">
          <span className="material-symbols-outlined text-[18px]">arrow_back</span>Back to tenants
        </Link>
        <h1 className="mt-4 font-['Newsreader'] text-2xl font-semibold">Tenant not found</h1>
        <p className="mt-2 text-sm text-[#737875]">This tenant is not in your organization or is no longer available.</p>
      </div>
    </div>
  )

  const panel = selected ? (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link to="/tenants" className="inline-flex items-center gap-2 rounded-xl border border-[#dcece2] bg-white px-4 py-2.5 text-sm font-semibold text-[#1e6a59]">
          <span className="material-symbols-outlined text-[19px]">arrow_back</span>Back to tenants
        </Link>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusTag(current?.status ?? 'none')}`}>
          {current ? leaseLabel(current.status) : 'No active lease'}
        </span>
      </div>

      <section className="rounded-2xl border border-[#dcece2] bg-white p-6 shadow-[0_12px_34px_rgba(16,33,28,.04)]">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#e7f7ee] font-['Newsreader'] text-xl font-semibold text-[#1e6a59]">
            {selected.tenant.full_name.trim().split(/\s+/).slice(0, 2).map(n => n[0]?.toUpperCase()).join('')}
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[.16em] text-[#1e6a59]">Tenant profile</div>
            <h1 className="font-['Newsreader'] text-3xl font-semibold text-[#111e19]">{selected.tenant.full_name}</h1>
            <p className="mt-1 text-sm text-[#737875]">{current
              ? `${current.propertyName} · ${current.unitName}`
              : 'No current property or unit'}</p>
          </div>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <DetailField label="Agreed rent" value={current ? money(current.rent_amount) : '—'}/>
          <DetailField label="Tenant balance" value={money(selected.balance)}/>
          <DetailField label="Lease end date" value={formattedDate(current?.end_date ?? null)}/>
        </div>
        {selected.balanceIssue && (
          <p role="status" className="mt-3 rounded-xl bg-[#fff5dc] p-3 text-xs leading-5 text-[#795e13]">
            <strong>Balance needs reconciliation.</strong> {selected.balanceIssue}
            Individual invoices remain visible under Billing & balances.
          </p>
        )}
      </section>

      {success && <div role="status" className="rounded-xl border border-[#b9e4cd] bg-[#e7f7ee] p-4 text-sm text-[#005142]">{success}</div>}

      <div className="flex gap-2 overflow-x-auto rounded-xl border border-[#dcece2] bg-white p-2">
        {sectionViews.map(section => (
          <button key={section.id} type="button" onClick={() => setSearchParams({ view: section.id })}
            className={`shrink-0 rounded-lg px-4 py-2.5 text-xs font-semibold transition ${profileView === section.id
              ? 'bg-[#10211c] text-white' : 'text-[#424845] hover:bg-[#e7f7ee]'}`}>
            {section.title}
          </button>
        ))}
      </div>

      {profileView === 'overview' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-2xl border border-[#dcece2] bg-white p-5">
            <h2 className="font-['Newsreader'] text-xl font-semibold">Contact information</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <DetailField label="Email" value={selected.tenant.email}/>
              <DetailField label="Phone" value={selected.tenant.phone}/>
              <DetailField label="Account" value={selected.tenant.user_id ? 'Linked to Dwellio' : 'Not yet linked'}/>
              <DetailField label="Tenant record" value={selected.tenant.status}/>
            </div>
            <h3 className="mt-5 text-sm font-semibold">Emergency contacts</h3>
            {selected.contacts.length === 0 ? <p className="mt-2 text-xs text-[#737875]">No emergency contacts recorded.</p> :
              selected.contacts.map((contact, i) => (
                <div key={i} className="mt-2 rounded-xl bg-[#f3fbf6] p-3 text-sm">
                  <strong>{contact.full_name}</strong>
                  <span className="ml-2 text-xs text-[#737875]">{contact.relationship}</span>
                  <p className="mt-1 text-xs text-[#737875]">{contact.phone}</p>
                </div>
              ))}
          </section>
          <section className="rounded-2xl border border-[#dcece2] bg-white p-5">
            <h2 className="font-['Newsreader'] text-xl font-semibold">Current tenancy</h2>
            {current ? <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <DetailField label="Property" value={current.propertyName}/>
              <DetailField label="Unit" value={current.unitName}/>
              <DetailField label="Start date" value={formattedDate(current.start_date)}/>
              <DetailField label="End date" value={formattedDate(current.end_date)}/>
              <DetailField label="Rent due day" value={String(current.due_day)}/>
              <DetailField label="Deposit on lease" value={money(current.deposit_amount)}/>
            </div> : <p className="mt-4 text-sm text-[#737875]">No tenancy has been recorded yet.</p>}
            <button type="button" onClick={() => setSearchParams({ view: 'lease' })}
              className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-[#1e6a59]">
              View lease information <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
            </button>
          </section>
        </div>
      )}

      {profileView === 'lease' && (
        <section className="rounded-2xl border border-[#dcece2] bg-white p-5">
          <h2 className="font-['Newsreader'] text-2xl font-semibold">Current lease</h2>
          {current ? <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <DetailField label="Status" value={leaseLabel(current.status)}/>
            <DetailField label="Agreed rent" value={money(current.rent_amount)}/>
            <DetailField label="Deposit agreed" value={money(current.deposit_amount)}/>
            <DetailField label="Billing frequency" value={current.billing_frequency}/>
            <DetailField label="Rent due day" value={String(current.due_day)}/>
            <DetailField label="Grace period" value={`${current.grace_period_days} days`}/>
            <DetailField label="Lease begins" value={formattedDate(current.start_date)}/>
            <DetailField label="Lease ends" value={formattedDate(current.end_date)}/>
            <DetailField label="Notice date" value={formattedDate(current.notice_date)}/>
            <DetailField label="Scheduled move-out" value={formattedDate(current.move_out_date)}/>
          </div> : <p className="mt-3 text-sm text-[#737875]">There is no current lease.</p>}
          {current?.status === 'notice_given' && (
            <div className="mt-5 rounded-xl border border-[#dcece2] bg-[#e7f7ee] p-4">
              <h3 className="text-sm font-semibold text-[#10211c]">Move-out process</h3>
              <p className="mt-1 text-xs leading-5 text-[#424845]">
                Notice has been accepted. The unit remains occupied until the move-out process is completed.
              </p>
              <div className="mt-3 space-y-2 text-xs">
                <p><span className="material-symbols-outlined mr-1 align-middle text-[17px] text-[#1e6a59]">check_circle</span>Notice recorded</p>
                <p className="text-[#737875]"><span className="material-symbols-outlined mr-1 align-middle text-[17px]">schedule</span>Move-out inspection — planned</p>
                <p className="text-[#737875]"><span className="material-symbols-outlined mr-1 align-middle text-[17px]">schedule</span>Deposit deductions and final invoice — planned</p>
              </div>
            </div>
          )}
        </section>
      )}

      {profileView === 'invoices' && (
        <section className="rounded-2xl border border-[#dcece2] bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-['Newsreader'] text-2xl font-semibold">Invoices & balances</h2>
              <p className="mt-1 text-xs text-[#737875]">
                Balance is reconciled against carried-forward invoice sources; each invoice retains its stored values.
              </p>
            </div>
            <div className="rounded-xl bg-[#e7f7ee] px-4 py-3">
              <span className="block text-[10px] font-semibold text-[#737875]">Account balance</span>
              <strong className="mt-1 block text-lg text-[#10211c]">{money(selected.balance)}</strong>
            </div>
          </div>
          {selected.balanceIssue && <p className="mt-4 rounded-xl bg-[#fff5dc] p-4 text-xs text-[#795e13]">
            {selected.balanceIssue}
          </p>}
          {selected.invoices.length === 0 ? (
            <div className="mt-5 rounded-xl bg-[#f3fbf6] p-6 text-sm text-[#737875]">
              No finalized invoices have been generated for this tenant yet.
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              {selected.invoices.map(invoice => (
                <div key={invoice.id} className="rounded-xl border border-[#dcece2] p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <strong className="text-sm text-[#111e19]">{invoice.invoice_number}</strong>
                      <p className="mt-1 text-xs text-[#737875]">
                        {formattedDate(invoice.billing_period_start)} – {formattedDate(invoice.billing_period_end)}
                      </p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-[10px] font-semibold ${statusTag(invoice.status)}`}>
                      {invoice.status.replaceAll('_', ' ')}
                    </span>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-4">
                    <DetailField label="New charges" value={money(invoice.current_charges)}/>
                    <DetailField label="Carried balance" value={money(invoice.previous_balance)}/>
                    <DetailField label="Paid amount" value={money(invoice.paid_amount)}/>
                    <DetailField label="Invoice outstanding" value={money(invoice.outstanding_amount)}/>
                  </div>
                  {invoice.previous_balance > 0 && <p className="mt-3 text-[11px] text-[#737875]">
                    Carried balance originates from earlier invoices. It is not a second independent charge in the tenant account total.
                  </p>}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {profileView === 'requests' && (
        <section className="rounded-2xl border border-[#dcece2] bg-white p-5">
          <h2 className="font-['Newsreader'] text-2xl font-semibold">Move-out requests</h2>
          <p className="mt-1 text-xs text-[#737875]">Review notices without triggering inspection or final invoice settlement.</p>
          {selected.requests.length === 0 ? <div className="mt-5 rounded-xl bg-[#f3fbf6] p-6 text-sm text-[#737875]">No move-out requests recorded.</div> :
            <div className="mt-5 space-y-3">
              {selected.requests.map(request => (
                <div key={request.id} className="rounded-xl border border-[#dcece2] bg-[#f3fbf6] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <strong className="text-sm text-[#111e19]">Requested move-out: {formattedDate(request.proposed_move_out_date)}</strong>
                      <p className="mt-1 text-xs text-[#737875]">Submitted {formattedDate(request.submitted_at)}</p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${request.status === 'accepted'
                      ? 'bg-[#a8f1db]/45 text-[#005142]'
                      : request.status === 'pending' ? 'bg-[#fff2ca] text-[#775c11]' : 'bg-[#dcece2] text-[#576e62]'}`}>
                      {request.status}
                    </span>
                  </div>
                  <p className="mt-3 text-sm text-[#424845]">{request.reason || 'No reason provided.'}</p>
                  {request.decision_reason && <p className="mt-2 text-xs text-[#737875]">Decision: {request.decision_reason}</p>}
                  {request.status === 'pending' && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button type="button" onClick={() => openReview(request, 'accepted')}
                        className="rounded-xl bg-[#10211c] px-4 py-2.5 text-xs font-semibold text-white">Accept request</button>
                      <button type="button" onClick={() => openReview(request, 'declined')}
                        className="rounded-xl border border-[#dcece2] bg-white px-4 py-2.5 text-xs font-semibold text-[#424845]">Decline request</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          }
        </section>
      )}

      {profileView === 'history' && (
        <section className="rounded-2xl border border-[#dcece2] bg-white p-5">
          <h2 className="font-['Newsreader'] text-2xl font-semibold">Tenancy history</h2>
          {selected.leases.length === 0 ? <p className="mt-3 text-sm text-[#737875]">No leases recorded.</p> :
            <div className="mt-4 space-y-3">
              {selected.leases.map(lease => (
                <div key={lease.id} className="rounded-xl bg-[#f3fbf6] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong className="text-sm text-[#111e19]">{lease.propertyName} · {lease.unitName}</strong>
                    <span className={`rounded-full px-3 py-1 text-[10px] font-semibold ${statusTag(lease.status)}`}>
                      {leaseLabel(lease.status)}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-[#737875]">{formattedDate(lease.start_date)} → {formattedDate(lease.end_date)}</p>
                  <p className="mt-1 text-xs text-[#424845]">Agreed rent: {money(lease.rent_amount)}</p>
                </div>
              ))}
            </div>}
        </section>
      )}
    </div>
  ) : null

  return (
    <div className="min-h-full bg-[#edfdf3] px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1450px] space-y-6">
        {selected ? panel : (
          <>
            <header className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[.18em] text-[#1e6a59]">Organization workspace</div>
                <h1 className="mt-1 font-['Newsreader'] text-4xl font-semibold text-[#111e19]">Tenants</h1>
                <p className="mt-2 text-sm text-[#424845]">Manage your residents, their leases and financial standing.</p>
              </div>
              <Link to="/tenants/new" className="inline-flex items-center gap-2 rounded-xl bg-[#10211c] px-5 py-3 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(16,33,28,.13)]">
                <span className="material-symbols-outlined text-[19px]">person_add</span>Add tenant
              </Link>
            </header>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <SummaryCard label="Total tenants" value={String(profiles.length)} icon="groups" subtitle="Organization records"/>
              <SummaryCard label="Active tenancies" value={String(profiles.filter(p => preferredLease(p.leases)?.status === 'active').length)} icon="home" subtitle="Currently active leases"/>
              <SummaryCard label="Pending acceptance" value={String(pendingLeases.length)} icon="hourglass_top" subtitle="Waiting for tenants"/>
              <SummaryCard label="Pending move-out requests" value={String(pendingRequests.length)} icon="event_note" subtitle="Require landlord decision"/>
            </div>

            <section className="rounded-2xl border border-[#dcece2] bg-white p-5 shadow-[0_12px_34px_rgba(16,33,28,.04)]">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[.16em] text-[#1e6a59]">High priority</div>
                  <h2 className="mt-1 font-['Newsreader'] text-2xl font-semibold text-[#111e19]">Needs attention</h2>
                </div>
                <span className="rounded-full bg-[#e7f7ee] px-3 py-1 text-xs font-semibold text-[#1e6a59]">
                  {pendingRequests.length + pendingLeases.length + dueSoon.length + balanceDebtors.length + unresolved.length} items
                </span>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {[
                  ...pendingRequests.map(({ profile }) => ({
                    id: `request-${profile.tenant.id}`, title: `${profile.tenant.full_name} requested to move out`,
                    description: 'Review the proposed move-out date and reason.',
                    destination: `/tenants/${profile.tenant.id}?view=requests`,
                  })),
                  ...pendingLeases.map(profile => ({
                    id: `pending-${profile.tenant.id}`, title: `${profile.tenant.full_name} hasn't accepted their lease`,
                    description: 'Lease confirmation is still pending.',
                    destination: `/tenants/${profile.tenant.id}?view=lease`,
                  })),
                  ...dueSoon.map(profile => ({
                    id: `expiring-${profile.tenant.id}`, title: `${profile.tenant.full_name}'s lease ends soon`,
                    description: 'Check lease end date and next steps.',
                    destination: `/tenants/${profile.tenant.id}?view=lease`,
                  })),
                  ...balanceDebtors.map(profile => ({
                    id: `balance-${profile.tenant.id}`, title: `${profile.tenant.full_name} has an outstanding balance`,
                    description: money(profile.balance),
                    destination: `/tenants/${profile.tenant.id}?view=invoices`,
                  })),
                  ...unresolved.map(profile => ({
                    id: `review-${profile.tenant.id}`, title: `${profile.tenant.full_name}'s balance needs review`,
                    description: 'Invoice source records could not be reconciled.',
                    destination: `/tenants/${profile.tenant.id}?view=invoices`,
                  })),
                ].slice(0, 6).map(item => (
                  <Link key={item.id} to={item.destination} className="group rounded-xl border border-[#dcece2] bg-[#f3fbf6] p-4 transition hover:border-[#1e6a59]/35 hover:shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <strong className="text-xs leading-5 text-[#111e19]">{item.title}</strong>
                      <span className="material-symbols-outlined text-[19px] text-[#1e6a59]">arrow_forward</span>
                    </div>
                    <p className="mt-2 text-[11px] leading-5 text-[#737875]">{item.description}</p>
                  </Link>
                ))}
                {pendingRequests.length + pendingLeases.length + dueSoon.length + balanceDebtors.length + unresolved.length === 0 && (
                  <div className="rounded-xl bg-[#e7f7ee] p-4 text-xs text-[#1e6a59]">Nothing needs immediate attention.</div>
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-[#dcece2] bg-white p-5 shadow-[0_12px_34px_rgba(16,33,28,.04)] sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-['Newsreader'] text-2xl font-semibold text-[#111e19]">Tenant directory</h2>
                  <p className="mt-1 text-xs text-[#737875]">Select a person to view their profile, leases and invoices.</p>
                </div>
                <span className="text-xs text-[#737875]">{visibleProfiles.length} of {profiles.length} tenants</span>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_210px_190px]">
                <label className="flex items-center gap-2 rounded-xl bg-[#edfdf3] px-3 py-2.5">
                  <span className="material-symbols-outlined text-[18px] text-[#1e6a59]">search</span>
                  <input type="search" value={search} onChange={event => setSearch(event.target.value)}
                    aria-label="Search tenants" placeholder="Name, email, phone, property or unit..."
                    className="min-w-0 w-full bg-transparent text-sm outline-none"/>
                </label>
                <select aria-label="Filter by property" value={propertyFilter} onChange={event => setPropertyFilter(event.target.value)}
                  className="rounded-xl bg-[#edfdf3] p-3 text-xs font-semibold text-[#424845]">
                  <option value="all">All properties</option>
                  {properties.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                </select>
                <select aria-label="Filter by tenancy status" value={statusFilter} onChange={event => setStatusFilter(event.target.value)}
                  className="rounded-xl bg-[#edfdf3] p-3 text-xs font-semibold text-[#424845]">
                  <option value="all">All statuses</option>
                  <option value="active">Active</option>
                  <option value="pending">Pending acceptance</option>
                  <option value="not_moved_in_yet">Not moved in yet</option>
                  <option value="notice_given">Notice given</option>
                  <option value="former">Former tenants</option>
                  <option value="without_lease">Without lease</option>
                </select>
              </div>
              {visibleProfiles.length === 0 ? (
                <div className="mt-5 rounded-xl bg-[#f3fbf6] p-8 text-center text-sm text-[#737875]">
                  {profiles.length ? 'No tenants match your filters.' : 'No tenants yet. Use Add tenant to onboard the first resident.'}
                </div>
              ) : (
                <div className="mt-5 space-y-2">
                  {visibleProfiles.map(profile => {
                    const lease = preferredLease(profile.leases)
                    return (
                      <Link key={profile.tenant.id} to={`/tenants/${profile.tenant.id}`}
                        className="group flex flex-wrap items-center gap-3 rounded-xl border border-[#dcece2] bg-[#f3fbf6] p-4 transition hover:border-[#9dbda9] hover:bg-[#e7f7ee]">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-xs font-semibold text-[#1e6a59]">
                          {profile.tenant.full_name.trim().split(/\s+/).slice(0, 2).map(n => n[0]?.toUpperCase()).join('')}
                        </div>
                        <div className="min-w-[170px] flex-1">
                          <strong className="block truncate text-sm text-[#111e19]">{profile.tenant.full_name}</strong>
                          <span className="block truncate text-[11px] text-[#737875]">{profile.tenant.phone} · {lease ? `${lease.propertyName} / ${lease.unitName}` : 'No current unit'}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`rounded-full px-3 py-1 text-[10px] font-semibold ${statusTag(lease?.status ?? 'none')}`}>
                            {lease ? leaseLabel(lease.status) : 'No lease'}
                          </span>
                          <span className="hidden w-[110px] text-right text-xs font-semibold text-[#111e19] sm:block">{money(profile.balance)}</span>
                          <span className="material-symbols-outlined text-[#1e6a59]">chevron_right</span>
                        </div>
                      </Link>
                    )
                  })}
                </div>
              )}
            </section>
            <div className="rounded-xl border border-[#dcece2] bg-white p-4 text-xs text-[#737875]">
              Verified tenant balances shown: <strong>{money(verifiedTotal)}</strong>
              {unresolved.length > 0 && ` · ${unresolved.length} tenants excluded because their invoice histories need reconciliation.`}
              {' '}The dashboard does not change invoice or payment records.
            </div>
          </>
        )}
      </div>

      {requestBeingReviewed && (
        <div className="fixed inset-0 z-[95] flex items-end justify-center bg-[#10211c]/55 p-0 backdrop-blur-sm sm:items-center sm:p-6">
          <section role="dialog" aria-modal="true" aria-label="Review move-out request"
            className="w-full max-w-lg rounded-t-2xl bg-[#edfdf3] p-6 shadow-2xl sm:rounded-2xl">
            <div className="flex items-center justify-between">
              <h2 className="font-['Newsreader'] text-2xl font-semibold">
                {decision === 'accepted' ? 'Accept move-out request?' : 'Decline move-out request?'}
              </h2>
              <button type="button" disabled={saving} onClick={() => setRequestBeingReviewed(null)} aria-label="Close"
                className="rounded-lg bg-white p-2 disabled:opacity-40"><span className="material-symbols-outlined">close</span></button>
            </div>
            <p className="mt-3 text-sm leading-6 text-[#424845]">
              Proposed move-out: <strong>{formattedDate(requestBeingReviewed.proposed_move_out_date)}</strong>.
              {decision === 'accepted'
                ? ' Accepting places the lease in Notice given. It does not perform the inspection, settle the deposit or issue a final invoice.'
                : ' Declining keeps the current lease status. The tenant receives your reason.'}
            </p>
            <label className="mt-5 block text-xs font-semibold text-[#424845]">
              {decision === 'declined' ? 'Reason for declining (required)' : 'Decision note (optional)'}
              <textarea rows={3} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)}
                placeholder={decision === 'declined' ? 'Explain why this move-out request cannot be accepted' : 'Add a note if needed'}
                className="mt-2 w-full rounded-xl border border-[#dcece2] bg-white p-3 text-sm outline-none focus:ring-2 focus:ring-[#1e6a59]"/>
            </label>
            {actionError && <p role="alert" className="mt-3 text-xs text-[#93000a]">{actionError}</p>}
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" disabled={saving} onClick={() => setRequestBeingReviewed(null)}
                className="rounded-xl px-4 py-2.5 text-sm font-semibold text-[#424845]">Cancel</button>
              <button type="button" disabled={saving} onClick={() => void submitReview()}
                className="rounded-xl bg-[#10211c] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                {saving ? 'Saving…' : decision === 'accepted' ? 'Confirm acceptance' : 'Confirm decline'}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
