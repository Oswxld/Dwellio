import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  fetchMyTenantInvoiceDetail,
  fetchMyTenantInvoices,
  type TenantInvoice,
  type TenantInvoiceCharge,
} from './data/tenantInvoiceRepository'
import TenantMpesaCheckout from './TenantMpesaCheckout'
import './tenant-invoices.css'

function Icon({ name }: { name: string }) {
  return <span aria-hidden="true" className="material-symbols-outlined">{name}</span>
}

function money(value: number | string | null | undefined) {
  const parsed = Number(value)
  return value == null || !Number.isFinite(parsed)
    ? '—'
    : `KSh ${new Intl.NumberFormat('en-KE', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(parsed)}`
}

function dateText(input: string | null | undefined) {
  if (!input) return 'Not recorded'
  const date = new Date(`${input.slice(0, 10)}T12:00:00`)
  return Number.isNaN(date.getTime()) ? 'Not recorded'
    : date.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })
}

function monthText(input: string | null | undefined) {
  if (!input) return 'Billing period'
  const date = new Date(`${input.slice(0, 10)}T12:00:00`)
  return Number.isNaN(date.getTime()) ? 'Billing period'
    : date.toLocaleDateString('en-KE', { month: 'long', year: 'numeric' })
}

type StatusFilter = 'all' | 'unpaid' | 'partial' | 'overdue' | 'paid'
function invoiceStatus(invoice: TenantInvoice): StatusFilter {
  if (invoice.status === 'paid') return 'paid'
  if (invoice.status === 'overdue') return 'overdue'
  if (invoice.status === 'partially_paid') return 'partial'
  return 'unpaid'
}
const statusLabels: Record<StatusFilter, string> = {
  all: 'All', unpaid: 'Unpaid', partial: 'Partially Paid', overdue: 'Overdue', paid: 'Paid',
}
function statusName(invoice: TenantInvoice) {
  return statusLabels[invoiceStatus(invoice)]
}

function LoadError({ message, retry }: { message: string; retry: () => void }) {
  return <div className="ti-feedback" role="alert">
    <Icon name="error_outline" />
    <strong>Unable to load invoices</strong>
    <p>{message}</p>
    <button className="ti-button ti-button-dark" type="button" onClick={retry}>Try again</button>
  </div>
}

