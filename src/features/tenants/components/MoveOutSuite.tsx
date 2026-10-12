import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import type { TenantLease, TenantProfile } from '../data/tenantManagementRepository'
import {
  addMoveOutCharge, beginMoveOutInspection, editMoveOutCharge,
  fetchMoveOutWorkspace, removeMoveOutCharge, updateMoveOutInspection, finalizeMoveOut,
  processMoveOutInvoice, sendMoveOutInvoiceSms,
  type MoveOutCharge, type MoveOutWorkspace,
} from '../data/moveOutRepository'
import { Icon, dateLabel, initials, money, kenyaDate, Status } from './tenantUi'
import { downloadMoveOutDraftPdf, printMoveOutDraft } from './moveOutDocuments'

type Props = { organizationId: string; profile: TenantProfile; lease: TenantLease; onRefresh: () => void }
type Step = 1|2|3|4|5|6|7
const stages: { number: Step; label: string; icon: string }[] = [
  {number:1,label:'Inspection setup',icon:'assignment'},
  {number:2,label:'Repair charges',icon:'receipt_long'},
  {number:3,label:'Final settlement',icon:'balance'},
  {number:4,label:'Process invoice',icon:'fact_check'},
  {number:5,label:'Print / download',icon:'print'},
  {number:6,label:'SMS delivery',icon:'sms'},
  {number:7,label:'Closeout & vacate',icon:'lock_reset'},
]

function Panel({ children, className='' }: {children:ReactNode;className?:string}) {
  return <section className={`ts-surface ts-info-card ${className}`}>{children}</section>
}
function Heading({icon,title,subtitle,aside}:{
  icon:string;title:string;subtitle:string;aside?:ReactNode
}) {
  return <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
    <div className="flex items-start gap-3">
      <span className="ts-card-icon"><Icon name={icon}/></span>
      <div><h3 className="font-['Newsreader'] text-[25px] leading-tight font-semibold text-[#10211c]">{title}</h3>
        <p className="text-[12px] text-[#737875] leading-6">{subtitle}</p></div>
    </div>{aside}
  </div>
}
function AmountRow({label,value,strong=false}: {label:string;value:number|null;strong?:boolean}) {
  return <div className={`flex justify-between items-center gap-4 py-2.5 text-[12px] ${strong?'border-t border-[#dcece2] mt-1 pt-4 font-extrabold text-[#10211c]':'text-[#506459]'}`}>
    <span>{label}</span><strong className="tabular-nums text-right">{money(value)}</strong>
  </div>
}
function Chip({children}: {children:ReactNode}) {
  return <span className="inline-flex items-center rounded-full bg-[#e2f2e8] px-3 py-1.5 text-[11px] font-extrabold text-[#1e6a59]">{children}</span>
}

