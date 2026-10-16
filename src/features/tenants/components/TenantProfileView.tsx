import { useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import MoveOutSuite from './MoveOutSuite'
import {
  decideMoveOutRequest, updateTenantContactDetails,
  type TenantProfile, type TenantMoveOutRequest, type TenantInvoice,
} from '../data/tenantManagementRepository'
import {
  Icon, Detail, SectionHeading, Status, currentLease,
  dateLabel, daysUntil, initials, leaseStatus, money, monthLabel,
} from './tenantUi'

type Props = {
  organizationId: string
  profile: TenantProfile
  onRefresh: () => void
}

type Tab = 'overview' | 'invoices' | 'lease' | 'requests' | 'moveout' | 'history'

const tabs: {id:Tab; title:string; icon:string}[] = [
  {id:'overview',title:'Overview',icon:'space_dashboard'},
  {id:'invoices',title:'Billing & Balances',icon:'account_balance_wallet'},
  {id:'lease',title:'Lease Details',icon:'history_edu'},
  {id:'requests',title:'Move-out Requests',icon:'outbox'},
  {id:'moveout',title:'Inspection & Settlement',icon:'assignment_turned_in'},
  {id:'history',title:'Tenancy History',icon:'history'},
]

function InfoCard({ title, icon, action, children }: {
  title: string; icon: string; action?: ReactNode; children: ReactNode
}) {
  return (
    <section className="ts-surface ts-info-card">
      <div className="ts-card-heading"><span className="ts-card-icon"><Icon name={icon}/></span>
        <h3>{title}</h3>{action}
      </div>
      {children}
    </section>
  )
}

function MiniStat({ label, value, icon, detail, attention }: {
  label: string; value: string; icon: string; detail?: string; attention?: boolean
}) {
  return (
    <div className={`ts-metric ts-metric--profile ${attention ? 'ts-metric--debt' : ''}`}>
      <div className="ts-metric-head"><span>{label}</span><Icon name={icon}/></div>
      <div className="ts-metric-value ts-metric-value--money">{value}</div>
      {detail && <div className="ts-metric-footer">{detail}</div>}
    </div>
  )
}

function InvoiceRow({ invoice }: { invoice: TenantInvoice }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <article className="ts-invoice">
      <button type="button" className="ts-invoice-trigger" aria-expanded={expanded}
        onClick={() => setExpanded(v => !v)}>
        <div className="ts-invoice-ident">
          <span className="ts-invoice-icon"><Icon name="receipt_long"/></span>
          <div><strong>{invoice.invoice_number}</strong>
            <p>{monthLabel(invoice.billing_period_start)} · Due {dateLabel(invoice.due_date)}</p>
          </div>
        </div>
        <div className="ts-invoice-amount"><strong>{money(invoice.outstanding_amount,true)}</strong><small>Recorded outstanding</small></div>
        <Status status={invoice.status}/>
        <Icon name={expanded ? 'expand_less' : 'expand_more'}/>
      </button>
      {expanded && (
        <div className="ts-invoice-body">
          <div className="ts-detail-grid ts-detail-grid--four">
            <Detail label="New charges" value={money(invoice.current_charges)}/>
            <Detail label="Balance brought forward" value={money(invoice.previous_balance)}/>
            <Detail label="Total invoiced" value={money(invoice.total_payable)}/>
            <Detail label="Paid amount" value={money(invoice.paid_amount)}/>
          </div>
          <div className="ts-source-panel">
            <div className="ts-source-heading"><Icon name="account_tree"/><strong>Carried-forward balance origins</strong></div>
            {invoice.carriedFrom.length > 0 ? (
              invoice.carriedFrom.map((source,index) => (
                <div key={index} className="ts-source-line">
                  <span><Icon name="subdirectory_arrow_right"/> {source.invoice_number}</span>
                  <strong>{money(source.amount)}</strong>
                </div>
              ))
            ) : (
              <p>{invoice.previous_balance > 0
                ? 'Source invoice links are not available for this carried balance.'
                : 'No balance carried forward for this invoice.'}</p>
            )}
            <p className="ts-muted-note">Carried balances originated on older invoices; they are not new charges for the current month.</p>
          </div>
        </div>
      )}
    </article>
  )
}

