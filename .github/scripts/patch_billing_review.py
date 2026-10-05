from pathlib import Path
import re

page_path = Path('src/pages/BillingPage.tsx')
repo_path = Path('src/features/billing/data/billingRepository.ts')
page = page_path.read_text()
repo = repo_path.read_text()

page = page.replace(
    "import {\n  createCurrentBillingCycle,",
    "import {\n  approveAllBillDrafts,\n  approveBillDraft,\n  createCurrentBillingCycle,",
)

page = page.replace(
    "type BillingStep =\n  | 'services'\n  | 'readings'\n  | 'generate'\n  | 'review'",
    "type BillingStep =\n  | 'services'\n  | 'readings'\n  | 'generate'\n  | 'review'\n  | 'invoices'\n  | 'send'",
)

page = page.replace(
    "  { id: 'generate', number: 3, title: 'Generate drafts' },\n  { id: 'review', number: 4, title: 'Review drafts' },\n]",
    "  { id: 'generate', number: 3, title: 'Generate drafts' },\n  { id: 'review', number: 4, title: 'Review drafts' },\n  { id: 'invoices', number: 5, title: 'View invoices' },\n  { id: 'send', number: 6, title: 'Send invoices' },\n]",
)

page = page.replace(
    "  const [openingDraft, setOpeningDraft] = useState(false)\n  const [error, setError] = useState('')",
    "  const [openingDraft, setOpeningDraft] = useState(false)\n  const [approvingDraft, setApprovingDraft] = useState(false)\n  const [approvingAll, setApprovingAll] = useState(false)\n  const [error, setError] = useState('')",
)

page = page.replace(
    "  const draftsExist = dashboard.draftCount > 0\n\n  const configurationReady =",
    "  const draftsExist = dashboard.draftCount > 0\n  const allDraftsApproved =\n    dashboard.draftCount > 0 &&\n    dashboard.approvedCount === dashboard.draftCount\n  const currentChargesTotal = dashboard.drafts.reduce(\n    (sum, draft) => sum + draft.current_charges,\n    0,\n  )\n  const previousBalancesTotal = dashboard.drafts.reduce(\n    (sum, draft) => sum + draft.previous_balance,\n    0,\n  )\n  const totalPayable = dashboard.drafts.reduce(\n    (sum, draft) => sum + draft.total_payable,\n    0,\n  )\n  const approvalPercent = dashboard.draftCount > 0\n    ? Math.round((dashboard.approvedCount / dashboard.draftCount) * 100)\n    : 0\n\n  const configurationReady =",
)

function_block = r'''
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
          ? `${approvedNow} remaining invoice draft${approvedNow === 1 ? '' : 's'} approved.`
          : 'All invoice drafts are already approved.',
      )
    } catch (approvalError) {
      console.error('[BillingPage] approve all drafts failed', approvalError)
      setError(errorMessage(approvalError, 'Could not approve all invoice drafts.'))
    } finally {
      setApprovingAll(false)
    }
  }

'''
page = page.replace("  function navigate(target: BillingStep) {", function_block + "  function navigate(target: BillingStep) {")

page = page.replace(
    "  function navigate(target: BillingStep) {\n    if (!cycle) return\n\n    if (draftsExist && target !== 'review') {",
    "  function navigate(target: BillingStep) {\n    if (!cycle) return\n\n    if (target === 'invoices' || target === 'send') {\n      return\n    }\n\n    if (draftsExist && target !== 'review') {",
)

page = page.replace(
    "                <div className=\"grid flex-1 grid-cols-2 gap-2 md:grid-cols-4 lg:max-w-3xl\">\n                  {steps.map(item => {\n                    const active = item.id === step\n                    const completed = item.number < currentStepNumber || (item.id === 'review' && draftsExist)\n                    const locked = draftsExist && item.id !== 'review'",
    "                <div className=\"grid flex-1 grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6 xl:max-w-5xl\">\n                  {steps.map(item => {\n                    const active = item.id === step\n                    const completed = item.id === 'review'\n                      ? allDraftsApproved\n                      : item.number < currentStepNumber\n                    const futureStep = item.number > 4\n                    const locked = futureStep || (draftsExist && item.number < 4)",
)

review_pattern = re.compile(
    r"            \{step === 'review' && \(\n              <section className=\"space-y-5\">.*?              </section>\n            \)\}",
    re.S,
)

review_replacement = r'''            {step === 'review' && (
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
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-[#111e19] shadow-[0_8px_24px_rgba(16,33,28,0.07)] transition hover:bg-[#e7f7ee] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="material-symbols-outlined text-[19px] text-[#1e6a59]">{approvingAll ? 'progress_activity' : 'done_all'}</span>
                    {allDraftsApproved ? 'All drafts approved' : approvingAll ? 'Approving drafts…' : 'Approve all remaining'}
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
                        <div className="mt-0.5 text-xs text-[#737875]">{allDraftsApproved ? 'Review is complete. These drafts are ready for finalization.' : 'Approve individually or use Approve all remaining.'}</div>
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
            )}'''

page, review_count = review_pattern.subn(review_replacement, page, count=1)
if review_count != 1:
    raise SystemExit(f'Expected to replace one review section, replaced {review_count}')

preview_pattern = re.compile(
    r"      \{selectedDraft && \(\n        <div className=\"fixed inset-0 z-50 flex justify-end bg-black/35 backdrop-blur-sm\">.*?      \)\}\n    </div>",
    re.S,
)

preview_replacement = r'''      {selectedDraft && (
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
                <div className="overflow-hidden rounded-xl bg-[#edfdf3]/70"><div className="divide-y divide-[#c2c8c4]/25">{selectedDraft.charges.map(charge => (<div key={charge.id} className="grid gap-3 p-4 md:grid-cols-[1.4fr_1fr_auto] md:items-center"><div><div className="font-semibold text-[#111e19]">{charge.description}</div><div className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-[#737875]">{charge.charge_type}</div></div><div className="text-xs leading-5 text-[#424845]">{charge.details.length > 0 ? charge.details.map(detail => (<div key={detail.id}>{detail.previous_reading !== null && detail.current_reading !== null ? `Prev ${detail.previous_reading} → Current ${detail.current_reading} · ${detail.consumption ?? 0} units × ${money(detail.rate ?? 0)}` : 'No meter detail for this charge.'}</div>)) : 'Fixed charge'}</div><div className="font-mono font-bold text-[#111e19]">{money(charge.amount)}</div></div>))}</div></div>
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
    </div>'''

page, preview_count = preview_pattern.subn(preview_replacement, page, count=1)
if preview_count != 1:
    raise SystemExit(f'Expected to replace one draft preview, replaced {preview_count}')

repo = repo.replace(
    "export async function finalizeBillingCycle(billingCycleId: string) {",
    """export async function approveAllBillDrafts(billingCycleId: string) {
  const { data, error } = await supabase
    .from('bill_drafts')
    .update({
      status: 'approved',
      updated_at: new Date().toISOString(),
    })
    .eq('billing_cycle_id', billingCycleId)
    .in('status', ['draft', 'reviewed'])
    .select('id')

  if (error) throw error
  return data?.length ?? 0
}

export async function finalizeBillingCycle(billingCycleId: string) {""",
)

page_path.write_text(page)
repo_path.write_text(repo)