export default function MoveOutSuite({organizationId,profile,lease,onRefresh}:Props) {
  const [step,setStep] = useState<Step>(1)
  const [workspace,setWorkspace] = useState<MoveOutWorkspace|null>(null)
  const [loading,setLoading] = useState(true)
  const [busy,setBusy] = useState(false)
  const [error,setError] = useState('')
  const [notice,setNotice] = useState('')
  const [revision,setRevision] = useState(0)
  const [inspectionDate,setInspectionDate] = useState(kenyaDate())
  const [inspectionNotes,setInspectionNotes] = useState('')
  const [showForm,setShowForm] = useState(false)
  const [editCharge,setEditCharge] = useState<MoveOutCharge|null>(null)
  const [chargeTitle,setChargeTitle] = useState('')
  const [chargeAmount,setChargeAmount] = useState('')
  const [chargeDescription,setChargeDescription] = useState('')
  const [ack,setAck] = useState(false)
  const [keysReturned,setKeysReturned] = useState(false)
  const [vacated,setVacated] = useState(false)
  const [confirmedDate,setConfirmedDate] = useState(kenyaDate())
  const [closeConfirmation,setCloseConfirmation] = useState(false)
  const [smsConfirmation,setSmsConfirmation] = useState(false)

  const refresh = useCallback(() => setRevision(v => v+1),[])
  useEffect(() => {
    let active = true
    setLoading(true)
    fetchMoveOutWorkspace(lease.id)
      .then(data => {
        if (!active) return
        setWorkspace(data)
        setError('')
        if (data.inspection) {
          setInspectionDate(data.inspection.inspected_at)
          setInspectionNotes(data.inspection.notes ?? '')
        }
      })
      .catch(e => {if(active)setError(e instanceof Error?e.message:'Unable to load inspection.')})
      .finally(() => {if(active)setLoading(false)})
    return () => {active=false}
  },[lease.id,revision])

  const inspection = workspace?.inspection ?? null
  const charges = workspace?.charges ?? []
  const subtotal = useMemo(() => charges.reduce((sum,c)=>sum+c.amount,0),[charges])
  const settlement = workspace?.settlement ?? null
  const arrearSources = (workspace?.arrearSources ?? []).map(row => ({
    invoiceNumber: profile.invoices.find(invoice => invoice.id === row.source_invoice_id)?.invoice_number
      ?? row.source_invoice_id.slice(0,8),
    amount: row.amount,
  }))
  // Indicative only. The actual settlement must come from the server-side
  // invoice and payment ledger at the moment of processing, NOT this screen.
  const priorBalance = profile.balance
  const obligations = priorBalance === null ? null : priorBalance + subtotal
  const agreedDeposit = Math.max(0,Number(lease.deposit_amount))
  const applied = obligations === null ? null : Math.min(agreedDeposit,obligations)
  const refund = obligations === null ? null : Math.max(0,agreedDeposit-obligations)
  const payable = obligations === null ? null : Math.max(0,obligations-agreedDeposit)
  const complete = inspection?.status === 'completed'
  const canStart = ['active','notice_given','expired'].includes(lease.status)
  const finalInvoice = profile.invoices.find(i =>
    i.lease_id === lease.id && i.invoice_type === 'move_out' && i.status !== 'void',
  ) ?? null
  const financialReady = !!settlement && !!finalInvoice

  async function mutation(run:()=>Promise<void>,message:string) {
    setBusy(true);setError('')
    try {await run();setNotice(message);refresh();onRefresh()}
    catch(e){setError(e instanceof Error?e.message:'Unable to save changes.')}
    finally {setBusy(false)}
  }
  async function start() {
    if(!canStart)return
    await mutation(()=>beginMoveOutInspection({
      organizationId,leaseId:lease.id,tenantId:profile.tenant.id,unitId:lease.unit_id,date:inspectionDate,
    }),'Inspection created. You can now add itemized charges.')
  }
  function openNewCharge() {
    setEditCharge(null);setChargeTitle('');setChargeAmount('');setChargeDescription('');setShowForm(true);setError('')
  }
  function openEditCharge(charge:MoveOutCharge) {
    setEditCharge(charge);setChargeTitle(charge.title);setChargeAmount(String(charge.amount));
    setChargeDescription(charge.description ?? '');setShowForm(true);setError('')
  }
  async function saveCharge(event:FormEvent) {
    event.preventDefault()
    if (!inspection || complete)return
    const amount=Number(chargeAmount)
    if(!chargeTitle.trim()||!Number.isFinite(amount)||amount<=0) {
      setError('Enter a name and a positive amount for the charge.');return
    }
    setBusy(true);setError('')
    try {
      if(editCharge)await editMoveOutCharge(editCharge.id,chargeTitle,amount,chargeDescription)
      else await addMoveOutCharge(inspection.id,chargeTitle,amount,chargeDescription)
      setShowForm(false);setNotice('Inspection charge saved.');refresh()
    }catch(e){setError(e instanceof Error?e.message:'Could not save charge.')}
    finally{setBusy(false)}
  }
  async function processInvoice() {
    if (!inspection || !complete || !ack || busy || settlement) return
    setBusy(true);setError('')
    try {
      const result = await processMoveOutInvoice(inspection.id)
      setNotice(`Final invoice ${result.invoice_number ?? 'created'} processed and deposit allocations recorded.`)
      setStep(5)
      refresh()
      onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not process the final invoice.')
    } finally {setBusy(false)}
  }
  async function sendSms() {
    if (!settlement || busy) return
    setBusy(true);setError('')
    try {
      const result = await sendMoveOutInvoiceSms(settlement.invoice_id)
      setSmsConfirmation(false)
      setNotice(result.status === 'accepted'
        ? 'Full move-out statement accepted by SMS provider; handset delivery is not yet confirmed.'
        : `SMS status: ${result.status}. ${result.reason ?? ''}`)
      refresh()
    } catch(e) {
      setError(e instanceof Error ? e.message : 'Unable to send move-out statement.')
      setSmsConfirmation(false)
    } finally {setBusy(false)}
  }
  async function closeout() {
    if (!finalInvoice || !complete || !keysReturned || !vacated || busy) return
    setBusy(true);setError('')
    try {
      await finalizeMoveOut(lease.id, finalInvoice.id, confirmedDate)
      setCloseConfirmation(false)
      setNotice('Move-out finalized: lease terminated and unit marked vacant.')
      onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to finalize move-out.')
    } finally {setBusy(false)}
  }

  const doc = {
    invoiceNumber: finalInvoice?.invoice_number ?? 'DRAFT - Not issued',
    final: financialReady,
    arrearSources,
    tenantName: profile.tenant.full_name,
    phone: profile.tenant.phone,
    property: lease.propertyName,
    unit: lease.unitName,
    date: inspection?.inspected_at ?? inspectionDate,
    charges,
    previousArrears: settlement?.arrears_total ?? priorBalance,
    deposit: settlement?.deposit_held ?? agreedDeposit,
    applied: settlement?.deposit_applied ?? applied,
    refundable: settlement?.deposit_refundable ?? refund,
    payable: settlement?.tenant_payable ?? payable,
  }

  if(loading)return <Panel><p className="text-sm text-[#737875]">Loading inspection workspace…</p></Panel>
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div>
          <p className="ts-eyebrow"><Icon name="verified_user"/> Dwellio · Property handover</p>
          <h2 className="font-['Newsreader'] text-3xl sm:text-4xl text-[#10211c] mt-2">Move-out inspection <span className="text-[#1e6a59]">& settlement</span></h2>
          <p className="text-[12px] text-[#737875] mt-1">Inspect, itemize, review financial obligations and prepare the final statement.</p>
        </div>
        <Chip>{complete?'Inspection completed':inspection?'Draft inspection':'Not started'}</Chip>
      </div>

      <Panel>
        <div className="flex flex-wrap justify-between items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="ts-avatar ts-avatar--large">{initials(profile.tenant.full_name)}</div>
            <div><strong className="text-[17px] text-[#10211c]">{profile.tenant.full_name}</strong>
              <p className="text-[12px] mt-1 text-[#737875]">{lease.propertyName} · {lease.buildingName} · {lease.unitName}</p>
              <div className="mt-2"><Status status={lease.status}/></div>
            </div>
          </div>
          <div className="flex gap-3 flex-wrap">
            <div className="rounded-xl bg-[#e7f7ee] py-3 px-4">
              <p className="text-[10px] text-[#737875] uppercase font-bold">Monthly rent</p>
              <strong className="text-[14px]">{money(lease.rent_amount)}</strong>
            </div>
            <div className="rounded-xl bg-[#d8f5e6] py-3 px-4">
              <p className="text-[10px] text-[#1e6a59] uppercase font-bold">Agreed deposit</p>
              <strong className="text-[14px]">{money(agreedDeposit)}</strong>
            </div>
          </div>
        </div>
      </Panel>

      <Panel>
        <div className="flex flex-wrap justify-between items-center gap-2 mb-4">
          <div><p className="ts-eyebrow">Move-out lifecycle</p>
            <h3 className="font-['Newsreader'] text-2xl text-[#10211c]">Inspection to closeout</h3></div>
          <Chip>{complete?'Inspection signed off':'Inspection in progress'}</Chip>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-2">
          {stages.map(stage => <button key={stage.number} type="button" onClick={()=>setStep(stage.number)}
            className={`rounded-xl p-3 text-left transition min-h-[104px] border-l-[3px] ${step===stage.number
              ?'border-[#1e6a59] bg-[#d6f5e4] shadow-sm' :
              'border-transparent bg-[#edf8f0] hover:bg-[#e1f1e7]'}`}>
            <div className="flex justify-between text-[#1e6a59] text-[10px] font-extrabold">
              {String(stage.number).padStart(2,'0')}<Icon name={stage.icon} className="!text-[17px]"/>
            </div>
            <strong className="text-[11px] mt-3 block leading-[17px] text-[#203e2c]">{stage.label}</strong>
          </button>)}
        </div>
        <div className="flex flex-wrap gap-2 mt-5 p-2 bg-[#e2f2e8] rounded-xl">
          {stages.map(s=><button key={s.number} type="button" onClick={()=>setStep(s.number)}
            className={`text-[11px] px-3 py-2 rounded-lg ${s.number===step?'bg-white text-[#10211c] font-extrabold shadow':'text-[#4d6b5a] hover:bg-white/50'}`}>
            {s.number}. {s.label}
          </button>)}
        </div>
      </Panel>

      {error && <div role="alert" className="rounded-xl bg-[#fff0ec] p-4 text-[12px] text-[#933f33]">{error}</div>}
      {notice && <div role="status" className="rounded-xl bg-[#e2f2e8] p-4 text-[12px] text-[#1e6a59] flex gap-2"><Icon name="check_circle"/>{notice}</div>}
      {workspace && !workspace.schemaReady && <div className="rounded-xl bg-[#fff4d9] p-4 text-[12px] text-[#8b6508]">{workspace.error}</div>}

      {step===1 && <Panel>
        <Heading icon="assignment" title="Inspection walkthrough setup" subtitle="Create or resume a physical inspection independently of move-out notice."/>
        <div className="ts-detail-grid ts-detail-grid--four">
          <div className="ts-detail"><div className="ts-detail-label">Assigned tenant</div><div className="ts-detail-value">{profile.tenant.full_name}</div></div>
          <div className="ts-detail"><div className="ts-detail-label">Property unit</div><div className="ts-detail-value">{lease.propertyName} · {lease.unitName}</div></div>
          <div className="ts-detail"><div className="ts-detail-label">Lease status</div><div className="ts-detail-value">{lease.status.replaceAll('_',' ')}</div></div>
          <div className="ts-detail"><div className="ts-detail-label">Inspection status</div><div className="ts-detail-value">{inspection?.status??'Not started'}</div></div>
        </div>
        <div className="grid sm:grid-cols-2 gap-4 mt-5">
          <label className="text-[12px] font-bold text-[#42594d]">Inspection date
            <input type="date" value={inspectionDate} onChange={e=>setInspectionDate(e.target.value)}
              disabled={complete} className="block w-full mt-2 rounded-xl bg-[#f1faf4] border border-[#dcece2] p-3 text-sm"/>
          </label>
          <label className="text-[12px] font-bold text-[#42594d]">Inspection notes (optional)
            <textarea rows={2} maxLength={1000} value={inspectionNotes} onChange={e=>setInspectionNotes(e.target.value)}
              disabled={complete} placeholder="Keys, physical condition, any important context..."
              className="block w-full mt-2 rounded-xl bg-[#f1faf4] border border-[#dcece2] p-3 text-sm"/>
          </label>
        </div>
        <div className="ts-soft-notice"><Icon name="info"/>
          Inspection does not terminate the lease, vacate the unit, create an invoice or deduct the deposit.
        </div>
        <div className="flex flex-wrap gap-3 mt-5 justify-end">
          {!inspection?<button disabled={busy || !workspace?.schemaReady || !canStart} onClick={()=>void start()}
            className="ts-button ts-button--primary"><Icon name="play_arrow"/> Begin inspection</button>:
            !complete && <button disabled={busy} className="ts-button ts-button--secondary"
              onClick={()=>void mutation(()=>updateMoveOutInspection(inspection.id,{inspected_at:inspectionDate,notes:inspectionNotes||null}),'Inspection details saved.')}>
              <Icon name="save"/> Save changes</button>}
          <button className="ts-button ts-button--primary" disabled={!inspection} onClick={()=>setStep(2)}>Proceed to charges <Icon name="arrow_forward"/></button>
        </div>
      </Panel>}

      {step===2 && <Panel>
        <Heading icon="receipt_long" title="Itemized inspection charges"
          subtitle="Record repair and cleaning costs. Add a name, amount and optional description."
          aside={!complete && <button disabled={!inspection} className="ts-button ts-button--primary" onClick={openNewCharge}><Icon name="add_circle"/> Add charge</button>}/>
        {charges.length===0?<div className="ts-empty-state ts-empty-state--compact">
          <Icon name="playlist_add"/><h3>No inspection charges</h3><p>Begin by adding the first itemized repair or cleaning expense.</p>
        </div>:<div className="space-y-3">
          {charges.map(c=><div key={c.id} className="rounded-xl bg-[#edf8f0] p-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex gap-3 items-start">
              <span className="ts-card-icon"><Icon name="handyman"/></span>
              <div><strong className="text-[13px]">{c.title}</strong>{c.description && <p className="text-[11px] mt-1 text-[#737875]">{c.description}</p>}</div>
            </div>
            <div className="flex items-center gap-3 ml-auto">
              <strong className="tabular-nums text-[13px] text-[#b2473f]">{money(c.amount)}</strong>
              {!complete && <><button aria-label={`Edit ${c.title}`} onClick={()=>openEditCharge(c)} className="text-[#1e6a59]"><Icon name="edit"/></button>
                <button aria-label={`Remove ${c.title}`} disabled={busy}
                  onClick={()=>{if(window.confirm(`Remove ${c.title}?`))void mutation(()=>removeMoveOutCharge(c.id),'Charge removed.')}}
                  className="text-[#a64038]"><Icon name="delete"/></button></>}
            </div>
          </div>)}
        </div>}
        <div className="rounded-xl bg-[#e2f2e8] p-5 mt-5 flex flex-wrap justify-between items-center gap-3">
          <strong className="text-[12px] text-[#42594d]">Total inspection charges ({charges.length} items)</strong>
          <strong className="text-xl text-[#10211c] tabular-nums">{money(subtotal)}</strong>
        </div>
        <div className="flex justify-end gap-3 mt-5 flex-wrap">
          {inspection && !complete && <button disabled={busy} className="ts-button ts-button--secondary" onClick={()=>{
            if(window.confirm('Complete inspection? You will no longer be able to edit these charges. Zero charges are allowed when no damage is found.'))
              void mutation(()=>updateMoveOutInspection(inspection.id,{status:'completed'}),'Inspection marked completed.')
          }}><Icon name="verified"/> Complete inspection</button>}
          <button className="ts-button ts-button--primary" disabled={!inspection} onClick={()=>setStep(3)}>Review settlement <Icon name="arrow_forward"/></button>
        </div>
      </Panel>}

      {step===3 && <div className="grid lg:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)] gap-5">
        <div className="space-y-5">
          <Panel><Heading icon="account_tree" title="Previous arrears" subtitle="Outstanding amount from the existing tenant invoice records."/>
            <div className="rounded-xl bg-[#edf8f0] p-4">
              <AmountRow label="Indicative historical balance" value={priorBalance} strong/>
              {profile.invoices.filter(i=>i.status!=='void').slice(0,8).map(i=>
                <div key={i.id} className="flex justify-between gap-3 mt-3 text-[11px] text-[#67776d]">
                  <span>{i.invoice_number} · {dateLabel(i.billing_period_start)}</span><span>{money(i.outstanding_amount)}</span>
                </div>)}
            </div>
            <div className="ts-soft-notice"><Icon name="info"/>
              Previous invoice totals can include carried-forward debt. A server-side ledger must verify arrears from payments, invoice lines and source references before final processing.
            </div>
          </Panel>
          <Panel><Heading icon="handyman" title="Inspection deductions" subtitle="Recorded charges from the completed or draft inspection."/>
            {charges.map(c=><AmountRow key={c.id} label={c.title} value={c.amount}/>)}
            <AmountRow label="Inspection subtotal" value={subtotal} strong/>
          </Panel>
          <Panel><Heading icon="water_drop" title="Additional final charges" subtitle="Final utilities or rent require verified billing records before they can be included."/>
            <p className="ts-muted-note">No additional charges are invented. Any unbilled services will need a backed-up billing source and final meter readings.</p>
          </Panel>
        </div>
        <div className="space-y-5">
          <Panel><Heading icon="savings" title="Security deposit" subtitle="Held throughout the tenancy; applied only at the final settlement."/>
            <AmountRow label="Agreed security deposit" value={agreedDeposit}/>
            <AmountRow label="Indicative total obligations" value={obligations}/>
            <AmountRow label="Indicative deposit applied" value={applied}/>
            <div className="rounded-xl p-4 bg-[#e2f2e8] mt-3">
              <p className="text-[10px] uppercase font-extrabold text-[#1e6a59]">{payable!==null&&payable>0?'Indicative tenant payable':'Indicative deposit refundable'}</p>
              <strong className="block mt-1 text-2xl text-[#10211c]">{money(payable!==null&&payable>0?payable:refund)}</strong>
              <p className="mt-2 text-[11px] text-[#547061]">Refunds, if any, are handled manually outside Dwellio. No B2C integration.</p>
            </div>
          </Panel>
          <Panel><Heading icon="gpp_maybe" title="Review before issuing" subtitle="Do not lock financial records based on an unverified preview."/>
            <button className="ts-button ts-button--primary w-full" onClick={()=>setStep(4)}>
              Review processing <Icon name="arrow_forward"/></button>
            <p className="ts-muted-note mt-3">Actual arrears, deposit applications and invoice lines must be snapshotted by the backend when processed.</p>
          </Panel>
        </div>
      </div>}

      {step===4 && <Panel className="max-w-4xl mx-auto">
        <Heading icon="fact_check" title="Process final move-out invoice" subtitle="Review the charges, arrears and deposit before an official invoice is issued."/>
        <div className="ts-detail-grid ts-detail-grid--four">
          <div className="ts-detail"><div className="ts-detail-label">Inspection</div><div className="ts-detail-value">{complete?'Completed':'Not yet completed'}</div></div>
          <div className="ts-detail"><div className="ts-detail-label">Items</div><div className="ts-detail-value">{charges.length}</div></div>
          <div className="ts-detail"><div className="ts-detail-label">Charges</div><div className="ts-detail-value">{money(subtotal)}</div></div>
          <div className="ts-detail"><div className="ts-detail-label">Deposit</div><div className="ts-detail-value">{money(agreedDeposit)}</div></div>
        </div>
        <div className="ts-soft-notice"><Icon name="shield"/>
          {settlement
            ? 'An official invoice and deposit settlement have been recorded. The financial figures are locked.'
            : 'Processing uses your server-side invoices, payment allocations and actual security deposit. The operation is atomic and refuses unreconciled balances. Verify the SQL migrations are installed before proceeding.'}
        </div>
        <label className="text-[12px] mt-5 flex items-start gap-3 p-4 rounded-xl bg-[#edf8f0]">
          <input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/>
          I have reviewed the inspection charges, outstanding invoices and security deposit.
        </label>
        <div className="flex flex-wrap gap-3 justify-end mt-5">
          <button type="button" className="ts-button ts-button--secondary" onClick={()=>setStep(3)}>Back to settlement</button>
          <button type="button" className="ts-button ts-button--primary"
            disabled={busy || !complete || !ack || !!settlement}
            onClick={()=>void processInvoice()}>
            <Icon name="verified"/> {busy?'Processing…':settlement?'Invoice processed':'Confirm & Process Invoice'}
          </button>
        </div>
      </Panel>}

      {step===5 && <div className="space-y-5">
        <Panel>
          <Heading icon="article" title="Final settlement statement" subtitle={financialReady?'Official settlement from your finalized invoice.':'Draft preview until the final invoice has been processed.'}/>
          <div className={`rounded-xl p-3 text-[12px] font-extrabold mb-4 ${financialReady?'bg-[#e2f2e8] text-[#1e6a59]':'bg-[#fff7df] text-[#795e13]'}`}>
            {financialReady?`FINALIZED · ${finalInvoice?.invoice_number}`:'DRAFT — NOT A FINAL INVOICE'}
          </div>
          <div className="flex flex-wrap justify-between gap-4 border-b border-[#dcece2] pb-5">
            <div><h3 className="font-['Newsreader'] text-3xl text-[#10211c]">Dwellio</h3><p className="text-[12px] text-[#737875]">{lease.propertyName}</p></div>
            <div className="text-right"><p className="ts-eyebrow">Move-out settlement statement</p><strong className="text-[12px]">{financialReady?finalInvoice?.invoice_number:'Not issued'}</strong>
              <p className="text-[11px] text-[#737875]">{dateLabel(inspection?.inspected_at??inspectionDate)}</p></div>
          </div>
          <div className="mt-5 grid sm:grid-cols-2 gap-4">
            <div><p className="ts-eyebrow">Tenant</p><strong>{profile.tenant.full_name}</strong><p className="text-[12px] text-[#737875]">{profile.tenant.phone}</p></div>
            <div><p className="ts-eyebrow">Property / unit</p><strong>{lease.propertyName}</strong><p className="text-[12px] text-[#737875]">{lease.unitName}</p></div>
          </div>
          <div className="mt-6">{charges.map(c=><AmountRow key={c.id} label={c.title+(c.description?` — ${c.description}`:'')} value={c.amount}/>)}
            <AmountRow label="Inspection charges" value={subtotal} strong/>
            {arrearSources.map(src=><AmountRow key={src.invoiceNumber} label={`Unpaid source: ${src.invoiceNumber}`} value={src.amount}/>)}
            <AmountRow label="Previous arrears" value={doc.previousArrears}/>
            <AmountRow label="Security deposit" value={doc.deposit}/>
            <AmountRow label="Deposit applied" value={doc.applied}/>
            <AmountRow label="Tenant payable" value={doc.payable}/>
            <AmountRow label="Deposit refundable (manual)" value={doc.refundable}/>
          </div>
        </Panel>
        <div className="flex flex-wrap gap-3 justify-end">
          <button type="button" className="ts-button ts-button--secondary"
            onClick={()=>printMoveOutDraft(doc)}><Icon name="print"/> {financialReady?'Print invoice':'Print draft'}</button>
          <button type="button" className="ts-button ts-button--primary"
            onClick={()=>downloadMoveOutDraftPdf(doc)}><Icon name="download"/> {financialReady?'Download invoice PDF':'Download draft PDF'}</button>
          <button type="button" className="ts-button ts-button--secondary" onClick={()=>setStep(6)}>SMS preview <Icon name="arrow_forward"/></button>
        </div>
      </div>}

      {step===6 && <Panel>
        <Heading icon="sms" title="Final invoice via SMS" subtitle="Africa's Talking delivery will contain the full itemized statement with no link."/>
        <div className="grid sm:grid-cols-2 gap-4 mb-5">
          <div className="ts-detail"><div className="ts-detail-label">Recipient</div><div className="ts-detail-value">{profile.tenant.full_name}</div></div>
          <div className="ts-detail"><div className="ts-detail-label">Phone</div><div className="ts-detail-value">{profile.tenant.phone}</div></div>
        </div>
        <div className="rounded-xl bg-[#edf8f0] p-5 whitespace-pre-wrap font-mono text-[11px] leading-6 text-[#304c3e]">
          {[
            financialReady?'DWELLIO FINAL MOVE-OUT SETTLEMENT':'DWELLIO · MOVE-OUT SETTLEMENT DRAFT (NOT SENT)',
            `Invoice: ${doc.invoiceNumber}`,
            `Tenant: ${profile.tenant.full_name}`,
            `Property: ${lease.propertyName}, Unit: ${lease.unitName}`,
            ...charges.map(c=>`Charge: ${c.title} — ${money(c.amount)}${c.description?` (${c.description})`:''}`),
            `Inspection total: ${money(subtotal)}`,
            ...arrearSources.map(src=>`Unpaid invoice ${src.invoiceNumber}: ${money(src.amount)}`),
            `Historical arrears: ${money(doc.previousArrears)}`,
            `Deposit held: ${money(doc.deposit)}`,
            `Deposit applied: ${money(doc.applied)}`,
            `Amount owed: ${money(doc.payable)}`,
            `Deposit refundable: ${money(doc.refundable)}`,
            'Refunds handled manually. No tenant portal link.',
          ].join('\n')}
        </div>
        <div className="ts-soft-notice"><Icon name="info"/>
          The actual message is generated server-side from the finalized settlement snapshot, with itemized inspection charges and original invoice references. There is no portal link. SMS provider acceptance does not guarantee handset delivery.
        </div>
        <div className="flex justify-end gap-3 mt-4">
          <button className="ts-button ts-button--primary"
            disabled={!financialReady || busy || (!!workspace?.smsDelivery && workspace.smsDelivery.status!=='failed')}
            title={!financialReady?'Process the official settlement first':'Only failed SMS submissions may be retried'}
            onClick={()=>setSmsConfirmation(true)}>
            <Icon name="send"/> {workspace?.smsDelivery?.status==='failed'?'Retry failed SMS':'Send finalized SMS'}
          </button>
          {workspace?.smsDelivery && <Chip>{`SMS: ${workspace.smsDelivery.status} · attempt ${workspace.smsDelivery.attempt_count}`}</Chip>
          <button className="ts-button ts-button--secondary" onClick={()=>setStep(7)}>Continue to closeout <Icon name="arrow_forward"/></button>
        </div>
      </Panel>}

      {step===7 && <Panel className="max-w-4xl mx-auto">
        <Heading icon="lock_reset" title="Closeout & vacate" subtitle="Official termination is a separate, permission-checked operation after processing the final invoice."/>
        <div className="ts-detail-grid">
          <div className="ts-detail"><div className="ts-detail-label">Tenant</div><div className="ts-detail-value">{profile.tenant.full_name}</div></div>
          <div className="ts-detail"><div className="ts-detail-label">Lease status</div><div className="ts-detail-value">{lease.status.replaceAll('_',' ')}</div></div>
          <div className="ts-detail"><div className="ts-detail-label">Unit</div><div className="ts-detail-value">{lease.propertyName} · {lease.unitName}</div></div>
          <div className="ts-detail"><div className="ts-detail-label">Final invoice</div><div className="ts-detail-value">{finalInvoice?.invoice_number ?? 'Not processed'}</div></div>
        </div>
        <label className="block text-[12px] font-bold text-[#42594d] mt-5">Actual handover date
          <input type="date" value={confirmedDate} onChange={e=>setConfirmedDate(e.target.value)}
            className="mt-2 block rounded-xl border border-[#dcece2] p-3 bg-[#edf8f0]"/>
        </label>
        <div className="space-y-3 mt-5">
          <label className="flex gap-3 items-center text-[12px]"><input type="checkbox" checked={keysReturned} onChange={e=>setKeysReturned(e.target.checked)}/> Keys and access devices surrendered</label>
          <label className="flex gap-3 items-center text-[12px]"><input type="checkbox" checked={vacated} onChange={e=>setVacated(e.target.checked)}/> Tenant has physically vacated the unit</label>
        </div>
        <div className="ts-soft-notice"><Icon name="warning"/>
          Finalize Move-Out must atomically set leases.status to terminated, record terminated_at and move_out_date, and mark the unit vacant only when no conflicting occupancy or reservation exists. Outstanding debt and manual refund obligations must remain recorded.
        </div>
        <div className="flex flex-wrap justify-end gap-3 mt-6">
          <button className="ts-button ts-button--secondary" onClick={()=>setStep(5)}>View statement</button>
          <button className="ts-button ts-button--primary"
            disabled={busy || !complete || !keysReturned || !vacated || !finalInvoice || lease.status === 'terminated'}
            title={!finalInvoice?'A processed, non-void move-out invoice is required before closeout.':'Terminate lease and release the unit'}
            onClick={()=>setCloseConfirmation(true)}>
            <Icon name="lock_reset"/> {lease.status==='terminated'?'Tenancy closed':'Finalize Move-Out'}
          </button>
        </div>
      </Panel>}

      {smsConfirmation && <div className="ts-modal-shade">
        <div className="ts-modal" role="dialog" aria-modal="true" aria-label="Confirm full statement SMS">
          <div className="ts-modal-heading"><span className="ts-card-icon"><Icon name="sms"/></span>
            <div><p className="ts-eyebrow">Full statement SMS</p><h2>Send final move-out statement?</h2></div>
            <button type="button" className="ts-icon-button" disabled={busy}
              onClick={()=>setSmsConfirmation(false)} aria-label="Close"><Icon name="close"/></button>
          </div>
          <p className="ts-muted-note">
            Send the entire itemized settlement to {profile.tenant.full_name} at {profile.tenant.phone}.
            No invoice portal link is included. All amounts come from the finalized backend snapshot.
          </p>
          <div className="ts-modal-actions">
            <button className="ts-button ts-button--secondary" disabled={busy}
              onClick={()=>setSmsConfirmation(false)}>Cancel</button>
            <button className="ts-button ts-button--primary" disabled={busy}
              onClick={()=>void sendSms()}>{busy?'Sending…':'Confirm SMS send'}</button>
          </div>
        </div>
      </div>}
      
      {closeConfirmation && <div className="ts-modal-shade">
        <div className="ts-modal" role="dialog" aria-modal="true" aria-label="Confirm tenancy termination">
          <div className="ts-modal-heading"><span className="ts-card-icon"><Icon name="lock_reset"/></span>
            <div><p className="ts-eyebrow">Final confirmation</p><h2>Terminate Lease & Vacate Unit?</h2></div>
            <button type="button" className="ts-icon-button" disabled={busy}
              onClick={()=>setCloseConfirmation(false)} aria-label="Close"><Icon name="close"/></button>
          </div>
          <p className="ts-muted-note">
            This authorized action sets the lease status to terminated, records its termination date and marks
            { ' ' }{lease.unitName} as vacant only if there is no conflicting live or reserved tenancy.
            Financial history, unpaid balances and any manual refund obligations remain recorded.
          </p>
          <div className="ts-soft-notice"><Icon name="shield"/>
            Inspection completed · Invoice {finalInvoice?.invoice_number ?? 'not available'} · Move-out date {dateLabel(confirmedDate)}
          </div>
          {error && <p role="alert" className="ts-form-error">{error}</p>}
          <div className="ts-modal-actions">
            <button className="ts-button ts-button--secondary" disabled={busy}
              onClick={()=>setCloseConfirmation(false)}>Cancel</button>
            <button className="ts-button ts-button--primary" disabled={busy}
              onClick={()=>void closeout()}>{busy?'Finalizing…':'Terminate Lease & Mark Unit Vacant'}</button>
          </div>
        </div>
      </div>}

      {showForm && <div className="ts-modal-shade">
        <form className="ts-modal" role="dialog" aria-modal="true" aria-label={editCharge?'Edit inspection charge':'Add inspection charge'} onSubmit={e=>void saveCharge(e)}>
          <div className="ts-modal-heading"><span className="ts-card-icon"><Icon name="handyman"/></span>
            <div><p className="ts-eyebrow">Inspection ledger</p><h2>{editCharge?'Edit charge':'Add inspection charge'}</h2></div>
            <button type="button" disabled={busy} onClick={()=>setShowForm(false)} className="ts-icon-button" aria-label="Close"><Icon name="close"/></button>
          </div>
          <div className="ts-form-stack">
            <label>Charge name<input required minLength={2} maxLength={150} value={chargeTitle} onChange={e=>setChargeTitle(e.target.value)} placeholder="e.g. Repainting"/></label>
            <label>Amount (KSh)<input required type="number" min="0.01" step="0.01" value={chargeAmount} onChange={e=>setChargeAmount(e.target.value)}/></label>
            <label>Description (optional)<textarea rows={3} maxLength={1000} value={chargeDescription} onChange={e=>setChargeDescription(e.target.value)} placeholder="Location, damage, repair details..."/></label>
          </div>
          {error && <p role="alert" className="ts-form-error">{error}</p>}
          <div className="ts-modal-actions">
            <button type="button" disabled={busy} className="ts-button ts-button--secondary" onClick={()=>setShowForm(false)}>Cancel</button>
            <button disabled={busy} className="ts-button ts-button--primary" type="submit">{busy?'Saving…':'Save charge'}</button>
          </div>
        </form>
      </div>}
    </div>
  )
}