export default function TenantProfileView({ organizationId, profile, onRefresh }: Props) {
  const [searchParams,setSearchParams] = useSearchParams()
  const fromUrl = searchParams.get('view')
  const tab:Tab = tabs.some(t => t.id === fromUrl) ? fromUrl as Tab : 'overview'
  const lease = currentLease(profile)
  const requests = profile.requests
  const pending = requests.filter(r => r.status === 'pending')
  const [editOpen, setEditOpen] = useState(false)
  const [editName, setEditName] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [editing, setEditing] = useState(false)
  const [reviewRequest, setReviewRequest] = useState<TenantMoveOutRequest | null>(null)
  const [reviewDecision, setReviewDecision] = useState<'accepted'|'declined'>('accepted')
  const [reviewReason, setReviewReason] = useState('')
  const [reviewing,setReviewing] = useState(false)
  const [modalError,setModalError] = useState('')
  const [success,setSuccess] = useState('')

  function setTab(next:Tab) { setSearchParams({view:next}) }
  function startEdit() {
    setEditName(profile.tenant.full_name)
    setEditEmail(profile.tenant.email)
    setEditPhone(profile.tenant.phone)
    setModalError('')
    setEditOpen(true)
  }
  async function submitEdit(event: React.FormEvent) {
    event.preventDefault()
    if (editing) return
    setEditing(true)
    setModalError('')
    try {
      await updateTenantContactDetails(organizationId,profile.tenant.id,{
        full_name:editName,email:editEmail,phone:editPhone,
      })
      setEditOpen(false)
      setSuccess('Tenant contact details updated.')
      onRefresh()
    } catch(error) {
      setModalError(error instanceof Error ? error.message : 'Unable to save changes.')
    } finally { setEditing(false) }
  }
  function startReview(request:TenantMoveOutRequest,decision:'accepted'|'declined') {
    setReviewRequest(request)
    setReviewDecision(decision)
    setReviewReason('')
    setModalError('')
  }
  async function submitReview(event: React.FormEvent) {
    event.preventDefault()
    if(!reviewRequest || reviewing) return
    if (reviewDecision === 'declined' && !reviewReason.trim()) {
      setModalError('A reason is required when declining a move-out request.')
      return
    }
    setReviewing(true)
    setModalError('')
    try {
      await decideMoveOutRequest(reviewRequest.id,reviewDecision,reviewReason.trim() || null)
      setReviewRequest(null)
      setSuccess(reviewDecision === 'accepted'
        ? 'Notice accepted. The move-out inspection and final settlement are still pending.'
        : 'Request declined. The tenant will be notified.')
      onRefresh()
    } catch(error) {
      setModalError(error instanceof Error ? error.message : 'Could not review this request.')
    } finally { setReviewing(false) }
  }

  const completedTime = lease ? Math.max(0, -daysUntil(lease.start_date)) : 0
  const totalTime = lease ? Math.max(1, Math.round((Date.parse(lease.end_date) - Date.parse(lease.start_date))/86400000)) : 1
  const leaseProgress = Math.min(100, Math.round(completedTime/totalTime*100))

  return (
    <div className="ts-stack-xl">
      <div className="ts-breadcrumb">
        <Link to="/tenants"><Icon name="arrow_back"/> Back to tenants</Link>
        <span>/</span><span>{lease?.propertyName ?? 'Tenants'}</span><span>/</span>
        <strong>{profile.tenant.full_name}</strong>
      </div>
      {success && <div role="status" className="ts-toast-inline"><Icon name="check_circle"/>{success}</div>}
      <section className="ts-surface ts-profile-hero">
        <div className="ts-profile-main">
          <span className="ts-avatar ts-avatar--large">{initials(profile.tenant.full_name)}</span>
          <div className="ts-profile-copy">
            <div className="ts-profile-name-line"><h1>{profile.tenant.full_name}</h1>{lease && <Status status={lease.status}/>}</div>
            <p className="ts-profile-location"><Icon name="apartment"/> {lease ? `${lease.propertyName} · ${lease.unitName}` : 'No current unit'}</p>
            <div className="ts-profile-contacts">
              <a href={`tel:${profile.tenant.phone}`}><Icon name="call"/>{profile.tenant.phone}</a>
              <a href={`mailto:${profile.tenant.email}`}><Icon name="mail"/>{profile.tenant.email}</a>
            </div>
          </div>
        </div>
        <div className="ts-profile-actions">
          <button type="button" className="ts-button ts-button--secondary" onClick={startEdit}><Icon name="edit"/> Edit details</button>
          {pending.length > 0 && (
            <button type="button" className="ts-button ts-button--primary"
              onClick={() => setTab('requests')}><Icon name="outbox"/> Review notice</button>
          )}
        </div>
      </section>

      <div className="ts-metrics ts-metrics--profile">
        <MiniStat icon="payments" label="Agreed rent" value={lease ? money(lease.rent_amount,true) : '—'}
          detail={lease ? `Due day ${lease.due_day} · ${lease.billing_frequency}` : 'No current agreement'}/>
        <MiniStat icon="account_balance_wallet" label="Account balance"
          value={profile.balance === null ? 'Unavailable' : money(profile.balance,true)}
          detail={profile.balance === null ? 'See the billing history' : 'From recorded invoice ledger'}
          attention={profile.balance !== null && profile.balance > 0}/>
        <MiniStat icon="event" label="Lease ends" value={dateLabel(lease?.end_date)}
          detail={lease ? `${leaseStatus(lease.status)} tenancy` : 'No lease on record'}/>
        <MiniStat icon="savings" label="Deposit agreed" value={lease ? money(lease.deposit_amount,true) : '—'}
          detail="Lease amount, not confirmed deposit held"/>
      </div>

      <div className="ts-tabs" role="tablist" aria-label="Tenant details">
        {tabs.map(item => (
          <button type="button" key={item.id} role="tab" aria-selected={tab===item.id}
            className={`ts-tab ${tab===item.id ? 'ts-tab--active' : ''}`} onClick={() => setTab(item.id)}>
            <Icon name={item.icon}/>{item.title}
            {item.id === 'requests' && pending.length > 0 && <span className="ts-tab-count">{pending.length}</span>}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="ts-two-columns">
          <div className="ts-stack-lg">
            <InfoCard icon="real_estate_agent" title="Property & tenancy">
              {lease ? <>
                <div className="ts-detail-grid">
                  <Detail label="Property" value={lease.propertyName} icon="apartment"/>
                  <Detail label="Unit designation" value={lease.unitName} icon="meeting_room"/>
                  <Detail label="Building" value={lease.buildingName} icon="domain"/>
                  <Detail label="Floor" value={lease.floorName} icon="layers"/>
                  <Detail label="Start date" value={dateLabel(lease.start_date)} icon="event_available"/>
                  <Detail label="End date" value={dateLabel(lease.end_date)} icon="event"/>
                </div>
                <div className="ts-inline-progress">
                  <div><strong>Lease term</strong><span>{leaseProgress}% elapsed</span></div>
                  <div className="ts-progress-track"><span style={{width:`${leaseProgress}%`}}/></div>
                </div>
              </> : <p className="ts-empty-small">No current tenancy found.</p>}
            </InfoCard>
            <InfoCard icon="history" title="Recent tenancy events">
              <div className="ts-timeline">
                {requests.slice(0,3).map(r => (
                  <div className="ts-timeline-item" key={r.id}>
                    <span className="ts-timeline-icon"><Icon name="outbox"/></span>
                    <div><strong>Move-out request: {leaseStatus(r.status)}</strong>
                      <p>Requested {dateLabel(r.proposed_move_out_date)} · Submitted {dateLabel(r.submitted_at)}</p></div>
                  </div>
                ))}
                {profile.invoices.slice(0,3).map(i => (
                  <div className="ts-timeline-item" key={i.id}>
                    <span className="ts-timeline-icon"><Icon name="receipt_long"/></span>
                    <div><strong>Invoice {i.invoice_number}</strong><p>{monthLabel(i.billing_period_start)} · {money(i.total_payable,true)}</p></div>
                  </div>
                ))}
                {!requests.length && !profile.invoices.length && <p className="ts-empty-small">No recent invoice or request activity recorded.</p>}
              </div>
            </InfoCard>
          </div>
          <div className="ts-stack-lg">
            <InfoCard icon="contact_page" title="Tenant information"
              action={<button className="ts-link-action" onClick={startEdit}><Icon name="edit"/> Edit</button>}>
              <div className="ts-stack-sm">
                <Detail label="Full name" value={profile.tenant.full_name}/>
                <Detail label="Email" value={profile.tenant.email}/>
                <Detail label="Phone" value={profile.tenant.phone}/>
                <Detail label="Dwellio account" value={profile.tenant.user_id ? 'Account linked' : 'Not linked yet'}/>
                <Detail label="Date of birth" value={dateLabel(profile.tenant.date_of_birth)}/>
              </div>
            </InfoCard>
            <InfoCard icon="contact_emergency" title="Emergency contacts">
              {profile.contacts.length ? profile.contacts.map((c,i) => (
                <div className="ts-contact-row" key={i}>
                  <span className="ts-contact-avatar"><Icon name="person"/></span>
                  <div><strong>{c.full_name}</strong><p>{c.relationship}</p><a href={`tel:${c.phone}`}>{c.phone}</a></div>
                </div>
              )) : <p className="ts-empty-small">No emergency contact on record.</p>}
            </InfoCard>
            {pending.length > 0 && (
              <div className="ts-hint-card">
                <Icon name="outbox"/><div><strong>Move-out request awaiting review</strong>
                  <p>A tenant has submitted a notice requiring a landlord decision.</p>
                  <button type="button" className="ts-link-action" onClick={() => setTab('requests')}>Review request <Icon name="arrow_forward"/></button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'invoices' && (
        <div className="ts-stack-lg">
          <InfoCard title="Billing & balances" icon="account_balance_wallet">
            <div className="ts-billing-summary">
              <div className="ts-ledger-highlight">
                <p className="ts-eyebrow">Current tenant account balance</p>
                <strong>{profile.balance === null ? 'Balance unavailable' : money(profile.balance)}</strong>
                <p>{profile.balance === null
                  ? 'Some invoice records need verification before the current balance can be displayed.'
                  : 'Calculated from recorded invoice outstanding values and linked carry-forward sources.'}</p>
              </div>
              <div className="ts-ledger-side">
                <Detail label="Finalized invoices" value={String(profile.invoices.filter(i=>i.status!=='void').length)}/>
                <Detail label="Latest billing month" value={profile.invoices[0] ? monthLabel(profile.invoices[0].billing_period_start) : '—'}/>
              </div>
            </div>
            {profile.balance === null && (
              <div className="ts-soft-notice"><Icon name="info"/>
                <span>The individual invoice records remain available below. We won't show an unverified account total.</span>
              </div>
            )}
          </InfoCard>
          <section className="ts-surface ts-info-card">
            <SectionHeading eyebrow="Invoice register" title="Historical invoices & carried balances"
              aside={<span className="ts-counter">{profile.invoices.length} invoices</span>}/>
            {profile.invoices.length ? <div className="ts-invoice-list">
              {profile.invoices.map(i => <InvoiceRow key={i.id} invoice={i}/>)}
            </div> : <div className="ts-empty-state ts-empty-state--compact">
              <Icon name="receipt_long"/><h3>No invoices yet</h3><p>Finalized invoices will appear here when billing is completed.</p>
            </div>}
          </section>
        </div>
      )}

      {tab === 'lease' && (
        <div className="ts-stack-lg">
          <InfoCard icon="history_edu" title="Lease agreement & terms">
            {lease ? <>
              <div className="ts-agreement-header">
                <div><p className="ts-eyebrow">Tenancy agreement</p>
                  <h3>{lease.propertyName} · {lease.unitName}</h3>
                  <p>{dateLabel(lease.start_date)} – {dateLabel(lease.end_date)}</p>
                </div>
                <Status status={lease.status}/>
              </div>
              <div className="ts-detail-grid ts-detail-grid--four">
                <Detail label="Agreed rent" value={money(lease.rent_amount)} icon="payments"/>
                <Detail label="Security deposit agreed" value={money(lease.deposit_amount)} icon="savings"/>
                <Detail label="Billing frequency" value={lease.billing_frequency} icon="event_repeat"/>
                <Detail label="Due day" value={String(lease.due_day)} icon="today"/>
                <Detail label="Grace period" value={`${lease.grace_period_days} days`} icon="schedule"/>
                <Detail label="Lease starts" value={dateLabel(lease.start_date)} icon="event_available"/>
                <Detail label="Lease expires" value={dateLabel(lease.end_date)} icon="event_busy"/>
                <Detail label="Notice date" value={dateLabel(lease.notice_date)} icon="outbox"/>
                <Detail label="Planned move-out" value={dateLabel(lease.move_out_date)} icon="moving"/>
              </div>
              <div className="ts-inline-progress">
                <div><strong>Tenancy term elapsed</strong><span>{leaseProgress}%</span></div>
                <div className="ts-progress-track"><span style={{width:`${leaseProgress}%`}}/></div>
              </div>
            </> : <p className="ts-empty-small">No lease recorded for this tenant.</p>}
          </InfoCard>
          {lease?.status === 'notice_given' && (
            <InfoCard title="Move-out process" icon="assignment">
              <p className="ts-muted-note">Notice is recorded. The tenant's move-out is not yet finalized.</p>
              <div className="ts-steps">
                {[
                  ['check_circle','Notice accepted','complete'],
                  ['pending_actions','Move-out inspection','future'],
                  ['pending_actions','Deposit deductions','future'],
                  ['pending_actions','Final invoice & settlement','future'],
                ].map(([icon,title,kind]) => <div key={title} className={`ts-step ts-step--${kind}`}>
                  <span><Icon name={icon}/></span><strong>{title}</strong><small>{kind==='complete'?'Recorded':'Future module'}</small>
                </div>)}
              </div>
            </InfoCard>
          )}
        </div>
      )}

      {tab === 'requests' && (
        <section className="ts-surface ts-info-card">
          <SectionHeading eyebrow="Notice & departures" title="Move-out requests"
            aside={<span className="ts-counter">{pending.length} pending</span>}/>
          <p className="ts-muted-note">Accepting a request records notice on the lease. Inspection, deposits and final settlement remain separate later steps.</p>
          {requests.length ? <div className="ts-request-list">
            {requests.map(r => (
              <article className="ts-request-card" key={r.id}>
                <div className="ts-request-top">
                  <span className="ts-attention-icon ts-attention-icon--mint"><Icon name="outbox"/></span>
                  <div><p className="ts-eyebrow">Requested departure</p><h3>{dateLabel(r.proposed_move_out_date)}</h3>
                    <p className="ts-muted-note">Submitted {dateLabel(r.submitted_at)}</p></div>
                  <Status status={r.status}/>
                </div>
                <div className="ts-request-reason">
                  <span>Tenant's reason</span><p>{r.reason || 'No reason given.'}</p>
                </div>
                {r.decision_reason && <p className="ts-muted-note">Decision note: {r.decision_reason}</p>}
                {r.status === 'pending' && (
                  <div className="ts-request-actions">
                    <button type="button" className="ts-button ts-button--primary" onClick={() => startReview(r,'accepted')}>
                      <Icon name="check_circle"/> Accept request
                    </button>
                    <button type="button" className="ts-button ts-button--danger" onClick={() => startReview(r,'declined')}>
                      <Icon name="cancel"/> Decline
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div> : <div className="ts-empty-state ts-empty-state--compact"><Icon name="move_up"/><h3>No move-out requests</h3><p>Tenant-submitted notices will appear here for review.</p></div>}
          <div className="ts-future-panel">
            <h3>Move-out inspection & settlement</h3>
            <p>After accepted notice, a future workflow will handle condition inspection, deposit allocations, final invoice and move-out completion.</p>
            <span><Icon name="schedule"/> Planned for a later phase</span>
          </div>
        </section>
      )}

      {tab === 'moveout' && (lease ? <MoveOutSuite organizationId={organizationId} profile={profile} lease={lease} onRefresh={onRefresh}/> :
        <InfoCard icon="info" title="No lease available"><p className="ts-muted-note">An inspection requires an existing tenancy.</p></InfoCard>)}

      {tab === 'history' && (
        <InfoCard icon="history" title="Tenancy history">
          {profile.leases.length ? <div className="ts-history">
            {profile.leases.map(l => (
              <div key={l.id} className="ts-history-item">
                <span className="ts-history-marker"><Icon name="home"/></span>
                <div className="ts-history-body">
                  <div><h3>{l.propertyName} · {l.unitName}</h3><Status status={l.status}/></div>
                  <p>{l.buildingName} · {l.floorName}</p>
                  <div className="ts-history-meta"><span><Icon name="date_range"/> {dateLabel(l.start_date)} – {dateLabel(l.end_date)}</span>
                    <span><Icon name="payments"/> {money(l.rent_amount,true)} / {l.billing_frequency}</span></div>
                </div>
              </div>
            ))}
          </div> : <p className="ts-empty-small">No tenancy history yet.</p>}
        </InfoCard>
      )}

      {editOpen && (
        <div className="ts-modal-shade">
          <form onSubmit={e => void submitEdit(e)} className="ts-modal" role="dialog" aria-modal="true" aria-label="Edit tenant details">
            <div className="ts-modal-heading"><span className="ts-card-icon"><Icon name="edit"/></span><div><p className="ts-eyebrow">Resident information</p><h2>Edit tenant details</h2></div>
              <button type="button" className="ts-icon-button" onClick={() => setEditOpen(false)} disabled={editing} aria-label="Close"><Icon name="close"/></button>
            </div>
            <p className="ts-muted-note">Update contact details only. Identification and lease terms will not change.</p>
            <div className="ts-form-stack">
              <label>Full name<input required minLength={2} maxLength={150} value={editName} onChange={e=>setEditName(e.target.value)}/></label>
              <label>Email<input type="email" required value={editEmail} onChange={e=>setEditEmail(e.target.value)}/></label>
              <label>Phone<input type="tel" required minLength={7} maxLength={30} value={editPhone} onChange={e=>setEditPhone(e.target.value)}/></label>
            </div>
            {modalError && <p role="alert" className="ts-form-error">{modalError}</p>}
            <div className="ts-modal-actions">
              <button type="button" className="ts-button ts-button--secondary" onClick={()=>setEditOpen(false)} disabled={editing}>Cancel</button>
              <button type="submit" className="ts-button ts-button--primary" disabled={editing}>{editing?'Saving…':'Save changes'}</button>
            </div>
          </form>
        </div>
      )}

      {reviewRequest && (
        <div className="ts-modal-shade">
          <form onSubmit={e => void submitReview(e)} className="ts-modal" role="dialog" aria-modal="true" aria-label="Review move-out request">
            <div className="ts-modal-heading"><span className="ts-card-icon"><Icon name={reviewDecision==='accepted'?'verified':'cancel'}/></span><div>
              <p className="ts-eyebrow">Landlord authorization</p><h2>{reviewDecision==='accepted'?'Accept move-out notice?':'Decline move-out notice?'}</h2></div>
              <button type="button" disabled={reviewing} className="ts-icon-button" onClick={()=>setReviewRequest(null)} aria-label="Close"><Icon name="close"/></button>
            </div>
            <p className="ts-muted-note">Proposed departure: <strong>{dateLabel(reviewRequest.proposed_move_out_date)}</strong>.</p>
            <div className="ts-soft-notice"><Icon name="info"/>
              <span>{reviewDecision==='accepted'
                ? 'Acceptance updates the lease to Notice given. It does not issue a final invoice, deduct any deposit or mark the unit vacant.'
                : 'Declining preserves the lease status and notifies the tenant with your reason.'}</span>
            </div>
            <div className="ts-form-stack"><label>{reviewDecision==='declined'?'Reason for declining (required)':'Decision note (optional)'}
              <textarea rows={3} required={reviewDecision==='declined'} maxLength={1000} value={reviewReason} onChange={e=>setReviewReason(e.target.value)}/>
            </label></div>
            {modalError && <p role="alert" className="ts-form-error">{modalError}</p>}
            <div className="ts-modal-actions">
              <button type="button" className="ts-button ts-button--secondary" onClick={()=>setReviewRequest(null)} disabled={reviewing}>Cancel</button>
              <button type="submit" className={`ts-button ${reviewDecision==='declined'?'ts-button--danger':'ts-button--primary'}`} disabled={reviewing}>
                {reviewing?'Saving…':reviewDecision==='declined'?'Confirm decline':'Confirm acceptance'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
