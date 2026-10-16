import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { TenantProfile } from '../data/tenantManagementRepository'
import {
  Icon, SectionHeading, Status, currentLease, dateLabel, daysUntil, initials, leaseStatus, money,
} from './tenantUi'

type Props = { profiles: TenantProfile[] }
type Attention = { id: string; title: string; context: string; kind: string; icon: string; href: string; tone: 'mint'|'amber'|'rose' }

export default function TenantDirectoryView({ profiles }: Props) {
  const [query, setQuery] = useState('')
  const [propertyFilter, setPropertyFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sort, setSort] = useState('name')

  const properties = useMemo(() => {
    const map = new Map<string, string>()
    for (const profile of profiles) for (const lease of profile.leases) {
      if (lease.propertyId) map.set(lease.propertyId, lease.propertyName)
    }
    return [...map].sort((a,b) => a[1].localeCompare(b[1]))
  }, [profiles])

  const active = profiles.filter(p => ['active','notice_given'].includes(currentLease(p)?.status ?? ''))
  const pending = profiles.filter(p => ['pending_confirmation','pending_acceptance'].includes(currentLease(p)?.status ?? ''))
  const missingBalances = profiles.filter(p => p.balance === null)
  const debtors = profiles.filter(p => p.balance !== null && p.balance > 0)
  const pendingRequests = profiles.flatMap(p => p.requests
    .filter(r => r.status === 'pending').map(r => ({ profile: p, request: r })))
  const totalDebt = profiles.reduce((sum,p) => sum + (p.balance ?? 0), 0)

  const attention: Attention[] = [
    ...pendingRequests.map(({profile,request}) => ({
      id: `request-${request.id}`, title: profile.tenant.full_name,
      context: `Requested move-out for ${dateLabel(request.proposed_move_out_date)}. Review the submitted notice.`,
      kind: 'Move-out request', icon: 'outbox', tone: 'mint' as const,
      href: `/tenants/${profile.tenant.id}?view=requests`,
    })),
    ...missingBalances.map(profile => ({
      id: `balance-${profile.tenant.id}`, title: profile.tenant.full_name,
      context: 'Financial summary unavailable. Individual invoices can still be reviewed.',
      kind: 'Balance verification', icon: 'receipt_long', tone: 'amber' as const,
      href: `/tenants/${profile.tenant.id}?view=invoices`,
    })),
    ...pending.map(profile => ({
      id: `pending-${profile.tenant.id}`, title: profile.tenant.full_name,
      context: 'The lease is waiting for tenant acceptance.',
      kind: 'Lease confirmation', icon: 'hourglass_top', tone: 'amber' as const,
      href: `/tenants/${profile.tenant.id}?view=lease`,
    })),
    ...profiles.filter(p => {
      const l = currentLease(p)
      return l && ['active','notice_given'].includes(l.status) && daysUntil(l.end_date) >= 0 && daysUntil(l.end_date) <= 60
    }).map(profile => ({
      id: `expiring-${profile.tenant.id}`, title: profile.tenant.full_name,
      context: `Lease ends ${dateLabel(currentLease(profile)?.end_date)}.`,
      kind: 'Lease expiring', icon: 'event_upcoming', tone: 'amber' as const,
      href: `/tenants/${profile.tenant.id}?view=lease`,
    })),
    ...debtors.map(profile => ({
      id: `debt-${profile.tenant.id}`, title: profile.tenant.full_name,
      context: `Recorded account balance: ${money(profile.balance)}.`,
      kind: 'Outstanding balance', icon: 'account_balance_wallet', tone: 'rose' as const,
      href: `/tenants/${profile.tenant.id}?view=invoices`,
    })),
  ]

  const visible = useMemo(() => {
    const text = query.trim().toLowerCase()
    const filtered = profiles.filter(profile => {
      const l = currentLease(profile)
      const matchesText = !text || [
        profile.tenant.full_name, profile.tenant.phone, profile.tenant.email,
        ...profile.leases.flatMap(lease => [lease.unitName, lease.propertyName, lease.buildingName]),
      ].some(value => value.toLowerCase().includes(text))
      const matchesProperty = propertyFilter === 'all' || profile.leases.some(lease => lease.propertyId === propertyFilter)
      const matchesStatus = statusFilter === 'all' ||
        (statusFilter === 'pending' && ['pending_confirmation','pending_acceptance'].includes(l?.status ?? '')) ||
        (statusFilter === 'former' && (!l || ['expired','terminated','declined'].includes(l.status))) ||
        (statusFilter === 'balance' && profile.balance !== null && profile.balance > 0) ||
        l?.status === statusFilter
      return matchesText && matchesProperty && matchesStatus
    })
    return filtered.sort((a,b) => {
      if (sort === 'unit') return (currentLease(a)?.unitName ?? '').localeCompare(currentLease(b)?.unitName ?? '')
      if (sort === 'balance') return (b.balance ?? -1) - (a.balance ?? -1)
      return a.tenant.full_name.localeCompare(b.tenant.full_name)
    })
  }, [profiles, query, propertyFilter, statusFilter, sort])

  return (
    <div className="ts-stack-xl">
      <header className="ts-hero-heading">
        <div>
          <p className="ts-eyebrow"><Icon name="domain_verification"/> Dwellio / Organization workspace</p>
          <h1 className="ts-page-title">Tenants <span className="ts-title-accent">& Residents</span></h1>
          <p className="ts-subtitle">The people behind your properties, all in one place.</p>
        </div>
        <Link to="/tenants/new" className="ts-button ts-button--primary">
          <Icon name="person_add"/> Add tenant <Icon name="arrow_forward"/>
        </Link>
      </header>

      <div className="ts-metrics">
        <div className="ts-metric ts-metric--hero">
          <div className="ts-metric-head"><span>Organization tenants</span><Icon name="groups"/></div>
          <div className="ts-metric-value">{profiles.length}</div>
          <div className="ts-metric-footer">{active.length} in active or notice-given tenancies</div>
          <div className="ts-progress-track"><span style={{ width: profiles.length ? `${100*active.length/profiles.length}%` : '0%' }}/></div>
        </div>
        <div className="ts-metric">
          <div className="ts-metric-head"><span>Active tenancies</span><Icon name="real_estate_agent"/></div>
          <div className="ts-metric-value">{active.length}</div>
          <div className="ts-metric-footer">{pending.length} lease{pending.length === 1 ? '' : 's'} awaiting acceptance</div>
          <div className="ts-metric-foot-icon"><Icon name="check_circle"/> Live tenancy status</div>
        </div>
        <div className="ts-metric ts-metric--debt">
          <div className="ts-metric-head"><span>Recorded balances</span><Icon name="account_balance_wallet"/></div>
          <div className="ts-metric-value ts-metric-value--money">{missingBalances.length ? 'Some unavailable' : money(totalDebt,true)}</div>
          <div className="ts-metric-footer">{debtors.length} tenant{debtors.length === 1 ? '' : 's'} with positive balance</div>
          <div className="ts-metric-foot-icon"><Icon name="receipt_long"/> {missingBalances.length ? `${missingBalances.length} balances need review` : 'View detailed invoices below'}</div>
        </div>
        <div className="ts-metric">
          <div className="ts-metric-head"><span>Move-out requests</span><Icon name="outbox"/></div>
          <div className="ts-metric-value">{pendingRequests.length}</div>
          <div className="ts-metric-footer">Awaiting landlord decision</div>
          <div className="ts-metric-foot-icon"><Icon name="event_note"/> Notice review workflow</div>
        </div>
      </div>

      <section className="ts-attention">
        <SectionHeading eyebrow="Priority inbox" title="Needs your attention"
          aside={<span className="ts-counter"><span className="ts-pulse-dot"/> {attention.length} open items</span>}/>
        {attention.length ? (
          <div className="ts-attention-grid">
            {attention.slice(0,6).map(item => (
              <Link key={item.id} className="ts-attention-item" to={item.href}>
                <div className="ts-attention-top">
                  <span className={`ts-attention-icon ts-attention-icon--${item.tone}`}><Icon name={item.icon}/></span>
                  <span className="ts-attention-kind">{item.kind}</span>
                  <Icon name="north_east" className="ts-corner-arrow"/>
                </div>
                <h3>{item.title}</h3>
                <p>{item.context}</p>
                <div className="ts-attention-action">Review details <Icon name="arrow_forward"/></div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="ts-empty-inline"><Icon name="verified"/> Everything is looking good. Nothing needs immediate attention.</div>
        )}
      </section>

      <section className="ts-surface ts-directory">
        <SectionHeading eyebrow="Resident records" title="Tenant directory"
          aside={<span className="ts-counter">{visible.length} of {profiles.length} tenants</span>}/>
        <div className="ts-directory-controls">
          <label className="ts-search"><Icon name="search"/>
            <input type="search" aria-label="Search tenants" value={query}
              onChange={e => setQuery(e.target.value)} placeholder="Search name, unit, email or phone..."/>
          </label>
          <select aria-label="Filter property" value={propertyFilter} onChange={e => setPropertyFilter(e.target.value)}>
            <option value="all">All properties</option>
            {properties.map(([id,name]) => <option key={id} value={id}>{name}</option>)}
          </select>
          <select aria-label="Filter status" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="pending">Awaiting acceptance</option>
            <option value="not_moved_in_yet">Not moved in yet</option>
            <option value="notice_given">Notice given</option>
            <option value="balance">Has a balance</option>
            <option value="former">Former tenant</option>
          </select>
          <select aria-label="Sort tenants" value={sort} onChange={e => setSort(e.target.value)}>
            <option value="name">Sort by name</option>
            <option value="unit">Sort by unit</option>
            <option value="balance">Sort by balance</option>
          </select>
        </div>
        {visible.length === 0 ? (
          <div className="ts-empty-state">
            <span className="ts-empty-state-icon"><Icon name={profiles.length ? 'manage_search' : 'person_add'}/></span>
            <h3>{profiles.length ? 'No matching tenants' : 'Your tenant directory is ready'}</h3>
            <p>{profiles.length ? 'Try clearing or changing your search filters.' : 'Onboard a resident to start managing their tenancy.'}</p>
            {profiles.length ? (
              <button className="ts-button ts-button--secondary" onClick={() => {setQuery('');setPropertyFilter('all');setStatusFilter('all')}}>
                <Icon name="restart_alt"/> Clear filters
              </button>
            ) : <Link to="/tenants/new" className="ts-button ts-button--primary">Add first tenant</Link>}
          </div>
        ) : (
          <div className="ts-table-scroll">
            <table className="ts-table">
              <thead><tr>
                <th>Resident</th><th>Property & unit</th><th>Agreed rent</th><th>Account balance</th><th>Status</th><th><span className="ts-sr">Open</span></th>
              </tr></thead>
              <tbody>
                {visible.map(profile => {
                  const lease = currentLease(profile)
                  return (
                    <tr key={profile.tenant.id} className="ts-data-row">
                      <td>
                        <Link className="ts-person" to={`/tenants/${profile.tenant.id}`}>
                          <span className="ts-avatar">{initials(profile.tenant.full_name)}</span>
                          <span className="ts-person-text"><strong>{profile.tenant.full_name}</strong><small>{profile.tenant.phone} · {profile.tenant.email}</small></span>
                        </Link>
                      </td>
                      <td><span className="ts-cell-primary">{lease?.unitName ?? '—'}</span><span className="ts-cell-secondary">{lease?.propertyName ?? 'No active property'}</span></td>
                      <td><span className="ts-cell-primary">{lease ? money(lease.rent_amount,true) : '—'}</span><span className="ts-cell-secondary">{lease ? `Due day ${lease.due_day} · ${lease.billing_frequency}` : 'No lease'}</span></td>
                      <td><span className={`ts-balance-text ${profile.balance !== null && profile.balance > 0 ? 'ts-balance-text--due' : ''}`}>
                        {profile.balance === null ? 'Unavailable' : money(profile.balance,true)}
                      </span><span className="ts-cell-secondary">{profile.balance === null ? 'See invoice history' : profile.balance > 0 ? 'Outstanding' : 'No balance recorded'}</span></td>
                      <td>{lease ? <Status status={lease.status}/> : <span className="ts-status ts-status--neutral">{leaseStatus('no_lease')}</span>}</td>
                      <td><Link className="ts-row-open" aria-label={`View ${profile.tenant.full_name}`} to={`/tenants/${profile.tenant.id}`}><Icon name="chevron_right"/></Link></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="ts-directory-footer"><span>{visible.length} resident records displayed</span><span><Icon name="shield"/> Organization-scoped access</span></div>
      </section>
    </div>
  )
}
