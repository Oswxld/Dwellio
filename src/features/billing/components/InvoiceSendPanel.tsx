import { useCallback, useEffect, useMemo, useState } from 'react'

import type { FinalizedInvoiceRow } from '../data/types'
import {
  fetchInvoiceSmsDeliveries,
  sendInvoiceSmsBatch,
} from '../data/invoiceDeliveryRepository'

import type {
  InvoiceSmsDelivery,
} from '../data/invoiceDeliveryRepository'

type Props = {
  cycleId: string
  propertyName: string
  invoices: FinalizedInvoiceRow[]
  initialInvoiceId?: string | null
  onBack: () => void
  onDeliveryChange: () => void
}

function formatAmount(amount: number) {
  return new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: 'KES',
    maximumFractionDigits: 2,
  }).format(amount)
}

function statusText(delivery: InvoiceSmsDelivery | undefined) {
  if (!delivery) return 'Not sent'
  if (delivery.status === 'accepted') {
    return delivery.environment === 'sandbox'
      ? 'Accepted (sandbox)'
      : 'Accepted by provider'
  }
  if (delivery.status === 'sending') return 'Submission in progress — check status'
  if (delivery.status === 'unknown') return 'Uncertain — investigate before retry'
  return 'Failed — retry available'
}

export default function InvoiceSendPanel({
  cycleId,
  propertyName,
  invoices,
  initialInvoiceId,
  onBack,
  onDeliveryChange,
}: Props) {
  const [deliveries, setDeliveries] = useState<InvoiceSmsDelivery[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [confirmIds, setConfirmIds] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [processed, setProcessed] = useState(0)
  const [sendTotal, setSendTotal] = useState(0)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const invoiceIds = useMemo(() => invoices.map(invoice => invoice.id), [invoices])

  const refresh = useCallback(async () => {
    const rows = await fetchInvoiceSmsDeliveries(invoiceIds)
    setDeliveries(rows)
  }, [invoiceIds])

  useEffect(() => {
    let active = true
    setLoading(true)

    fetchInvoiceSmsDeliveries(invoiceIds)
      .then(rows => {
        if (active) {
          setDeliveries(rows)
          setError('')
        }
      })
      .catch(caught => {
        if (active) {
          setError(caught instanceof Error ? caught.message : 'Could not load SMS statuses.')
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => { active = false }
  }, [invoiceIds, cycleId])

  useEffect(() => {
    setSelectedIds(initialInvoiceId ? [initialInvoiceId] : [])
    setConfirmIds([])
  }, [initialInvoiceId, cycleId])

  const deliveryById = useMemo(
    () => new Map(deliveries.map(delivery => [delivery.invoice_id, delivery])),
    [deliveries],
  )

  function canSend(invoice: FinalizedInvoiceRow) {
    const currentStatus = deliveryById.get(invoice.id)?.status
    return Boolean(invoice.phone?.trim()) &&
      currentStatus !== 'accepted' &&
      currentStatus !== 'sending' &&
      currentStatus !== 'unknown'
  }

  const eligibleInvoices = invoices.filter(canSend)
  const eligibleIds = new Set(eligibleInvoices.map(invoice => invoice.id))
  const selectedEligibleIds = selectedIds.filter(id => eligibleIds.has(id))

  const acceptedCount = deliveries.filter(delivery => delivery.status === 'accepted').length
  const failedCount = deliveries.filter(delivery => delivery.status === 'failed').length
  const needsReviewCount = deliveries.filter(delivery =>
    delivery.status === 'unknown' || delivery.status === 'sending'
  ).length
  const missingPhoneCount = invoices.filter(invoice => !invoice.phone?.trim()).length

  function toggleInvoice(id: string, checked: boolean) {
    setSelectedIds(previous =>
      checked
        ? [...new Set([...previous, id])]
        : previous.filter(item => item !== id)
    )
  }

  async function confirmSend() {
    const targets = confirmIds.filter(id => eligibleIds.has(id))
    setConfirmIds([])
    if (targets.length === 0 || sending) return

    setSending(true)
    setProcessed(0)
    setSendTotal(targets.length)
    setError('')
    setNotice('')

    let accepted = 0
    let failed = 0
    let uncertain = 0
    let skipped = 0
    let completed = 0

    try {
      // Small, sequential batches. The Edge Function sends personalized messages.
      // Never retry automatically after a network timeout.
      for (let offset = 0; offset < targets.length; offset += 10) {
        const batch = targets.slice(offset, offset + 10)
        const response = await sendInvoiceSmsBatch(batch)

        for (const item of response.results) {
          if (item.status === 'accepted') accepted += 1
          else if (item.status === 'failed') failed += 1
          else if (item.status === 'unknown') uncertain += 1
          else skipped += 1
        }

        completed += batch.length
        setProcessed(completed)
        await refresh()
        onDeliveryChange()
      }

      setNotice(
        `${accepted} accepted by provider, ${failed} failed, ${uncertain} uncertain, ${skipped} skipped. Provider acceptance does not prove handset delivery.`
      )
    } catch (caught) {
      setError(
        `${completed} of ${targets.length} processed. ` +
        (caught instanceof Error ? caught.message : 'SMS submission stopped.') +
        ' Refresh the delivery statuses before attempting another send.'
      )
    } finally {
      setSelectedIds([])
      setSending(false)
      try {
        await refresh()
        onDeliveryChange()
      } catch {
        // Keep the original error visible; statuses can be refreshed manually.
      }
    }
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.18em] text-[#1e6a59]">
            Invoice delivery · Step 6 of 6
          </div>
          <h2 className="font-[Newsreader] text-3xl font-semibold text-[#111e19]">
            Send tenant invoices
          </h2>
          <p className="mt-2 text-sm text-[#424845]">
            {propertyName} · SMS summaries using the phone number saved on each finalized invoice.
          </p>
        </div>
        <button type="button" disabled={sending} onClick={onBack}
          className="rounded-xl border border-[#c2c8c4] bg-white px-4 py-2.5 text-sm font-semibold text-[#1e6a59] disabled:opacity-50">
          Back to finalized invoices
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          ['Finalized', invoices.length],
          ['Ready / retryable', eligibleInvoices.length],
          ['Provider accepted', acceptedCount],
          ['Failed', failedCount],
          ['Needs review', needsReviewCount],
        ].map(([label, count]) => (
          <div key={label} className="rounded-2xl bg-white p-4 shadow-[0_8px_20px_rgba(16,33,28,0.04)]">
            <div className="text-xs font-medium text-[#66716b]">{label}</div>
            <div className="mt-2 text-2xl font-bold text-[#10211c]">{count}</div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-[#a7d7c2] bg-[#e7f7ee] p-4 text-sm text-[#205747]">
        Each invoice gets its own message containing its invoice number, total, and due date.
        SMS is submitted one invoice at a time behind the scenes. A provider acceptance is not
        proof of delivery. Sandbox acceptance only means a simulator test.
        {missingPhoneCount > 0 && (
          <span className="mt-2 block font-semibold">
            {missingPhoneCount} invoice(s) have no saved phone number and cannot be selected.
          </span>
        )}
      </div>

      {error && <div role="alert" className="rounded-xl bg-[#fff0ee] p-4 text-sm text-[#a1322b]">{error}</div>}
      {notice && <div role="status" className="rounded-xl bg-[#e7f7ee] p-4 text-sm text-[#205747]">{notice}</div>}
      {sending && (
        <div className="rounded-xl bg-white p-4 text-sm font-semibold text-[#1e6a59]">
          Processing {processed} of {sendTotal} invoices. Please keep this page open.
        </div>
      )}

      <div className="rounded-2xl bg-white p-4 shadow-[0_8px_20px_rgba(16,33,28,0.04)]">
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" disabled={sending || loading || eligibleInvoices.length === 0}
            onClick={() => setConfirmIds(eligibleInvoices.map(invoice => invoice.id))}
            className="rounded-lg bg-[#10211c] px-5 py-2.5 text-sm font-bold text-white disabled:opacity-40">
            Send all eligible ({eligibleInvoices.length})
          </button>
          <button type="button" disabled={sending || selectedEligibleIds.length === 0}
            onClick={() => setConfirmIds(selectedEligibleIds)}
            className="rounded-lg bg-[#1e6a59] px-5 py-2.5 text-sm font-bold text-white disabled:opacity-40">
            Send selected ({selectedEligibleIds.length})
          </button>
          <button type="button" disabled={sending || loading}
            onClick={() => setSelectedIds(eligibleInvoices.map(invoice => invoice.id))}
            className="text-sm font-semibold text-[#1e6a59] disabled:opacity-40">
            Select eligible
          </button>
          <button type="button" disabled={sending}
            onClick={() => setSelectedIds([])}
            className="text-sm font-semibold text-[#66716b] disabled:opacity-40">
            Clear selection
          </button>
          <button type="button" disabled={sending}
            onClick={() => void refresh().catch(caught =>
              setError(caught instanceof Error ? caught.message : 'Unable to refresh statuses.')
            )}
            className="ml-auto text-sm font-semibold text-[#1e6a59] disabled:opacity-40">
            Refresh statuses
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl bg-white shadow-[0_8px_20px_rgba(16,33,28,0.04)]">
        <table className="w-full min-w-[880px] text-left text-sm">
          <thead className="bg-[#e7f7ee] text-xs uppercase text-[#424845]">
            <tr>
              <th className="px-4 py-3">Select</th>
              <th className="px-4 py-3">Tenant</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Invoice</th>
              <th className="px-4 py-3 text-right">Amount</th>
              <th className="px-4 py-3">SMS status</th>
              <th className="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#c2c8c4]/30">
            {invoices.map(invoice => {
              const delivery = deliveryById.get(invoice.id)
              const available = canSend(invoice) && !loading
              return (
                <tr key={invoice.id}>
                  <td className="px-4 py-4">
                    <input type="checkbox" aria-label={`Select ${invoice.invoice_number}`}
                      disabled={!available || sending}
                      checked={selectedIds.includes(invoice.id) && available}
                      onChange={event => toggleInvoice(invoice.id, event.target.checked)}
                    />
                  </td>
                  <td className="px-4 py-4 font-semibold">{invoice.tenantName}</td>
                  <td className="px-4 py-4 font-mono text-xs">{invoice.phone ?? 'Missing'}</td>
                  <td className="px-4 py-4 font-mono text-xs text-[#1e6a59]">{invoice.invoice_number}</td>
                  <td className="px-4 py-4 text-right font-semibold">{formatAmount(invoice.total_invoiced)}</td>
                  <td className="px-4 py-4">
                    <span className="font-semibold text-[#424845]">{statusText(delivery)}</span>
                    {delivery?.error_message && (
                      <div className="mt-1 max-w-[260px] text-xs text-[#a1322b]">{delivery.error_message}</div>
                    )}
                  </td>
                  <td className="px-4 py-4 text-right">
                    <button type="button" disabled={!available || sending}
                      onClick={() => setConfirmIds([invoice.id])}
                      className="rounded-lg bg-[#e2f2e8] px-3 py-2 text-xs font-semibold text-[#1e6a59] disabled:opacity-40">
                      {delivery?.status === 'failed' ? 'Retry' : 'Send'}
                    </button>
                  </td>
                </tr>
              )
            })}
            {!invoices.length && (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-[#66716b]">No finalized invoices available.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {confirmIds.length > 0 && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#10211c]/60 p-4">
          <div role="dialog" aria-modal="true" aria-label="Confirm SMS invoice sending"
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="font-[Newsreader] text-2xl font-semibold text-[#10211c]">
              Send {confirmIds.length} invoice SMS{confirmIds.length === 1 ? '' : ' messages'}?
            </h3>
            <p className="mt-3 text-sm leading-6 text-[#424845]">
              Each tenant will receive their own invoice summary at the number stored on their invoice.
              This action may incur SMS charges in production. Already accepted messages will not be resent.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setConfirmIds([])}
                className="rounded-lg border px-4 py-2 text-sm font-semibold">Cancel</button>
              <button type="button" onClick={() => void confirmSend()}
                className="rounded-lg bg-[#1e6a59] px-4 py-2 text-sm font-semibold text-white">
                Confirm sending
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