export function TenantInvoiceList({ outstandingBalance }: { outstandingBalance: number | null }) {
  const [invoices, setInvoices] = useState<TenantInvoice[]>([])
  const [status, setStatus] = useState<StatusFilter>('all')
  const [month, setMonth] = useState('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let live = true
    setLoading(true)
    fetchMyTenantInvoices().then(data => {
      if (live) { setInvoices(data); setError('') }
    }).catch(caught => {
      if (live) setError(caught instanceof Error ? caught.message : 'Unable to load invoice history.')
    }).finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [refreshKey])

  const periodOptions = useMemo(() => [...new Set(invoices.map(inv => inv.period_start.slice(0, 7)))], [invoices])
  const counts = useMemo(() => {
    const result: Record<StatusFilter, number> = { all: invoices.length, unpaid: 0, partial: 0, overdue: 0, paid: 0 }
    invoices.forEach(inv => { result[invoiceStatus(inv)] += 1 })
    return result
  }, [invoices])
  const shown = useMemo(() => invoices.filter(inv =>
    (status === 'all' || invoiceStatus(inv) === status) &&
    (month === 'all' || inv.period_start.startsWith(month))
  ), [invoices, status, month])
  // Keep the account balance fresh after successful allocation. The parent
  // portal snapshot is only loaded on initial navigation.
  const currentBalance = !loading && !error
    ? invoices.reduce((total, inv) => total + Number(inv.outstanding_amount || 0), 0)
    : outstandingBalance

  return <div className="ti-page">
    <div className="ti-intro">
      <span className="ti-kicker"><Icon name="receipt_long" /> BILLING LEDGER</span>
      <h1>Invoices & Payments</h1>
      <p>View your bills, understand your charges and track your payments.</p>
    </div>

    <section className="ti-balance-card">
      <div className="ti-balance-label"><Icon name="account_balance_wallet" /> Outstanding balance</div>
      <div className="ti-hero-money">{money(currentBalance)}</div>
      <p>{currentBalance == null
        ? 'A recorded account balance is not available yet.'
        : 'Your recorded unpaid account balance'}</p>
      <button className="ti-button ti-button-dark" type="button"
        disabled={currentBalance == null || currentBalance < 1}
        onClick={() => setPaymentOpen(true)}>
        <span className="ti-mpesa-mark">M</span> Pay with M-Pesa <Icon name="arrow_forward" />
      </button>
      <small>Sandbox M-Pesa checkout is for testing only. Previous balances shown on invoices are historical references, not extra charges.</small>
    </section>

    <div className="ti-history-header">
      <div><h2>Your invoices</h2><p>Monthly rent and service statements</p></div>
      <select aria-label="Filter invoices by billing month" value={month} onChange={event => setMonth(event.target.value)}>
        <option value="all">All months</option>
        {periodOptions.map(period => <option key={period} value={period}>{monthText(`${period}-01`)}</option>)}
      </select>
    </div>

    <div className="ti-filter-scroller" role="group" aria-label="Invoice status">
      {(['all', 'unpaid', 'partial', 'overdue', 'paid'] as StatusFilter[]).map(item =>
        <button type="button" key={item} aria-pressed={status === item}
          onClick={() => setStatus(item)}
          className={`ti-filter ${status === item ? 'ti-filter-active' : ''}`}>
          {statusLabels[item]} ({counts[item]})
        </button>
      )}
    </div>

    {loading ? <div className="ti-skeleton" aria-label="Loading invoices" />
      : error ? <LoadError message={error} retry={() => setRefreshKey(k => k + 1)} />
      : shown.length === 0 ? <div className="ti-feedback">
        <Icon name="receipt_long" /><strong>No statements found</strong>
        <p>{invoices.length === 0 ? 'No finalized invoices have been issued to this tenant account.' : 'No invoices match your filters.'}</p>
        {invoices.length > 0 && <button className="ti-link" type="button"
          onClick={() => { setStatus('all'); setMonth('all') }}>Reset filters</button>}
      </div>
      : <div className="ti-invoice-stream">
        {shown.map(invoice => <Link key={invoice.id} to={`/tenant/invoices/${invoice.id}`} className="ti-invoice-card">
          <div className="ti-card-top">
            <div className="ti-period">
              <span className="ti-icon-bubble"><Icon name="calendar_today" /></span>
              <div><h3>{monthText(invoice.period_start)}</h3><span>{invoice.invoice_number}</span></div>
            </div>
            <span className={`ti-status ti-status-${invoiceStatus(invoice)}`}>{statusName(invoice)}</span>
          </div>
          <div className="ti-meta-row">
            <span>Issued {dateText(invoice.issued_at || invoice.created_at)}</span>
            <span>Due {dateText(invoice.due_date)}</span>
          </div>
          <div className="ti-invoice-summary">
            <div><span>Current charges</span><strong>{money(invoice.current_charges)}</strong></div>
            {Number(invoice.previous_balance) > 0 &&
              <div><span>Carried forward</span><strong>{money(invoice.previous_balance)}</strong></div>}
            <div><span>Invoice total</span><strong>{money(invoice.total_receivable)}</strong></div>
            {Number(invoice.total_paid) > 0 && <div><span>Payments recorded</span><strong>{money(invoice.total_paid)}</strong></div>}
            <div className="ti-summary-last"><b>Remaining balance</b>
              <strong>{money(invoice.outstanding_amount)}</strong></div>
          </div>
          <div className="ti-card-foot"><span>View invoice breakdown</span><Icon name="arrow_forward" /></div>
        </Link>)}
      </div>
    }
    {paymentOpen && <TenantMpesaCheckout close={() => setPaymentOpen(false)}
      onConfirmed={() => setRefreshKey(key => key + 1)} />}
  </div>
}

