import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { User } from '@supabase/supabase-js'
import { useNavigate } from 'react-router-dom'

import {
  getDashboardFinancials,
  getDashboardProperties,
  getDashboardSummary,
  type DashboardFinancials,
} from '../lib/dashboard'
import type { DashboardProperty, DashboardSummary } from '../types/dashboard'
import DashboardQuickAddFlow from '../features/properties/components/DashboardQuickAddFlow'
import type { QuickAddKind } from '../features/properties/data/propertyQuickAddRepository'

type Props = { user: User; organizationId: string }
type Attention = {
  tone: 'danger' | 'warning' | 'info'
  title: string
  description: string
  action: string
  href: string
}
type QuickAction = { label: string; description: string; href?: string; kind?: QuickAddKind }

function number(value: number) {
  return new Intl.NumberFormat('en-KE').format(value)
}
function money(value: number) {
  return `KSh ${new Intl.NumberFormat('en-KE', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(value)}`
}
function kenyaMonth() {
  const values = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit',
  }).formatToParts(new Date())
  return `${values.find(part => part.type === 'year')?.value}-${values.find(part => part.type === 'month')?.value}`
}
function labelMonth(month: string) {
  return new Date(`${month}-01T12:00:00`).toLocaleDateString('en-KE', {
    month: 'long', year: 'numeric',
  })
}
function greeting() {
  const hour = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi', hour: '2-digit', hourCycle: 'h23',
  }).format(new Date()))
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}
const quickActions: QuickAction[] = [
  { label: 'Add tenant', description: 'Register a tenant and create their lease', href: '/tenants/new' },
  {
    label: 'Add building + floor + units',
    description: 'Select a property and create a complete building structure',
    kind: 'building',
  },
  {
    label: 'Add floor + units',
    description: 'Select a property and add a furnished floor structure',
    kind: 'floor',
  },
  {
    label: 'Add units',
    description: 'Select a property, building and existing floor',
    kind: 'units',
  },
]

