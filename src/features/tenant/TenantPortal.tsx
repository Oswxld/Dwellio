import { useCallback, useEffect, useState } from 'react'
import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import {
  fetchTenantMoveOutRequests,
  fetchTenantPortal,
  submitTenantMoveOutRequest,
  type TenantMoveOutRequest,
  type TenantPortalSnapshot,
} from './data/tenantPortalRepository'
import '../../styles/tenant-portal.css'

function Icon({ name, className = '' }: { name: string; className?: string }) {
  return <span aria-hidden="true" className={`material-symbols-outlined ${className}`}>{name}</span>
}

function money(amount: number | null | undefined) {
  return typeof amount === 'number' && Number.isFinite(amount)
    ? `KSh ${new Intl.NumberFormat('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)}`
    : '—'
}

function dateLabel(value: string | null | undefined) {
  if (!value) return 'Not set'
  const date = new Date(`${value.slice(0, 10)}T12:00:00`)
  return Number.isNaN(date.getTime())
    ? 'Not set'
    : date.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })
}

function leaseStatus(status: string | undefined) {
  const names: Record<string, string> = {
    active: 'Active',
    notice_given: 'Notice given',
    not_moved_in_yet: 'Awaiting move-in',
    pending_confirmation: 'Pending confirmation',
    expired: 'Expired',
    terminated: 'Terminated',
    declined: 'Declined',
  }
  return status ? (names[status] ?? status.replaceAll('_', ' ')) : 'No lease'
}

function greeting() {
  const hour = Number(new Intl.DateTimeFormat('en-GB', {
    hour: 'numeric', hour12: false, timeZone: 'Africa/Nairobi',
  }).format(new Date()))
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <section className={`tenant-card ${className}`}>{children}</section>
}

function ScreenTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return <div className="tenant-screen-title">
    <Link className="tenant-back" to="/tenant" aria-label="Return home"><Icon name="arrow_back" /></Link>
    <div><h1>{title}</h1><p>{subtitle}</p></div>
  </div>
}