function ChargeRow({ charge }: { charge: TenantInvoiceCharge }) {
  const [open, setOpen] = useState(false)
  const label = charge.description || charge.charge_type.replaceAll('_', ' ')
  const lower = label.toLowerCase()
  const icon = lower.includes('water') ? 'water_drop' :
    lower.includes('electric') || lower.includes('power') ? 'bolt' :
    lower.includes('garbage') || lower.includes('sanitation') ? 'delete_sweep' :
    lower.includes('rent') ? 'home' : 'receipt_long'
  return <div className="ti-charge">
    <button type="button" disabled={charge.details.length === 0}
      aria-expanded={charge.details.length > 0 ? open : undefined}
      onClick={() => setOpen(old => !old)} className="ti-charge-head">
      <span className="ti-icon-bubble"><Icon name={icon} /></span>
      <span className="ti-charge-name">
        <strong>{label}</strong><small>{charge.details.length ? 'View meter calculation' : charge.charge_type.replaceAll('_', ' ')}</small>
      </span>
      <span className="ti-charge-amount">{money(charge.amount)}</span>
      {charge.details.length > 0 && <Icon name={open ? 'expand_less' : 'expand_more'} />}
    </button>
    {open && charge.details.map(item => <div className="ti-meter" key={item.id}>
      <div className="ti-meter-title"><Icon name="speed" /> Meter calculation</div>
      <div className="ti-meter-values">
        <div><small>Previous</small><strong>{item.previous_reading ?? '—'}</strong></div>
        <div><small>Current</small><strong>{item.current_reading ?? '—'}</strong></div>
        <div><small>Consumed</small><strong>{item.consumption ?? '—'}</strong></div>
        <div><small>Rate (KSh)</small><strong>{item.rate ?? '—'}</strong></div>
      </div>
      <p>Amount billed: {money(charge.amount)}</p>
    </div>)}
  </div>
}

function SummaryRow({ label, amount, emphasis = false }: { label: string; amount: number; emphasis?: boolean }) {
  return <div className={`ti-ledger-row ${emphasis ? 'ti-ledger-strong' : ''}`}>
    <span>{label}</span><strong>{money(amount)}</strong>
  </div>
}