export default function DashboardPage({ user, organizationId }: Props) {
  const navigate = useNavigate()
  const [month, setMonth] = useState(kenyaMonth)
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [properties, setProperties] = useState<DashboardProperty[]>([])
  const [financials, setFinancials] = useState<DashboardFinancials | null>(null)
  const [loadingPortfolio, setLoadingPortfolio] = useState(true)
  const [loadingMoney, setLoadingMoney] = useState(true)
  const [portfolioError, setPortfolioError] = useState('')
  const [financeError, setFinanceError] = useState('')
  const [quickAddOpen, setQuickAddOpen] = useState(false)
  const [quickAddKind, setQuickAddKind] = useState<QuickAddKind | null>(null)
  const [portfolioRevision, setPortfolioRevision] = useState(0)

  // Keep the portfolio separate from financial data: a missing financial
  // migration must never hide all the other real estate information.
  useEffect(() => {
    let alive = true
    setLoadingPortfolio(true)
    setPortfolioError('')
    void Promise.allSettled([
      getDashboardSummary(organizationId),
      getDashboardProperties(organizationId),
    ]).then(([overview, propertyList]) => {
      if (!alive) return
      if (overview.status === 'fulfilled') setSummary(overview.value)
      else {
        setSummary(null)
        setPortfolioError(
          overview.reason instanceof Error ? overview.reason.message : 'Could not load occupancy.',
        )
      }
      if (propertyList.status === 'fulfilled') setProperties(propertyList.value)
      else {
        setProperties([])
        setPortfolioError(prev => [
          prev,
          propertyList.reason instanceof Error
            ? propertyList.reason.message : 'Could not load properties.',
        ].filter(Boolean).join(' · '))
      }
      setLoadingPortfolio(false)
    })
    return () => { alive = false }
  }, [organizationId, portfolioRevision])

  useEffect(() => {
    let alive = true
    setLoadingMoney(true)
    setFinancials(null)
    setFinanceError('')
    void getDashboardFinancials(organizationId, month)
      .then(rows => { if (alive) setFinancials(rows) })
      .catch((caught: unknown) => {
        // Supabase/PostgREST errors are often plain objects rather than native
        // Error instances. Preserve the original response for diagnosis.
        const detail = caught && typeof caught === 'object'
          ? caught as { message?: string; code?: string; details?: string; hint?: string }
          : null
        console.error('[Dashboard] Failed to load financial figures', {
          rpc: 'get_landlord_dashboard_financials',
          organizationId,
          month,
          code: detail?.code,
          message: detail?.message,
          details: detail?.details,
          hint: detail?.hint,
          rawError: caught,
        })
        if (alive) {
          const message = detail?.message
            || (caught instanceof Error ? caught.message : String(caught ?? ''))
          setFinanceError(message
            ? `${message}${detail?.code ? ` (code: ${detail.code})` : ''}`
            : 'Unable to retrieve finalized monthly invoices.')
        }
      })
      .finally(() => { if (alive) setLoadingMoney(false) })
    return () => { alive = false }
  }, [organizationId, month])

  const occupancy = useMemo(() => (
    summary && Number(summary.unit_count) > 0
      ? Math.round((Number(summary.occupied_units) / Number(summary.unit_count)) * 100)
      : 0
  ), [summary])

  const attention = useMemo<Attention[]>(() => {
    if (!summary) return []
    const items: Attention[] = []
    if (summary.property_count === 0) {
      items.push({
        tone: 'danger', title: 'Your portfolio has no properties',
        description: 'Set up your first property to begin managing tenants and billing.',
        action: 'View properties', href: '/properties',
      })
    } else if (summary.unit_count === 0) {
      items.push({
        tone: 'warning', title: 'No units have been configured',
        description: 'Build the property structure with a building, floor and units.',
        action: 'Configure property', href: '/properties?create=building',
      })
    }
    if (summary.unavailable_units > 0) {
      items.push({
        tone: 'warning', title: `${number(summary.unavailable_units)} unavailable units`,
        description: 'Review units marked unavailable in your property inventory.',
        action: 'Review units', href: '/properties',
      })
    }
    return items
  }, [summary])

  const firstName = user.user_metadata?.full_name?.split(' ')[0] ||
    user.email?.split('@')[0] || 'there'

  return (
    <div className="dashboard-content">
      <section className="welcome-row">
        <div>
          <div className="eyebrow">LANDLORD OVERVIEW</div>
          <h1>{greeting()}, {firstName}<span className="heading-dot">.</span></h1>
          <p>Your property portfolio, billing and occupancy at a glance.</p>
        </div>
        <div className="welcome-actions">
          <div className="quick-add-wrapper">
            <button className="quick-add-button" type="button"
              aria-expanded={quickAddOpen}
              onClick={() => setQuickAddOpen(open => !open)}>
              <span>＋</span> Add
            </button>
            {quickAddOpen && (
              <div className="quick-add-menu">
                <div className="quick-add-menu-header">
                  <strong>Create new</strong>
                  <button type="button" aria-label="Close add menu"
                    onClick={() => setQuickAddOpen(false)}>×</button>
                </div>
                <div className="quick-add-list">
                  {quickActions.map(action => (
                    <button key={action.label} type="button" className="quick-add-item"
                      onClick={() => {
                        setQuickAddOpen(false)
                        if (action.kind) setQuickAddKind(action.kind)
                        else if (action.href) navigate(action.href)
                      }}>
                      <span className="quick-add-item-icon">+</span>
                      <span className="quick-add-item-copy">
                        <strong>{action.label}</strong>
                        <small>{action.description}</small>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="date-pill">
            <span>◷</span>
            {new Intl.DateTimeFormat('en-KE', {
              timeZone: 'Africa/Nairobi', weekday: 'long', day: 'numeric', month: 'short',
            }).format(new Date())}
          </div>
        </div>
      </section>

      {portfolioError && <div role="alert" className="dashboard-alert">
        Could not load part of your property overview: {portfolioError}
      </div>}
      {financeError && <div role="alert" className="dashboard-alert">
        Billing figures are temporarily unavailable: {financeError}
      </div>}

      {attention.length > 0 && (
        <section className="attention-section">
          <div className="section-heading">
            <div>
              <span className="section-kicker danger-kicker">PRIORITY</span>
              <h2>Needs attention</h2>
            </div>
            <span className="attention-count">{attention.length} item{attention.length===1?'':'s'}</span>
          </div>
          <div className="attention-grid">
            {attention.map(item => (
              <button type="button" key={item.title} className={`attention-card ${item.tone}`}
                onClick={() => {
                  if (item.href === '/properties?create=building') setQuickAddKind('building')
                  else navigate(item.href)
                }}>
                <span className="attention-symbol">{item.tone === 'danger' ? '!' : '△'}</span>
                <span className="attention-copy">
                  <strong>{item.title}</strong><span>{item.description}</span>
                </span>
                <span className="attention-action">{item.action} <b>→</b></span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section aria-label="Financial overview">
        <div className="flex flex-wrap items-end justify-between gap-3 mt-8 mb-1">
          <div>
            <span className="section-kicker">FINANCIAL OVERVIEW</span>
            <h2 className="mt-1 text-lg font-bold text-[#10211c]">
              Finalized invoices · {labelMonth(month)}
            </h2>
            <p className="mt-1 text-xs text-[#737875]">
              Across all your properties · Matches Billing's Total invoiced for this month.
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs font-semibold text-[#42594d]">
            Billing month
            <input type="month" aria-label="Select dashboard billing month" value={month}
              max={kenyaMonth()} onChange={e => { if (e.target.value) setMonth(e.target.value) }}
              className="rounded-xl border border-[#dcece2] bg-white px-3 py-2.5 text-[#10211c]"/>
          </label>
        </div>
        <div className="metric-grid">
          <MetricCard label="Expected this month"
            value={loadingMoney||!financials?'—':money(financials.expected)}
            sub={loadingMoney?'Loading invoices':!financials?'Unable to load':`${number(financials.invoice_count)} finalized invoices`}
            icon="◈" muted={!financials}/>
          <MetricCard label="Collected"
            value={loadingMoney||!financials?'—':money(financials.collected)}
            sub="Expected minus outstanding" icon="↗" muted={!financials}/>
          <MetricCard label="Outstanding"
            value={loadingMoney||!financials?'—':money(financials.outstanding)}
            sub="Unpaid balance on this month's invoices" icon="!" muted={!financials}/>
          <MetricCard label="Occupancy"
            value={loadingPortfolio||!summary?'—':`${occupancy}%`}
            sub={loadingPortfolio?'Loading units':!summary?'Unable to load':
              `${number(summary.occupied_units)} of ${number(summary.unit_count)} units occupied`}
            icon="▦"/>
        </div>
      </section>

      <div className="dashboard-columns">
        <section className="dashboard-card occupancy-card">
          <div className="card-heading">
            <div><span className="section-kicker">PROPERTY</span><h2>Occupancy overview</h2></div>
            <button className="ghost-button" type="button" onClick={() => navigate('/properties')}>
              View properties →
            </button>
          </div>
          <div className="occupancy-body">
            <div className="occupancy-ring" style={{ '--progress': `${occupancy}%` } as CSSProperties}>
              <div><strong>{loadingPortfolio||!summary?'—':`${occupancy}%`}</strong><span>occupied</span></div>
            </div>
            <div className="occupancy-stats">
              <StatusRow label="Occupied" value={summary?.occupied_units??0} className="occupied"/>
              <StatusRow label="Vacant" value={summary?.vacant_units??0} className="vacant"/>
              <StatusRow label="Reserved" value={summary?.reserved_units??0} className="reserved"/>
            </div>
          </div>
        </section>

        <section className="dashboard-card property-card">
          <div className="card-heading">
            <div><span className="section-kicker">PORTFOLIO</span><h2>Your properties</h2></div>
            <span className="small-count">{loadingPortfolio?'—':number(properties.length)}</span>
          </div>
          <div className="property-list">
            {loadingPortfolio ? <div className="property-skeleton"/> :
              properties.length === 0 ? (
                <div className="empty-state">
                  <span>＋</span><strong>No properties yet</strong>
                  <small>Configured properties will appear here.</small>
                  <button type="button" onClick={() => navigate('/properties')}
                    className="mt-2 text-xs font-bold text-[#1e6a59]">Open properties →</button>
                </div>
              ) : properties.map(property => (
                <button key={property.id} type="button"
                  onClick={() => navigate(`/properties/${property.id}`)}
                  className="property-row w-full cursor-pointer text-left">
                  <div className="property-avatar">{property.name[0]?.toUpperCase() ?? 'P'}</div>
                  <div>
                    <strong>{property.name}</strong>
                    <span>{property.address||property.city||property.county||'Location not added'}</span>
                  </div>
                  <span className="property-arrow">→</span>
                </button>
              ))}
          </div>
        </section>
      </div>
      {quickAddKind && <DashboardQuickAddFlow
        key={quickAddKind}
        kind={quickAddKind}
        organizationId={organizationId}
        onClose={() => setQuickAddKind(null)}
        onCreated={() => setPortfolioRevision(v => v + 1)}
      />}
    </div>
  )
}

function MetricCard({label,value,sub,icon,muted=false}:{
  label:string;value:string;sub:string;icon:string;muted?:boolean
}) {
  return <article className={`metric-card ${muted?'muted-metric':''}`}>
    <div className="metric-top"><span>{label}</span><i>{icon}</i></div>
    <strong>{value}</strong><small>{sub}</small>
  </article>
}
function StatusRow({label,value,className}:{
  label:string;value:number;className:string
}) {
  return <div className="status-row">
    <span><i className={className}/>{label}</span><strong>{number(value)}</strong>
  </div>
}
