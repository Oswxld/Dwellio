import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import {
  getRecentTenantMpesaAttempt,
  getTenantMpesaAttemptStatus,
  getTenantMpesaContext,
  initiateTenantMpesaStk,
  type MpesaAttempt,
  type MpesaCheckoutContext,
} from './data/tenantMpesaRepository'
import './tenant-mpesa.css'

type Props = {
  close: () => void
  invoiceId?: string
  suggestedAmount?: number
  onConfirmed?: () => void
}

function amountText(n: number | undefined) {
  if (n == null || !Number.isFinite(n)) return '—'
  return `KSh ${new Intl.NumberFormat('en-KE').format(n)}`
}

function stateLabel(state: MpesaAttempt['status']) {
  switch (state) {
    case 'confirmed': return 'Payment recorded'
    case 'failed': return 'Payment unsuccessful'
    case 'initiation_failed': return 'STK request rejected'
    case 'needs_review': return 'Needs review'
    case 'callback_received': return 'Checking payment'
    case 'awaiting_callback': return 'Awaiting M-Pesa'
    default: return 'Starting M-Pesa'
  }
}

function description(attempt: MpesaAttempt): string {
  switch (attempt.status) {
    case 'confirmed':
      return 'Your payment has been recorded in Dwellio and applied to outstanding invoices.'
    case 'failed':
      return 'Safaricom reported that the transaction did not succeed. No payment has been credited.'
    case 'initiation_failed':
      return 'Safaricom did not accept the request. No payment has been credited.'
    case 'needs_review':
      return 'We cannot confirm this transaction yet. Please contact property management and do not send another payment until it has been checked.'
    case 'callback_received':
      return attempt.verification_status === 'query_matched'
        ? 'Safaricom reports success, but Dwellio is still completing the accounting entry. Do not retry yet.'
        : 'Safaricom has replied; Dwellio is checking the transaction outcome.'
    case 'awaiting_callback':
      return 'Check your phone for the official M-Pesa prompt and enter your PIN there, not on Dwellio.'
    default:
      return 'Your M-Pesa request is being prepared.'
  }
}