export function TenantInvoiceDetails() {
  const { invoiceId } = useParams<{ invoiceId: string }>()
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof fetchMyTenantInvoiceDetail>>>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const [paymentOpen, setPaymentOpen] = useState(false)

  useEffect(() => {
    let live = true
    if (!invoiceId) {
      setError('Missing invoice ID.')
      setLoading(false)
      return
    }
    setLoading(true)
    fetchMyTenantInvoiceDetail(invoiceId).then(value => {
      if (live) { setDetail(value); setError('') }
    }).catch(caught => {
      if (live) setError(caught instanceof Error ? caught.message : 'Unable to open invoice.')
    }).finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [invoiceId, refreshKey])

  if (loading) return <div className="ti-page"><div className="ti-skeleton" aria-label="Loading invoice details" /></div>
  if (error) return <LoadError message={error} retry={() => setRefreshKey(k => k + 1)} />
  if (!detail) return <div className="ti-feedback"><Icon name="receipt_long" /><strong>Invoice unavailable</strong>
    <p>This invoice could not be found in your tenancy account.</p>
    <Link className="ti-link" to="/tenant/invoices">Back to invoices</Link>
  </div>

  const { invoice, charges, balance_sources: sources, payments } = detail
  const remaining = Number(invoice.outstanding_amount)
  const status = invoiceStatus(invoice)

  return <div className="ti-page ti-details">
    <div className="ti-detail-intro">
      <div><Link className="ti-back" to="/tenant/invoices"><Icon name="arrow_back" /> Invoices</Link>
        <h1>Invoice Details</h1><p>Your detailed billing statement</p></div>
      <span className="ti-icon-bubble" title="PDF export is not yet available"><Icon name="description" /></span>
    </div>
    <section className="ti-card ti-identity">
      <div className="ti-card-top">
        <div><div className="ti-kicker">DWELLIO · INVOICE</div><h2>{invoice.invoice_number}</h2></div>
        <span className={`ti-status ti-status-${status}`}>{statusName(invoice)}</span>
      </div>
      <div className="ti-identity-grid">
        <div><span>Billing period</span><strong>{dateText(invoice.period_start)} – {dateText(invoice.period_end)}</strong></div>
        <div><span>Due date</span><strong>{dateText(invoice.due_date)}</strong></div>
        <div><span>Issued</span><strong>{dateText(invoice.issued_at || invoice.created_at)}</strong></div>
        <div><span>Residence</span><strong>{invoice.property_name}, Unit {invoice.unit_name}</strong></div>
        <div className="ti-full"><span>Tenant</span><strong>{invoice.tenant_name}</strong></div>
      </div>
    </section>

    <section className="ti-section">
      <div className="ti-section-title"><h2>{monthText(invoice.period_start)} Charges</h2>
        <p>Charges incurred during this billing period.</p></div>
      {charges.length ? <div className="ti-charge-list">{charges.map(c => <ChargeRow key={c.id} charge={c} />)}</div> :
        <div className="ti-card"><p>No itemized charge records are available for this statement.</p></div>}
      <div className="ti-subtotal"><span>Total current charges</span><strong>{money(invoice.current_charges)}</strong></div>
    </section>

    <section className="ti-section ti-brought-forward">
      <div className="ti-section-title"><h2><Icon name="history" /> Previous unpaid balances</h2>
        <p>Unpaid amounts brought forward from earlier invoices, not new charges.</p></div>
      {sources.length ? <div className="ti-source-list">
        {sources.map(source => <Link key={source.source_invoice_id} to={`/tenant/invoices/${source.source_invoice_id}`} className="ti-source">
          <div><strong>{monthText(source.period_start)}</strong><small>{source.invoice_number}</small>
            <span>View original invoice <Icon name="arrow_forward" /></span></div>
          <strong>{money(source.amount)}</strong>
        </Link>)}
      </div> : <p className="ti-muted">No source invoices are recorded for this billing period.</p>}
      <div className="ti-subtotal"><span>Total carried forward at issue</span><strong>{money(invoice.previous_balance)}</strong></div>
      <p className="ti-disclosure">These amounts describe the balance snapshot used when the invoice was generated. Later payments on the original invoices may change what is currently owed.</p>
    </section>

    <section className="ti-card ti-ledger">
      <h2><Icon name="account_balance_wallet" /> Statement summary</h2>
      <SummaryRow label="Current period charges" amount={Number(invoice.current_charges)} />
      <SummaryRow label="Previous balance carried forward" amount={Number(invoice.previous_balance)} />
      <SummaryRow label="Invoice total recorded" amount={Number(invoice.total_receivable)} emphasis />
      <SummaryRow label="Payments recorded on invoice" amount={-Number(invoice.total_paid)} />
      {Number(invoice.total_deposit_applied) > 0 && <SummaryRow label="Deposit applied" amount={-Number(invoice.total_deposit_applied)} />}
      {Number(invoice.total_credits) > 0 && <SummaryRow label="Credits applied" amount={-Number(invoice.total_credits)} />}
      {Number(invoice.total_debits) > 0 && <SummaryRow label="Additional debits" amount={Number(invoice.total_debits)} />}
      <div className="ti-grand-total"><span>Remaining invoice balance</span><strong>{money(remaining)}</strong></div>
      <p className="ti-disclosure">The remaining amount is provided by Dwellio's billing system and is not recalculated from the display rows.</p>
    </section>

    <section className="ti-section">
      <div className="ti-section-title"><h2>Payments & Adjustments</h2>
        <p>Confirmed payments allocated to this invoice.</p></div>
      {payments.length === 0
        ? <div className="ti-card ti-empty-payments"><Icon name="receipt_long" />
          <div><strong>No payments recorded</strong><p>No confirmed payment allocations were found for this invoice.</p></div></div>
        : <div className="ti-payment-list">{payments.map(payment =>
          <div className="ti-card ti-payment" key={payment.payment_id}>
            <div><strong>{payment.method ? payment.method.replaceAll('_', ' ') : 'Recorded payment'}</strong>
              <span>{dateText(payment.paid_at)} · {payment.reference || 'Reference unavailable'}</span></div>
            <strong>{money(payment.amount_allocated)}</strong>
          </div>)}</div>}
    </section>

    <section className="ti-pay-footer">
      <div><span>Remaining due</span><strong>{money(remaining)}</strong></div>
      {remaining > 0
        ? <button type="button" className="ti-button ti-button-dark" onClick={() => setPaymentOpen(true)}>
          <span className="ti-mpesa-mark">M</span> Pay with M-Pesa</button>
        : <span className="ti-paid-note"><Icon name="check_circle" /> Paid</span>}
    </section>
    {paymentOpen && <TenantMpesaCheckout close={() => setPaymentOpen(false)}
      invoiceId={invoiceId} suggestedAmount={remaining}
      onConfirmed={() => setRefreshKey(key => key + 1)} />}
  </div>
}
