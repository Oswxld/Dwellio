import { useMemo, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { BuildingSetup, FloorDraft } from '../types/domain'

type Step = 1 | 2 | 3 | 4 | 5
const uid = () => crypto.randomUUID()
const makeFloor = (index: number): FloorDraft => ({ id: uid(), name: index === 0 ? 'Ground' : `Floor ${index}`, floorNumber: index, unitCount: 1, units: [{ id: uid(), name: '', position: 0 }] })

export default function OnboardingPage({ user, onComplete }: { user: User; onComplete: () => void }) {
  const [step, setStep] = useState<Step>(1)
  const [orgName, setOrgName] = useState('')
  const [propertyName, setPropertyName] = useState('')
  const [address, setAddress] = useState('')
  const [buildingCount, setBuildingCount] = useState(1)
  const [buildings, setBuildings] = useState<BuildingSetup[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const progress = useMemo(() => `${Math.round((step / 5) * 100)}%`, [step])

  function makeBuildings(count: number) {
    setBuildings(Array.from({ length: count }, (_, i) => buildings[i] ?? ({ id: uid(), name: `Building ${i + 1}`, floors: [] })))
  }

  function configureBuildingFloors(buildingIndex: number, count: number) {
    setBuildings(prev => prev.map((b, i) => {
      if (i !== buildingIndex) return b
      const floors = Array.from({ length: count }, (_, floorIndex) => b.floors[floorIndex] ?? makeFloor(floorIndex))
      return { ...b, floors }
    }))
  }

  function setFloor(buildingIndex: number, floorIndex: number, patch: Partial<FloorDraft>) {
    setBuildings(prev => prev.map((b, bi) => bi !== buildingIndex ? b : ({ ...b, floors: b.floors.map((f, fi) => fi !== floorIndex ? f : { ...f, ...patch }) })))
  }

  function setUnitName(buildingIndex: number, floorIndex: number, position: number, name: string) {
    setBuildings(prev => prev.map((b, bi) => bi !== buildingIndex ? b : ({ ...b, floors: b.floors.map((f, fi) => fi !== floorIndex ? f : ({ ...f, units: f.units.map(u => u.position === position ? { ...u, name } : u) })) })))
  }

  function validateAndNext() {
    setError('')
    if (step === 1 && !orgName.trim()) return setError('Enter your organization name.')
    if (step === 2 && !propertyName.trim()) return setError('Enter your property name.')
    if (step === 3) {
      if (buildingCount < 1 || buildingCount > 100) return setError('Choose between 1 and 100 buildings.')
      if (buildings.length !== buildingCount) return setError('Generate the building fields first.')
    }


    if (step === 4 && buildings.some(b => !b.name.trim() || b.floors.length < 1 || b.floors.some(f => !f.name.trim() || f.unitCount < 1))) return setError('Every building needs a name and at least one configured floor with at least one unit.')
    setStep((step + 1) as Step)
  }


  async function finish() {

    const hasInvalidUnits = buildings.some(
  building =>
    !building.name.trim() ||
    building.floors.some(
      floor =>
        !floor.name.trim() ||
        floor.units.length !== floor.unitCount ||
        floor.units.some(unit => !unit.name.trim())
    )
)

if (hasInvalidUnits) {
  setError(
    'Please give every building, floor, and unit a name before finishing setup.'
  )
  setSaving(false)
  return
}



  setSaving(true)
  setError('')

  try {
    const payload = buildings.map((building) => ({
      name: building.name.trim(),
      floors: building.floors.map((floor) => ({
        name: floor.name.trim(),
        floorNumber: floor.floorNumber,
        units: floor.units.map((unit) => ({
          name: unit.name.trim(),
        })),
      })),
    }))

    const { data: organizationId, error: onboardingError } =
      await supabase.rpc('complete_onboarding', {
        p_org_name: orgName.trim(),
        p_org_slug: slugify(orgName),
        p_property_name: propertyName.trim(),
        p_address: address.trim(),
        p_buildings: payload,
      })

    if (onboardingError) {
      throw onboardingError
    }

    if (!organizationId) {
      throw new Error('Onboarding completed without creating an organization.')
    }

    onComplete()
  } catch (err) {
    console.error('Onboarding failed:', err)

    setError(
      err instanceof Error
        ? err.message
        : 'Could not finish setup. Please try again.'
    )
  } finally {
    setSaving(false)
  }
}

  return <main className="onboarding-shell">
    <header className="onboarding-header"><div className="brand">dwellio<span>.</span></div><div className="progress-wrap"><span>Setup {step}/5</span><div className="progress"><i style={{ width: progress }} /></div></div></header>
    <section className="setup-card">
      <p className="eyebrow">PROPERTY SETUP</p>
      {step === 1 && <><h1>Let's set up your organization.</h1><p className="muted">Your organization is the top-level account that can own multiple properties.</p><label>Organization name<input autoFocus value={orgName} onChange={e => setOrgName(e.target.value)} placeholder="Brooks Limited" /></label></>}
      {step === 2 && <><h1>Add your first property.</h1><p className="muted">This is the apartment, estate or building complex you're managing.</p><label>Property name<input autoFocus value={propertyName} onChange={e => setPropertyName(e.target.value)} placeholder="Brooks Gataka" /></label><label>Address <span className="optional">optional</span><input value={address} onChange={e => setAddress(e.target.value)} placeholder="Gataka Road, Nairobi" /></label></>}
      {step === 3 && <><h1>How many buildings?</h1><p className="muted">Each building can have its own name and its own number of floors.</p><label>Number of buildings<input type="number" min={1} max={100} value={buildingCount} onChange={e => setBuildingCount(Math.max(1, Number(e.target.value)))} /></label><button className="secondary full" onClick={() => makeBuildings(buildingCount)}>Generate building fields</button>{buildings.length > 0 && <div className="mini-list">{buildings.map((b, i) => <input key={b.id} value={b.name} onChange={e => setBuildings(prev => prev.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} placeholder={`Building ${i + 1}`} />)}</div>}</>}
      {step === 4 && <><h1>Configure each building.</h1><p className="muted">Floors can have different numbers of units. Name floors however the property actually labels them.</p><div className="building-configs">{buildings.map((b, bi) => <article className="config-card" key={b.id}><input className="config-title" value={b.name} onChange={e => setBuildings(prev => prev.map((x, i) => i === bi ? { ...x, name: e.target.value } : x))} /><div className="inline-row"><span>Number of floors</span><input type="number" min={1} max={100} value={b.floors.length || 1} onChange={e => configureBuildingFloors(bi, Math.max(1, Number(e.target.value)))} /></div><div className="floor-list">{b.floors.map((f, fi) => <div className="floor-row" key={f.id}><input value={f.name} onChange={e => setFloor(bi, fi, { name: e.target.value })} placeholder="Floor name" /><input type="number" min={1} max={500} value={f.unitCount} onChange={e => { const count = Math.max(1, Number(e.target.value)); const units = Array.from({ length: count }, (_, p) => f.units[p] ?? ({ id: uid(), name: '', position: p })); setFloor(bi, fi, { unitCount: count, units }) }} aria-label={`Units on ${f.name}`} /><span>units</span></div>)}</div></article>)}</div></>}
      {step === 5 && <VisualBuilder buildings={buildings} buildingIndex={0} setBuildings={setBuildings} setUnitName={setUnitName} />}
      {error && <div className="alert error">{error}</div>}
      <div className="actions">{step > 1 && <button className="secondary" onClick={() => { setError(''); setStep((step - 1) as Step) }}>Back</button>}{step < 5 ? <button className="primary" onClick={validateAndNext}>Continue</button> : <button className="primary" onClick={finish} disabled={saving}>{saving ? 'Creating property…' : 'Finish setup'}</button>}</div>
    </section>
  </main>
}

function VisualBuilder({ buildings, buildingIndex, setBuildings, setUnitName }: { buildings: BuildingSetup[]; buildingIndex: number; setBuildings: React.Dispatch<React.SetStateAction<BuildingSetup[]>>; setUnitName: (bi: number, fi: number, position: number, name: string) => void }) {
  const [selectedBuilding, setSelectedBuilding] = useState(buildingIndex)
  const building = buildings[selectedBuilding]
  const floors = [...(building?.floors ?? [])].sort((a, b) => a.floorNumber - b.floorNumber)
  if (!building) return null

  function nextId(floorIndex: number, position: number) {
    if (position + 1 < floors[floorIndex].unitCount) return `unit-${floors[floorIndex].id}-${position + 1}`
    if (floorIndex + 1 < floors.length) return `unit-${floors[floorIndex + 1].id}-0`
    return null
  }

  return <div className="visual-builder"><div className="builder-heading"><div><h1>Name your units.</h1><p className="muted">Start at the bottom floor. Enter moves left → right, then up to the next floor.</p></div><select value={selectedBuilding} onChange={e => setSelectedBuilding(Number(e.target.value))}>{buildings.map((b, i) => <option value={i} key={b.id}>{b.name}</option>)}</select></div><div className="building-visual">{floors.map((floor, fi) => <div className="visual-floor" key={floor.id}><div className="floor-label">{floor.name}</div><div className="unit-row">{Array.from({ length: floor.unitCount }, (_, pos) => { const id = `unit-${floor.id}-${pos}`; const unit = floor.units.find(u => u.position === pos)!; return <input key={id} id={id} value={unit.name} placeholder="Unit" onChange={e => setUnitName(selectedBuilding, building.floors.findIndex(f => f.id === floor.id), pos, e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); const next = nextId(fi, pos); if (next) document.getElementById(next)?.focus() } }} /> })}</div></div>)}</div><p className="builder-note">The bottom row is the lowest floor. Name units B01, A12, 204, Shop 1, etc. The exact naming is yours.</p></div>
}

function slugify(value: string) {
  const slug = value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug || `org-${crypto.randomUUID().slice(0, 8)}`
}