export default function TenantMpesaCheckout({
  close, invoiceId, suggestedAmount, onConfirmed,
}: Props) {
  const [context, setContext] = useState<MpesaCheckoutContext | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [phone, setPhone] = useState('')
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [attempt, setAttempt] = useState<MpesaAttempt | null>(null)
  const [statusError, setStatusError] = useState('')
  const [waitingTooLong, setWaitingTooLong] = useState(false)
  const confirmedRef = useRef(false)

  const getStatus = useCallback(async (id: string) => {
    const latest = await getTenantMpesaAttemptStatus(id)
    setAttempt(latest)
    setStatusError('')
    if (latest.status === 'confirmed' && !confirmedRef.current) {
      confirmedRef.current = true
      onConfirmed?.()
    }
    return latest
  }, [onConfirmed])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        const info = await getTenantMpesaContext(invoiceId)
        if (cancelled) return
        setContext(info)
        setPhone(info.phone_number ?? '')
        const ceiling = Math.max(0, Math.min(150000, Math.floor(Number(info.outstanding_balance ?? 0))))
        const suggested = suggestedAmount != null && suggestedAmount > 0
          ? Math.floor(suggestedAmount) : ceiling
        setAmount(String(Math.min(ceiling, suggested)))
        if (info.property_id) {
          const existing = await getRecentTenantMpesaAttempt(info.property_id)
          if (!cancelled && existing) setAttempt(existing)
        }
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Unable to load payment settings.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [invoiceId, suggestedAmount])

  // Dwellio's authenticated status RPC reads ONLY the current tenant's attempt.
  // Never treat the accepted STK request as a completed payment.
  useEffect(() => {
    if (!attempt || ['confirmed', 'failed', 'initiation_failed', 'needs_review'].includes(attempt.status)) return
    let cancelled = false
    let inFlight = false
    const started = Date.now()
    const timer = window.setInterval(() => {
      if (inFlight || cancelled) return
      if (Date.now() - started > 180000) {
        setWaitingTooLong(true)
        window.clearInterval(timer)
        return
      }
      inFlight = true
      void getStatus(attempt.id).catch(caught => {
        if (!cancelled) setStatusError(caught instanceof Error ? caught.message : 'Could not check payment status.')
      }).finally(() => { inFlight = false })
    }, 4000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [attempt?.id, attempt?.status, getStatus])

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!context?.available || !context.property_id || busy || attempt) return
    const normalizedPhone = phone.replace(/[\s-]/g, '')
    const money = Number(amount)
    const ceiling = Math.min(150000, Math.floor(Number(context.outstanding_balance ?? 0)))
    if (!/^(0[17][0-9]{8}|254[17][0-9]{8})$/.test(normalizedPhone)) {
      setError('Enter a valid Kenyan M-Pesa phone number (e.g. 0712345678).')
      return
    }
    if (!Number.isSafeInteger(money) || money < 1 || money > ceiling) {
      setError(`Enter a whole-KSh amount between 1 and ${amountText(ceiling)}.`)
      return
    }
    setBusy(true)
    setError('')
    try {
      const started = await initiateTenantMpesaStk(context.property_id, normalizedPhone, money)
      setAttempt(started)
      setWaitingTooLong(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to send the STK Push.')
      // If a network error occurred after Safaricom received a request, check
      // the database before enabling a repeat prompt.
      try {
        const latest = await getRecentTenantMpesaAttempt(context.property_id)
        if (latest) setAttempt(latest)
      } catch { /* keep original error and let tenant contact management */ }
    } finally {
      setBusy(false)
    }
  }

  const ceiling = Math.max(0, Math.min(150000, Math.floor(Number(context?.outstanding_balance ?? 0))))
  const canPay = Boolean(context?.available && context?.property_id && ceiling >= 1)

  return <div className="ti-overlay" role="presentation" onClick={close}>
    <section role="dialog" aria-modal="true" aria-labelledby="ti-mpesa-title"
      className="ti-modal ti-mpesa-modal" onClick={event => event.stopPropagation()}>
      <div className="ti-modal-top">
        <span className="ti-handle" />
        <button type="button" className="ti-icon-button" aria-label="Close M-Pesa checkout"
          onClick={close}><span className="material-symbols-outlined">close</span></button>
      </div>
      <div className="ti-modal-emblem"><span className="material-symbols-outlined">smartphone</span></div>
      <h2 id="ti-mpesa-title">Pay with M-Pesa</h2>
      <p className="ti-mpesa-sandbox">Sandbox testing only — not for real-money payments.</p>
      {loading ? <p role="status">Loading your property payment details…</p>
        : !context ? <div className="ti-feedback" role="alert">
          <strong>Checkout unavailable</strong><p>{error || 'Payment settings could not be loaded.'}</p>
        </div> : <>
          <div className="ti-mpesa-destination">
            <div><span>Property</span><strong>{context.property_name || '—'}</strong></div>
            <div><span>Approved PayBill</span><strong>{context.paybill_shortcode || 'Not configured'}</strong></div>
            <div><span>Account number (your unit)</span><strong>{context.unit_number || '—'}</strong></div>
            <div><span>Outstanding balance</span><strong>{amountText(Number(context.outstanding_balance ?? 0))}</strong></div>
          </div>
          {!context.available ? <p className="ti-mpesa-warning" role="alert">
            {context.message || 'M-Pesa setup is not yet ready for this property. Contact property management.'}
          </p> : attempt ? <>
            <div className="ti-mpesa-result" role="status">
              <strong>{stateLabel(attempt.status)}</strong>
              <p>{description(attempt)}</p>
              <small>Requested: {amountText(Number(attempt.amount))} · Unit {attempt.account_reference || context.unit_number}</small>
              {attempt.receipt && <small>Receipt: {attempt.receipt}</small>}
            </div>
            {statusError && <p className="ti-mpesa-warning" role="alert">{statusError}</p>}
            {waitingTooLong && <p className="ti-mpesa-warning">
              This is taking longer than expected. Check status again before attempting another payment.
            </p>}
            <button className="ti-button ti-button-dark" type="button"
              onClick={() => void getStatus(attempt.id).catch(caught =>
                setStatusError(caught instanceof Error ? caught.message : 'Unable to check payment status.'))}>
              <span className="material-symbols-outlined">refresh</span> Check payment status
            </button>
            {['confirmed', 'failed', 'initiation_failed'].includes(attempt.status) && <button
              className="ti-button ti-mpesa-secondary" type="button" onClick={() => {
                setAttempt(null); setStatusError(''); setWaitingTooLong(false)
              }}>Start a new payment</button>}
          </> : <form className="ti-mpesa-form" onSubmit={event => void send(event)}>
            <label>M-Pesa phone number
              <input inputMode="tel" autoComplete="tel" value={phone}
                onChange={event => setPhone(event.target.value)}
                placeholder="0712345678" required maxLength={20} />
            </label>
            <label>Amount (KSh)
              <input type="number" inputMode="numeric" min="1" max={ceiling}
                step="1" value={amount} onChange={event => setAmount(event.target.value)} required />
            </label>
            <p className="ti-mpesa-hint">The PayBill and unit account are set automatically by Dwellio. Payments are allocated to your oldest unpaid invoices first, which may differ from the invoice currently open.</p>
            {error && <p role="alert" className="ti-mpesa-warning">{error}</p>}
            <button className="ti-button ti-button-dark" type="submit" disabled={!canPay || busy}>
              <span className="ti-mpesa-mark">M</span>
              {busy ? 'Sending STK request…' : 'Send test STK Push'}
            </button>
            <small>You will enter your M-Pesa PIN only in Safaricom's phone prompt.</small>
          </form>}
        </>}
      {!loading && !context && <button className="ti-button ti-button-dark" type="button"
        onClick={close}>Close</button>}
    </section>
  </div>
}
