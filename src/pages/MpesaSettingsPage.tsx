import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

type Property = { id: string; name: string }
type Setup = { property_id: string; paybill_shortcode: string | null; setup_status: string; verified_at?: string | null }

export default function MpesaSettingsPage({ organizationId }: { organizationId: string }) {
  const [properties, setProperties] = useState<Property[]>([])
  const [propertyId, setPropertyId] = useState('')
  const [setup, setSetup] = useState<Setup | null>(null)
  const [paybill, setPaybill] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    supabase.from('properties').select('id,name').eq('organization_id', organizationId)
      .is('deleted_at', null).order('name')
      .then(({ data, error: resultError }) => {
        if (!active) return
        if (resultError) setError(resultError.message)
        else {
          const rows = (data ?? []) as Property[]
          setProperties(rows)
          setPropertyId(rows[0]?.id ?? '')
        }
        setLoading(false)
      })
    return () => { active = false }
  }, [organizationId])

  useEffect(() => {
    let active = true
    setSetup(null)
    setPaybill('')
    setError('')
    setNotice('')
    if (!propertyId) return
    setLoading(true)
    supabase.rpc('get_my_property_mpesa_settings', { p_property_id: propertyId })
      .then(({ data, error: resultError }) => {
        if (!active) return
        if (resultError) setError(resultError.message)
        else {
          const settings = data as Setup
          setSetup(settings)
          setPaybill(settings.paybill_shortcode ?? '')
        }
        setLoading(false)
      })
    return () => { active = false }
  }, [propertyId])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setNotice('')
    if (!/^[0-9]{5,7}$/.test(paybill.trim())) {
      setError('Enter a valid PayBill shortcode, using digits only.')
      return
    }
    setBusy(true)
    try {
      const { data, error: resultError } = await supabase.rpc(
        'request_my_property_mpesa_setup',
        { p_property_id: propertyId, p_paybill_shortcode: paybill.trim() },
      )
      if (resultError) throw resultError
      const result = data as Setup
      setSetup(result)
      setPaybill(result.paybill_shortcode ?? '')
      setNotice(result.setup_status === 'pending'
        ? 'PayBill submitted. Dwellio must verify the merchant and provision its Daraja access before payments are enabled.'
        : 'Property payment information saved.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save PayBill setup.')
    } finally { setBusy(false) }
  }

  const status = setup?.setup_status ?? 'not_configured'
  const statusCopy: Record<string,string> = {
    not_configured: 'No PayBill submitted',
    pending: 'Awaiting Dwellio verification',
    sandbox_ready: 'Sandbox testing enabled — no live funds',
    live_ready: 'Production verified',
    disabled: 'Payment collection disabled',
  }

  return <section style={{ padding: '36px clamp(18px,4vw,46px)', maxWidth: 850 }}>
    <div style={{ display: 'grid', gap: 9, marginBottom: 22 }}>
      <p style={{ fontSize: 11, letterSpacing: 2, fontWeight: 800, color: '#1d6958' }}>LANDLORD SETTINGS</p>
      <h1 style={{ fontSize: 30, letterSpacing: -1.1, fontFamily: 'Manrope,sans-serif' }}>M-Pesa PayBill Setup</h1>
      <p style={{ color: '#718078', lineHeight: 1.65, fontSize: 13 }}>
        Link your property's receiving PayBill. Your tenants will pay to this PayBill using their unique Dwellio account reference.
        You retain ownership of the PayBill and receive payments directly.
      </p>
    </div>

    <div style={{ background: 'white', padding: '25px', border: '1px solid #e2e8e4', borderRadius: 18, boxShadow: '0 15px 35px #10211c0d' }}>
      <label style={{ marginBottom: 20 }}>
        Property
        <select value={propertyId} disabled={loading || properties.length === 0}
          onChange={event => setPropertyId(event.target.value)}>
          {properties.map(p => <option value={p.id} key={p.id}>{p.name}</option>)}
        </select>
      </label>

      <form onSubmit={event => void submit(event)} className="form-stack" style={{ marginTop: 0 }}>
        <label>
          Receiving PayBill number
          <input inputMode="numeric" type="text" value={paybill} maxLength={7} autoComplete="off"
            onChange={event => setPaybill(event.target.value)} placeholder="e.g. 123456" required />
        </label>
        <div style={{ padding: 14, borderRadius: 12, background: '#e7f7ee', display: 'grid', gap: 7 }}>
          <strong style={{ color: '#10211c', fontSize: 13 }}>Setup status: {statusCopy[status] ?? status}</strong>
          <p style={{ fontSize: 12, color: '#48665a', lineHeight: 1.6 }}>
            Dwellio provisions and verifies your merchant API access separately. Do not enter Daraja keys,
            secrets, passkeys or M-Pesa PINs here.
          </p>
        </div>
        {error && <div className="alert error" role="alert">{error}</div>}
        {notice && <div className="alert success" role="status">{notice}</div>}
        <button className="primary" type="submit" disabled={busy || loading || !propertyId}>
          {busy ? 'Saving…' : 'Submit PayBill for setup'}
        </button>
      </form>
    </div>
    <p style={{ fontSize: 12, color: '#718078', marginTop: 18, lineHeight: 1.75 }}>
      Changing an approved PayBill automatically requires re-verification before accepting further payments.
      Tenant account references are generated separately and attached to the selected property.
    </p>
  </section>
}