function TenantHome({ snapshot }: { snapshot: TenantPortalSnapshot }) {
  const [paymentHelp, setPaymentHelp] = useState(false)
  const firstName = snapshot.tenant.full_name.split(' ')[0] || 'there'
  const lease = snapshot.lease
  return <>
    <div className="tenant-greeting">
      <div>
        <div className="tenant-eyebrow">DWELLIO · TENANT PORTAL</div>
        <h1>{greeting()}, {firstName}</h1>
        <p>Here's what's happening with your home.</p>
      </div>
      <Link to="/tenant/profile" className="tenant-avatar" aria-label="Personal information">
        {snapshot.tenant.full_name.split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase()).join('')}
      </Link>
    </div>

    <div className="tenant-home-vignette">
      <div className="tenant-vignette-arch" aria-hidden="true" />
      <div className="tenant-vignette-copy">
        <Icon name="other_houses" />
        <span>{lease ? `${lease.property_name} · ${lease.unit_name}` : 'Your home, simplified'}</span>
      </div>
    </div>

    <Card className="tenant-balance">
      <div className="tenant-between">
        <span className="tenant-card-label"><span className="tenant-live-dot" /> Outstanding balance</span>
        <span className="tenant-chip tenant-chip-soft">Billing</span>
      </div>
      <div className="tenant-balance-value">{money(snapshot.outstanding_balance)}</div>
      <p className="tenant-muted">
        {snapshot.outstanding_balance === null
          ? 'Invoice balances will appear after billing is connected.'
          : snapshot.outstanding_balance > 0
            ? 'Your current unpaid invoice balance'
            : 'No outstanding amount recorded'}
      </p>
      <button className="tenant-primary-button" type="button" onClick={() => setPaymentHelp(true)}>
        <span className="tenant-mpesa-brand">M</span> Pay with M-Pesa <Icon name="arrow_forward" />
      </button>
    </Card>

    <div className="tenant-section-heading">
      <h2>Current lease</h2>
      {lease && <span className="tenant-chip">{leaseStatus(lease.status)}</span>}
    </div>
    <Card>
      {lease ? <>
        <div className="tenant-property-title">
          <span className="tenant-square-icon"><Icon name="apartment" /></span>
          <div><strong>{lease.property_name}</strong><span>Unit {lease.unit_name} · {lease.building_name}</span></div>
        </div>
        <div className="tenant-two-up">
          <div><span>Monthly rent</span><strong>{money(Number(lease.rent_amount))}</strong></div>
          <div><span>Lease end date</span><strong>{dateLabel(lease.end_date)}</strong></div>
        </div>
        <Link to="/tenant/lease" className="tenant-text-link">View lease details <Icon name="arrow_forward" /></Link>
      </> : <p className="tenant-muted">No lease is linked to this tenant profile yet.</p>}
    </Card>

    <div className="tenant-section-heading tenant-quick-title"><h2>Quick access</h2></div>
    <div className="tenant-quick-list">
      {[
        { to: '/tenant/invoices', icon: 'receipt_long', label: 'Invoices & Payments', description: 'View bills and payment history' },
        { to: '/tenant/lease', icon: 'description', label: 'My Lease', description: 'Your tenancy agreement and details' },
        { to: '/tenant/profile', icon: 'person', label: 'Personal Information', description: 'Your registered tenant information' },
        { to: '/tenant/lease#move-out', icon: 'door_front', label: 'Move-Out Requests', description: 'Request or track a move-out notice' },
      ].map(item => (
        <Link className="tenant-quick-row" to={item.to} key={item.to}>
          <span className="tenant-square-icon"><Icon name={item.icon} /></span>
          <div><strong>{item.label}</strong><span>{item.description}</span></div>
          <Icon name="chevron_right" />
        </Link>
      ))}
    </div>

    {paymentHelp && <div className="tenant-overlay" role="presentation" onClick={() => setPaymentHelp(false)}>
      <div className="tenant-dialog" role="dialog" aria-modal="true" aria-label="M-Pesa payment information" onClick={event => event.stopPropagation()}>
        <div className="tenant-dialog-header"><h2>M-Pesa payments</h2><button type="button" onClick={() => setPaymentHelp(false)} aria-label="Close"><Icon name="close" /></button></div>
        <div className="tenant-square-icon"><Icon name="smartphone" /></div>
        <p>STK Push integration is coming in the next development step. No payment has been initiated.</p>
        <p className="tenant-muted">When available, Safaricom will send the PIN prompt to your phone. You'll never enter your M-Pesa PIN on Dwellio.</p>
        <button className="tenant-primary-button" onClick={() => setPaymentHelp(false)} type="button">Got it</button>
      </div>
    </div>}
  </>
}

function TenantProfile({ snapshot }: { snapshot: TenantPortalSnapshot }) {
  const tenant = snapshot.tenant
  const contact = snapshot.emergency_contact
  const [help, setHelp] = useState(false)
  const details = [
    ['Full legal name', tenant.full_name],
    ['Email address', tenant.email],
    ['Phone number', tenant.phone],
    ['Identification type', tenant.identification_type.replaceAll('_', ' ')],
    ['Identification number', tenant.masked_identification_number || 'Not provided'],
    ['Date of birth', dateLabel(tenant.date_of_birth)],
  ]
  return <>
    <ScreenTitle title="Personal Information" subtitle="Your registered tenancy information" />
    <Card className="tenant-profile-hero">
      <div className="tenant-profile-person">
        <span className="tenant-avatar tenant-avatar-large">
          {tenant.full_name.split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase()).join('')}
        </span>
        <div><h2>{tenant.full_name}</h2>
          <p>Tenant{snapshot.lease ? ` · ${snapshot.lease.property_name}, ${snapshot.lease.unit_name}` : ''}</p>
          <span className="tenant-registered"><Icon name="verified_user" /> Registered resident profile</span>
        </div>
      </div>
      <div className="tenant-readonly-strip"><span><Icon name="shield" /> Official tenancy record</span><span><Icon name="lock" /> Read-only</span></div>
    </Card>
    <Card>
      <div className="tenant-card-heading"><Icon name="badge" /><h2>Identification & Contact</h2></div>
      <div className="tenant-detail-list">
        {details.map(([label, value]) => <div className="tenant-detail" key={label}>
          <div><span>{label}</span><strong>{value}</strong></div><Icon name="lock" />
        </div>)}
      </div>
    </Card>
    <Card>
      <div className="tenant-between tenant-card-heading"><div><Icon name="contact_emergency" /><h2>Emergency Contact</h2></div><span className="tenant-chip">Primary</span></div>
      {contact ? <div className="tenant-emergency">
        <div className="tenant-detail"><div><span>Contact person</span><strong>{contact.full_name}</strong></div><Icon name="family_restroom" /></div>
        <div className="tenant-two-up"><div><span>Relationship</span><strong>{contact.relationship}</strong></div><div><span>Phone</span><strong>{contact.phone}</strong></div></div>
      </div> : <p className="tenant-muted">No emergency contact recorded.</p>}
    </Card>
    <div className="tenant-info-card">
      <div className="tenant-card-heading"><Icon name="info" /><h2>Information updates</h2></div>
      <p>To correct your registered information, contact your property management team. These records cannot be edited in the tenant portal.</p>
      <button type="button" className="tenant-outline-button" onClick={() => setHelp(!help)}>Contact property management <Icon name="arrow_forward" /></button>
      {help && <p className="tenant-help-note">Please contact your property manager using their existing official contact details. An in-app support request is not available yet.</p>}
    </div>
  </>
}

