import { useState, type FormEvent } from 'react'
import type { PropertyBuilding } from '../data/propertyStructureRepository'
import { createBuildingFloorUnits, createFloorUnits } from '../data/propertyQuickAddRepository'

type Mode = 'building' | 'floor'
type UnitDraft = { key: number; name: string; rent: string }
type Props = {
  mode: Mode
  propertyId: string
  buildings: PropertyBuilding[]
  onClose: () => void
  onSaved: () => Promise<void>
}

const inputClass = 'mt-1 w-full rounded-xl border border-[#dcece2] bg-white px-3 py-2.5 text-sm text-[#10211c] outline-none focus:border-[#1e6a59]'
let nextKey = 1

export default function PropertyStructureWizard({
  mode, propertyId, buildings, onClose, onSaved,
}: Props) {
  const [buildingName, setBuildingName] = useState('')
  const [buildingId, setBuildingId] = useState(buildings[0]?.id ?? '')
  const [floorName, setFloorName] = useState('')
  const [floorNumber, setFloorNumber] = useState('')
  const [units, setUnits] = useState<UnitDraft[]>([
    { key: nextKey++, name: '', rent: '' },
  ])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function updateUnit(key: number, field: 'name' | 'rent', value: string) {
    setUnits(current => current.map(unit =>
      unit.key === key ? { ...unit, [field]: value } : unit,
    ))
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setError('')
    if (mode === 'floor' && !buildingId) {
      setError('Choose an existing building.')
      return
    }
    if (!Number.isSafeInteger(Number(floorNumber)) || floorNumber.trim() === '') {
      setError('Enter a whole-number floor number (0 for ground floor).')
      return
    }
    const names = units.map(unit => unit.name.trim().toLowerCase())
    if (names.some(name => !name) || new Set(names).size !== names.length) {
      setError('Every unit needs a unique name on its floor.')
      return
    }
    const mapped = units.map(unit => ({
      name: unit.name.trim(),
      defaultRent: unit.rent.trim() === '' ? null : Number(unit.rent),
    }))
    if (mapped.some(unit => unit.defaultRent !== null &&
      (!Number.isFinite(unit.defaultRent) || unit.defaultRent < 0))) {
      setError('Enter a valid default rent amount or leave it blank.')
      return
    }

    setBusy(true)
    try {
      if (mode === 'building') {
        await createBuildingFloorUnits({
          propertyId,
          buildingName: buildingName.trim(),
          floorName: floorName.trim(),
          floorNumber: Number(floorNumber),
          units: mapped,
        })
      } else {
        await createFloorUnits({
          propertyId,
          buildingId,
          floorName: floorName.trim(),
          floorNumber: Number(floorNumber),
          units: mapped,
        })
      }
      await onSaved()
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to create the property structure.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[91] flex items-end justify-center bg-[#10211c]/50 p-0 backdrop-blur-sm sm:items-center sm:p-6">
      <section role="dialog" aria-modal="true"
        aria-label={mode==='building'?'Add building with floor and units':'Add floor with units'}
        className="max-h-[94vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-[#edfdf3] shadow-2xl sm:rounded-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#dcece2] bg-[#edfdf3] px-5 py-4">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-[#1e6a59]">
              COMPLETE PROPERTY STRUCTURE
            </div>
            <h2 className="font-['Newsreader'] text-2xl font-semibold text-[#111e19]">
              {mode==='building'?'Add building, floor & units':'Add floor & units'}
            </h2>
            <p className="mt-1 text-xs text-[#65776d]">
              Everything is saved together. No empty buildings or floors.
            </p>
          </div>
          <button type="button" aria-label="Close" disabled={busy} onClick={onClose}
            className="rounded-lg bg-white p-2 text-[#424845] disabled:opacity-50">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <form className="space-y-5 p-5" onSubmit={event => void submit(event)}>
          {error && <div role="alert" className="rounded-xl bg-[#fff0ee] px-4 py-3 text-sm text-[#93000a]">{error}</div>}

          <div className="rounded-2xl border border-[#dcece2] bg-white p-4">
            <h3 className="mb-3 text-sm font-bold text-[#10211c]">1. Building</h3>
            {mode==='building'? (
              <label className="block text-xs font-semibold text-[#424845]">Building name
                <input className={inputClass} value={buildingName}
                  onChange={e=>setBuildingName(e.target.value)} maxLength={100} required
                  placeholder="e.g. Block A"/>
              </label>
            ): (
              <label className="block text-xs font-semibold text-[#424845]">Existing building
                <select className={inputClass} value={buildingId}
                  onChange={e=>setBuildingId(e.target.value)} required>
                  {buildings.map(building => <option key={building.id} value={building.id}>{building.name}</option>)}
                </select>
              </label>
            )}
          </div>

          <div className="rounded-2xl border border-[#dcece2] bg-white p-4">
            <h3 className="mb-3 text-sm font-bold text-[#10211c]">2. Floor</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-semibold text-[#424845]">Floor name
                <input className={inputClass} value={floorName}
                  onChange={e=>setFloorName(e.target.value)} maxLength={100}
                  required placeholder="e.g. Ground Floor"/>
              </label>
              <label className="block text-xs font-semibold text-[#424845]">Floor number
                <input type="number" step="1" className={inputClass} value={floorNumber}
                  onChange={e=>setFloorNumber(e.target.value)}
                  required placeholder="0 for ground floor"/>
              </label>
            </div>
          </div>

          <div className="rounded-2xl border border-[#dcece2] bg-white p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-[#10211c]">3. Units ({units.length})</h3>
              <button type="button" onClick={() => setUnits(prev =>
                [...prev, { key: nextKey++, name: '', rent: '' }])}
                disabled={busy || units.length >= 150}
                className="rounded-lg bg-[#e7f7ee] px-3 py-2 text-xs font-bold text-[#1e6a59] disabled:opacity-50">
                + Add another unit
              </button>
            </div>
            <div className="space-y-3">
              {units.map((unit,index) => (
                <div key={unit.key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2 rounded-xl bg-[#f3fbf6] p-3">
                  <label className="block text-[11px] font-semibold text-[#424845]">Unit {index+1} name
                    <input className={inputClass} value={unit.name} maxLength={100}
                      onChange={e=>updateUnit(unit.key,'name',e.target.value)}
                      required placeholder="e.g. A01"/>
                  </label>
                  <label className="block text-[11px] font-semibold text-[#424845]">Default rent (KSh)
                    <input className={inputClass} type="number" min="0" step="0.01"
                      value={unit.rent} onChange={e=>updateUnit(unit.key,'rent',e.target.value)}
                      placeholder="Optional"/>
                  </label>
                  <button type="button" aria-label={`Remove unit ${index+1}`}
                    disabled={busy || units.length===1}
                    onClick={()=>setUnits(prev=>prev.filter(item=>item.key!==unit.key))}
                    className="rounded-lg p-2 text-[#9e3f38] disabled:opacity-30">
                    <span className="material-symbols-outlined">delete</span>
                  </button>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs leading-5 text-[#65776d]">
              Units begin as vacant. Usage-based services still require meter configuration after creation.
            </p>
          </div>

          <div className="flex justify-end gap-2 border-t border-[#dcece2] pt-4">
            <button type="button" disabled={busy} onClick={onClose}
              className="rounded-xl px-4 py-2.5 text-sm font-semibold text-[#424845] disabled:opacity-40">Cancel</button>
            <button type="submit" disabled={busy}
              className="rounded-xl bg-[#10211c] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
              {busy?'Saving complete structure…':
                mode==='building'?'Create building, floor & units':'Create floor & units'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}