function TenantLease({ snapshot }: { snapshot: TenantPortalSnapshot }) {
  const lease = snapshot.lease
  const location = useLocation()
  const [requests, setRequests] = useState<TenantMoveOutRequest[]>([])
  const [requestError, setRequestError] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [date, setDate] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const refreshRequests = useCallback(async () => {
    if (!lease) return
    const rows = await fetchTenantMoveOutRequests(lease.id)
    setRequests(rows)
    setRequestError('')
  }, [lease?.id])

  useEffect(() => {
    if (!lease) return
    void refreshRequests().catch(error => {
      setRequestError(error instanceof Error ? error.message : 'Could not load move-out requests.')
    })
  }, [lease?.id, refreshRequests])

  useEffect(() => {
    if (location.hash === '#move-out') {
      requestAnimationFrame(() => document.getElementById('move-out')?.scrollIntoView({ block: 'center' }))
    }
  }, [location.hash])

  if (!lease) return <>
    <ScreenTitle title="My Lease" subtitle="Your current tenancy agreement" />
    <Card><p className="tenant-muted">No lease is linked to your account. Please contact property management.</p></Card>
  </>

  const pending = requests.find(r => r.status === 'pending')
  const accepted = requests.find(r => r.status === 'accepted')
  const canRequest = lease.status === 'active' && !pending && !accepted
  const start = new Date(`${lease.start_date}T12:00:00`).getTime()
  const end = new Date(`${lease.end_date}T12:00:00`).getTime()
  const progress = end > start ? Math.max(0, Math.min(100, ((Date.now() - start) / (end - start)) * 100)) : 0

  async function sendRequest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setRequestError('')
    try {
      await submitTenantMoveOutRequest(lease!.id, date, reason)
      await refreshRequests()
      setFormOpen(false)
      setDate('')
      setReason('')
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : 'Unable to submit request.')
    } finally {
      setBusy(false)
    }
  }

  return <>
    <ScreenTitle title="My Lease" subtitle="Your current tenancy agreement & schedule" />
    <Card className="tenant-lease-hero">
      <div className="tenant-between">
        <div className="tenant-property-title"><span className="tenant-square-icon"><Icon name="apartment" /></span><div><strong>{lease.property_name}</strong><span>Unit {lease.unit_name}</span></div></div>
        <span className="tenant-chip">{leaseStatus(lease.status)}</span>
      </div>
      <div className="tenant-readonly-strip"><span>Lease reference</span><strong>{lease.id.slice(0, 8).toUpperCase()}</strong></div>
    </Card>

    <Card>
      <div className="tenant-card-heading"><Icon name="location_city" /><h2>Premises information</h2></div>
      <div className="tenant-two-up tenant-lease-grid">
        <div><span>Property</span><strong>{lease.property_name}</strong></div>
        <div><span>Building</span><strong>{lease.building_name}</strong></div>
        <div><span>Floor</span><strong>{lease.floor_name || `Floor ${lease.floor_number}`}</strong></div>
        <div><span>Assigned unit</span><strong>{lease.unit_name}</strong></div>
      </div>
    </Card>

    <Card>
      <div className="tenant-card-heading"><Icon name="gavel" /><h2>Tenancy terms & ledger</h2></div>
      <p className="tenant-muted">Official information recorded under your lease · Read-only</p>
      <div className="tenant-two-up tenant-lease-grid">
        <div><span>Commencement</span><strong>{dateLabel(lease.start_date)}</strong></div>
        <div><span>Expiration</span><strong>{dateLabel(lease.end_date)}</strong></div>
        <div><span>Monthly rent</span><strong className="tenant-money">{money(Number(lease.rent_amount))}</strong></div>
        <div><span>Security deposit</span><strong className="tenant-money">{money(Number(lease.deposit_amount))}</strong></div>
      </div>
      <div className="tenant-detail-list tenant-lease-terms">
        <div className="tenant-term"><span>Payment due day</span><strong>{lease.due_day} of each month</strong></div>
        <div className="tenant-term"><span>Billing frequency</span><strong>{lease.billing_frequency.replaceAll('_', ' ')}</strong></div>
        <div className="tenant-term"><span>Grace period</span><strong>{lease.grace_period_days} days</strong></div>
        <div className="tenant-term"><span>Tenancy status</span><strong>{leaseStatus(lease.status)}</strong></div>
        {lease.notice_date && <div className="tenant-term"><span>Notice date</span><strong>{dateLabel(lease.notice_date)}</strong></div>}
        {lease.move_out_date && <div className="tenant-term"><span>Approved move-out date</span><strong>{dateLabel(lease.move_out_date)}</strong></div>}
      </div>
    </Card>

    <Card>
      <div className="tenant-between"><h2>Lease term progress</h2><span className="tenant-chip">{Math.round(progress)}%</span></div>
      <div className="tenant-progress"><div style={{ width: `${progress}%` }} /></div>
      <div className="tenant-between tenant-muted"><span>{dateLabel(lease.start_date)}</span><span>{dateLabel(lease.end_date)}</span></div>
    </Card>

    <Card className="tenant-moveout-card" >
      <div id="move-out" className="tenant-card-heading"><Icon name="exit_to_app" /><h2>Planning to move out?</h2></div>
      <p className="tenant-muted">Submit a proposed move-out date for your property manager to review. Your lease is not changed merely by submitting a request.</p>

      {pending && <div className="tenant-request-state"><span className="tenant-chip tenant-chip-amber">Awaiting review</span><strong>Proposed move-out: {dateLabel(pending.proposed_move_out_date)}</strong><span>Submitted {dateLabel(pending.submitted_at)}</span></div>}
      {accepted && <div className="tenant-request-state"><span className="tenant-chip">Accepted</span><strong>Approved move-out: {dateLabel(accepted.proposed_move_out_date)}</strong></div>}
      {requests.filter(r => r.status === 'declined').slice(0, 1).map(r =>
        <div className="tenant-request-state" key={r.id}><span className="tenant-chip tenant-chip-danger">Previous request declined</span>
          <span>Proposed date: {dateLabel(r.proposed_move_out_date)}</span><span>Reason: {r.decision_reason || 'Not provided'}</span>
        </div>)}

      {canRequest && <button type="button" className="tenant-primary-button" onClick={() => setFormOpen(!formOpen)}><Icon name="calendar_month" /> {formOpen ? 'Close request form' : 'Request Move-Out'}</button>}
      {formOpen && canRequest && <form className="tenant-request-form" onSubmit={event => void sendRequest(event)}>
        <label>Proposed move-out date<input type="date" required value={date} max={lease.end_date} onChange={event => setDate(event.target.value)} /></label>
        <label>Reason (optional)<textarea value={reason} maxLength={1000} onChange={event => setReason(event.target.value)} rows={3} placeholder="Tell management why you're moving" /></label>
        <p className="tenant-muted">The landlord can accept or decline your date, not change it. Contractual notice obligations may still apply.</p>
        <button type="submit" disabled={busy || !date} className="tenant-primary-button">{busy ? 'Submitting…' : 'Submit request for review'}</button>
      </form>}
      {requestError && <p className="tenant-error" role="alert">{requestError}</p>}
      {lease.status !== 'active' && !pending && !accepted && <p className="tenant-muted">Move-out requests are available for active leases only.</p>}
    </Card>
  </>
}

function TenantInvoicesNext() {
  return <>
    <ScreenTitle title="Invoices & Payments" subtitle="Your rent, utilities and M-Pesa payment history" />
    <Card><div className="tenant-card-heading"><Icon name="receipt_long" /><h2>Billing is next</h2></div>
      <p className="tenant-muted">We're connecting finalized invoices, line-item charges and verified M-Pesa STK Push payments next. No payments can be initiated from this page yet.</p>
      <Link className="tenant-outline-button tenant-link-button" to="/tenant">Back to Home <Icon name="arrow_forward" /></Link>
    </Card>
  </>
}

export default function TenantPortal() {
  const [snapshot, setSnapshot] = useState<TenantPortalSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const location = useLocation()

  const refresh = useCallback(async () => {
    setError('')
    try {
      setSnapshot(await fetchTenantPortal())
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load your account.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const propertyLabel = snapshot?.lease ? `${snapshot.lease.property_name}, Unit ${snapshot.lease.unit_name}` : 'Tenant account'

  if (loading) return <div className="tenant-loading"><div className="spinner" /><p>Loading your home…</p></div>

  if (error || !snapshot) return <div className="tenant-loading tenant-no-account">
    <Icon name="home" /><h1>{error ? 'Unable to load tenant portal' : 'No tenant profile linked'}</h1>
    <p>{error || 'Your account has not yet been linked to a tenant record. Contact your property manager.'}</p>
    {error && <button type="button" className="tenant-primary-button" onClick={() => void refresh()}>Try again</button>}
    <button type="button" className="tenant-outline-button" onClick={() => void supabase.auth.signOut()}>Sign out</button>
  </div>

  return <div className="tenant-portal">
    <header className="tenant-header">
      <div className="tenant-header-inner">
        <Link to="/tenant" className="tenant-brand"><strong>DWELLIO</strong><span>•</span><b>TENANT PORTAL</b><small><i />{propertyLabel}</small></Link>
        <button className="tenant-icon-button" type="button" aria-label="Notifications" onClick={() => setNotificationsOpen(!notificationsOpen)}><Icon name="notifications" /></button>
        <Link className="tenant-header-person" to="/tenant/profile" aria-label="Personal information"><Icon name="person" /></Link>
      </div>
      {notificationsOpen && <div className="tenant-notification-note">Notifications will appear here when the tenant notification inbox is connected.</div>}
    </header>
    <main className="tenant-content" key={location.pathname}>
      <Routes>
        <Route index element={<TenantHome snapshot={snapshot} />} />
        <Route path="lease" element={<TenantLease snapshot={snapshot} />} />
        <Route path="profile" element={<TenantProfile snapshot={snapshot} />} />
        <Route path="invoices" element={<TenantInvoicesNext />} />
        <Route path="*" element={<Navigate to="/tenant" replace />} />
      </Routes>
    </main>
    <nav className="tenant-bottom-nav" aria-label="Tenant navigation">
      {[
        { to: '/tenant', label: 'Home', icon: 'home' },
        { to: '/tenant/invoices', label: 'Invoices', icon: 'receipt_long' },
        { to: '/tenant/lease', label: 'Lease', icon: 'key' },
        { to: '/tenant/profile', label: 'Profile', icon: 'person' },
      ].map(item => <NavLink key={item.to} end={item.to === '/tenant'} to={item.to}
        className={({ isActive }) => `tenant-tab ${isActive ? 'tenant-tab-active' : ''}`}>
        <Icon name={item.icon}/><span>{item.label}</span>
      </NavLink>)}
    </nav>
  </div>
}
