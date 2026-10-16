import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import PropertyStructureWizard from './PropertyStructureWizard'

import UnitBillingPanel from './UnitBillingPanel'

import {
  addPropertyBuilding,
  addPropertyFloor,
  addPropertyUnit,
  fetchPropertyStructure,
  type PropertyStructure,
  type PropertyUnit,
} from '../data/propertyStructureRepository'

type Action = 'unit' | 'floor' | 'building' | null

type Props = {
  propertyId: string
  initialData: PropertyStructure
  onUnitAdded: () => Promise<void>
  initialAction?: 'building' | 'floor' | 'unit'
}

const stateOrder = [
  { key: 'occupied', label: 'Occupied', dot: 'occupied' },
  { key: 'vacant', label: 'Vacant', dot: 'vacant' },
  { key: 'reserved', label: 'Reserved', dot: 'reserved' },
  { key: 'under_maintenance', label: 'Maintenance', dot: 'maintenance' },
  { key: 'unavailable', label: 'Unavailable', dot: 'unavailable' },
] as const

function unitStatus(status: PropertyUnit['status']) {
  switch (status) {
    case 'under_maintenance': return 'Maintenance'
    case 'unavailable': return 'Unavailable'
    case 'reserved': return 'Reserved'
    case 'occupied': return 'Occupied'
    default: return 'Vacant'
  }
}

export default function PropertyInventoryPanel({ propertyId, initialData, onUnitAdded, initialAction }: Props) {
  const navigate = useNavigate()
  const [structure, setStructure] = useState(initialData)
  const [mode, setMode] = useState<Action>(initialAction === 'unit' ? 'unit' : null)
  const [bundleMode, setBundleMode] = useState<'building' | 'floor' | null>(
    initialAction === 'building' || initialAction === 'floor' ? initialAction : null,
  )
  const [unitName, setUnitName] = useState('')
  const [rent, setRent] = useState('')
  const [buildingName, setBuildingName] = useState('')
  const [floorName, setFloorName] = useState('')
  const [floorNumber, setFloorNumber] = useState('')
  const [buildingId, setBuildingId] = useState('')
  const [floorId, setFloorId] = useState('')
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null)

  useEffect(() => {
    setStructure(initialData)
    setMode(initialAction === 'unit' ? 'unit' : null)
    setBundleMode(initialAction === 'building' || initialAction === 'floor' ? initialAction : null)
    setError('')
    setSuccess('')
    setSelectedUnitId(null)
  }, [initialData, propertyId, initialAction])

  function closeBundle() {
    setBundleMode(null)
    if (initialAction) navigate(`/properties/${propertyId}`, { replace: true })
  }

  async function bundleSaved() {
    const updated = await fetchPropertyStructure(propertyId)
    setStructure(updated)
    setSuccess('Property structure saved with its floor and all units.')
    try {
      await onUnitAdded()
    } catch (refreshError) {
      console.error('[Properties] Structure saved, but service totals could not refresh', refreshError)
      setError('Structure created. Refresh the property to update billing-service meter counts.')
    }
  }

  const totals = useMemo(() => {
    const counts = {
      occupied: 0, vacant: 0, reserved: 0, under_maintenance: 0, unavailable: 0,
    }
    for (const unit of structure.units) {
      if (unit.status in counts && unit.status !== 'deleted') {
        counts[unit.status as keyof typeof counts] += 1
      }
    }
    const total = structure.units.length
    return {
      counts,
      total,
      percentage: total > 0 ? Math.round((counts.occupied / total) * 100) : 0,
    }
  }, [structure.units])

  const selectedUnit = structure.units.find(unit => unit.id === selectedUnitId) ?? null
  const selectedFloor = selectedUnit
    ? structure.floors.find(floor => floor.id === selectedUnit.floor_id) ?? null
    : null
  const selectedBuilding = selectedFloor
    ? structure.buildings.find(building => building.id === selectedFloor.building_id) ?? null
    : null

  const floorsInBuilding = structure.floors.filter(floor => floor.building_id === buildingId)

  const visibleUnits = useMemo(() => {
    const query = search.trim().toLowerCase()
    return query
      ? structure.units.filter(unit => unit.name.toLowerCase().includes(query))
      : structure.units
  }, [structure.units, search])

  function open(action: Exclude<Action, null>) {
    setMode(action)
    setError('')
    setSuccess('')
    setUnitName('')
    setRent('')
    setBuildingName('')
    setFloorName('')
    setFloorNumber('')
    const firstBuildingId = structure.buildings[0]?.id ?? ''
    setBuildingId(firstBuildingId)
    setFloorId(structure.floors.find(floor => floor.building_id === firstBuildingId)?.id ?? '')
  }

  function selectBuilding(nextId: string) {
    setBuildingId(nextId)
    setFloorId(structure.floors.find(floor => floor.building_id === nextId)?.id ?? '')
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!mode || busy) return

    try {
      setBusy(true)
      setError('')
      if (mode === 'building') {
        await addPropertyBuilding(propertyId, buildingName)
      } else if (mode === 'floor') {
        if (!buildingId) throw new Error('Select a building first.')
        if (floorNumber.trim() === '') throw new Error('Enter a floor number.')
        await addPropertyFloor(propertyId, buildingId, floorName, Number(floorNumber))
      } else {
        if (!floorId) throw new Error('Select a floor first.')
        if (rent.trim() && (!Number.isFinite(Number(rent)) || Number(rent) < 0)) {
          throw new Error('Enter a valid default rent amount.')
        }
        await addPropertyUnit(propertyId, floorId, unitName, rent.trim() === '' ? null : Number(rent))
      }

      const completedAction = mode
      const updated = await fetchPropertyStructure(propertyId)
      setStructure(updated)
      setMode(null)
      setSuccess(
        completedAction === 'unit'
          ? 'Unit added successfully. It begins with Vacant status.'
          : completedAction === 'floor'
            ? 'Floor added successfully.'
            : 'Building added successfully.',
      )

      if (completedAction === 'unit') {
        try {
          await onUnitAdded()
        } catch (refreshError) {
          console.error('[Properties] Unit saved, but service summary refresh failed', refreshError)
          setError('The unit was saved, but billing-service meter counts could not refresh. Reload this property to update them.')
        }
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The change could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#1e6a59]">
            Property configuration
          </div>
          <h2 className="mt-1 font-['Newsreader'] text-2xl font-semibold text-[#111e19]">Units & occupancy</h2>
          <p className="mt-1 text-sm text-[#424845]">
            Monitor the property's units, vacancies and building structure.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setBundleMode('building')}
            className="rounded-xl border border-[#dcece2] bg-white px-3 py-2.5 text-xs font-semibold text-[#1e6a59] shadow-sm">
            + Building & floor with units
          </button>
          <button type="button" onClick={() => setBundleMode('floor')} disabled={!structure.buildings.length}
            className="rounded-xl border border-[#dcece2] bg-white px-3 py-2.5 text-xs font-semibold text-[#1e6a59] shadow-sm disabled:opacity-45">
            + Floor with units
          </button>
          <button type="button" onClick={() => open('unit')} disabled={!structure.floors.length}
            className="inline-flex items-center gap-1 rounded-xl bg-[#10211c] px-4 py-2.5 text-xs font-semibold text-white shadow-[0_4px_14px_rgba(16,33,28,.14)] disabled:opacity-45">
            <span className="material-symbols-outlined text-[18px]">add</span>
            Add unit
          </button>
        </div>
      </div>

      {success && <div role="status" className="rounded-xl border border-[#bee8ce] bg-[#e7f7ee] px-4 py-3 text-sm text-[#005142]">{success}</div>}
      {error && !mode && <div role="alert" className="rounded-xl border border-[#ffd9d3] bg-[#fff0ee] px-4 py-3 text-sm text-[#93000a]">{error}</div>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)]">
        <div className="rounded-2xl border border-[#dcece2] bg-white p-5 shadow-[0_12px_34px_rgba(16,33,28,.05)] sm:p-6">
          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#1e6a59]">Property</div>
          <h3 className="mt-1 font-['Newsreader'] text-xl font-semibold text-[#111e19]">Occupancy overview</h3>
          <div className="occupancy-body !gap-6 !px-0 !pb-0 !pt-5">
            <div className="occupancy-ring" style={{ '--progress': `${totals.percentage}%` } as CSSProperties}>
              <div>
                <strong>{totals.percentage}%</strong>
                <span>occupied</span>
              </div>
            </div>
            <div className="occupancy-stats">
              {stateOrder.map(state => (
                <div key={state.key} className="status-row">
                  <span>
                    <i className={state.dot} style={state.key === 'unavailable' ? { background: '#8b9690' } : undefined}/>
                    {state.label}
                  </span>
                  <strong>{totals.counts[state.key]}</strong>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'Total units', value: totals.total, icon: 'meeting_room' },
            { label: 'Occupied', value: totals.counts.occupied, icon: 'check_circle' },
            { label: 'Vacant', value: totals.counts.vacant, icon: 'door_open' },
            { label: 'Buildings', value: structure.buildings.length, icon: 'apartment' },
          ].map(item => (
            <div key={item.label} className="rounded-2xl border border-[#dcece2] bg-white p-4 shadow-[0_8px_24px_rgba(16,33,28,.04)]">
              <div className="flex items-center justify-between gap-1">
                <span className="text-[11px] font-semibold text-[#737875]">{item.label}</span>
                <span className="material-symbols-outlined rounded-lg bg-[#e7f7ee] p-1.5 text-[#1e6a59]">{item.icon}</span>
              </div>
              <div className="mt-4 font-['Newsreader'] text-3xl font-semibold text-[#111e19]">{item.value}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-[#dcece2] bg-white p-5 shadow-[0_12px_34px_rgba(16,33,28,.05)] sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-['Newsreader'] text-xl font-semibold text-[#111e19]">Unit directory</h3>
            <p className="mt-1 text-xs text-[#737875]">Organized by building and floor.</p>
          </div>
          <label className="flex items-center gap-2 rounded-xl bg-[#edfdf3] px-3 py-2">
            <span className="material-symbols-outlined text-[18px] text-[#1e6a59]">search</span>
            <input type="search" aria-label="Search property units" value={search}
              onChange={event => setSearch(event.target.value)} placeholder="Search units"
              className="w-full border-0 bg-transparent text-xs text-[#111e19] outline-none sm:w-[180px]"/>
          </label>
        </div>
        {structure.buildings.length === 0 ? (
          <div className="mt-5 rounded-xl bg-[#edfdf3] p-6 text-center text-sm text-[#424845]">
            No buildings configured. Add a building, then a floor, to create the first unit.
          </div>
        ) : structure.floors.length === 0 ? (
          <div className="mt-5 rounded-xl bg-[#edfdf3] p-6 text-center text-sm text-[#424845]">
            No floors configured. Add a floor before creating units.
          </div>
        ) : visibleUnits.length === 0 && search.trim() ? (
          <div className="mt-5 rounded-xl bg-[#edfdf3] p-6 text-center text-sm text-[#737875]">No matching units.</div>
        ) : (
          <div className="mt-5 space-y-4">
            {structure.buildings.map(building => {
              const buildingFloors = structure.floors.filter(floor => floor.building_id === building.id)
              const buildingHasMatches = buildingFloors.some(floor => visibleUnits.some(unit => unit.floor_id === floor.id))
              if (search.trim() && !buildingHasMatches) return null
              return (
                <div key={building.id} className="overflow-hidden rounded-xl border border-[#dcece2]">
                  <div className="flex items-center gap-2 bg-[#e7f7ee] px-4 py-3 text-sm font-semibold text-[#111e19]">
                    <span className="material-symbols-outlined text-[18px] text-[#1e6a59]">apartment</span>{building.name}
                  </div>
                  {buildingFloors.length === 0 && (
                    <p className="px-4 py-4 text-xs text-[#737875]">No floors configured in this building.</p>
                  )}
                  {buildingFloors.map(floor => {
                    const floorUnits = visibleUnits.filter(unit => unit.floor_id === floor.id)
                    if (search.trim() && floorUnits.length === 0) return null
                    return (
                      <div key={floor.id} className="border-t border-[#dcece2] px-4 py-3">
                        <div className="mb-3 flex items-center justify-between">
                          <strong className="text-xs text-[#424845]">{floor.name}</strong>
                          <span className="text-[10px] text-[#737875]">{floorUnits.length} unit{floorUnits.length === 1 ? '' : 's'}</span>
                        </div>
                        {floorUnits.length === 0 ? (
                          <p className="text-xs text-[#737875]">No units yet.</p>
                        ) : (
                          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                            {floorUnits.map(unit => (
                              <button
                                type="button"
                                key={unit.id}
                                aria-label={`View ${unit.name} meter readings and consumption`}
                                onClick={() => setSelectedUnitId(unit.id)}
                                className="group flex w-full items-center justify-between gap-3 rounded-xl bg-[#f3fbf6] px-3 py-3 text-left transition hover:bg-[#e7f7ee] hover:shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1e6a59]"
                              >
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-semibold text-[#111e19]">{unit.name}</div>
                                  <div className="mt-1 text-[10px] text-[#737875]">
                                    {unit.default_rent_amount === null ? 'Rent not set' :
                                      `KSh ${Number(unit.default_rent_amount).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`}
                                  </div>
                                </div>
                                <div className="flex shrink-0 items-center gap-1">
                                <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold ${
                                  unit.status === 'occupied' ? 'bg-[#b5e7d1] text-[#005142]' :
                                  unit.status === 'vacant' ? 'bg-white text-[#53645c]' :
                                  'bg-[#fff5dc] text-[#7e621a]'
                                }`}>{unitStatus(unit.status)}</span>
                                <span className="material-symbols-outlined text-[17px] text-[#1e6a59]">chevron_right</span>
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {selectedUnit && (
        <UnitBillingPanel
          key={selectedUnit.id}
          propertyId={propertyId}
          unit={selectedUnit}
          buildingName={selectedBuilding?.name ?? 'Building'}
          floorName={selectedFloor?.name ?? 'Floor'}
          onClose={() => setSelectedUnitId(null)}
        />
      )}

      {bundleMode && <PropertyStructureWizard
        key={bundleMode}
        mode={bundleMode}
        propertyId={propertyId}
        buildings={structure.buildings}
        onClose={closeBundle}
        onSaved={bundleSaved}
      />}

      {mode && (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-[#10211c]/50 p-0 backdrop-blur-sm sm:items-center sm:p-6">
          <section aria-label={mode === 'unit' ? 'Add unit' : mode === 'floor' ? 'Add floor' : 'Add building'}
            role="dialog" aria-modal="true"
            className="max-h-[94vh] w-full max-w-xl overflow-y-auto rounded-t-2xl bg-[#edfdf3] shadow-2xl sm:rounded-2xl">
            <div className="sticky top-0 flex items-center justify-between border-b border-[#dcece2] bg-[#edfdf3] px-5 py-4">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-[#1e6a59]">Property structure</div>
                <h3 className="font-['Newsreader'] text-2xl font-semibold text-[#111e19]">
                  {mode === 'unit' ? 'Add unit' : mode === 'floor' ? 'Add floor' : 'Add building'}
                </h3>
              </div>
              <button type="button" aria-label="Close" disabled={busy}
                onClick={() => { setMode(null); setError('') }}
                className="rounded-lg bg-white p-2 text-[#424845] disabled:opacity-50">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <form onSubmit={event => void submit(event)} className="space-y-5 p-5">
              {error && <div role="alert" className="rounded-xl bg-[#fff0ee] p-3 text-sm text-[#93000a]">{error}</div>}

              {mode === 'building' && (
                <label className="block text-xs font-semibold text-[#424845]">
                  Building name
                  <input value={buildingName} onChange={event => setBuildingName(event.target.value)}
                    required maxLength={100} placeholder="e.g. Block A"
                    className="mt-2 w-full rounded-xl border border-[#dcece2] bg-white p-3 text-sm"/>
                </label>
              )}

              {(mode === 'floor' || mode === 'unit') && (
                <label className="block text-xs font-semibold text-[#424845]">
                  Building
                  <select value={buildingId} onChange={event => selectBuilding(event.target.value)} required
                    className="mt-2 w-full rounded-xl border border-[#dcece2] bg-white p-3 text-sm">
                    {structure.buildings.map(building => <option key={building.id} value={building.id}>{building.name}</option>)}
                  </select>
                </label>
              )}

              {mode === 'floor' && (
                <>
                  <label className="block text-xs font-semibold text-[#424845]">Floor name
                    <input value={floorName} onChange={event => setFloorName(event.target.value)}
                      required maxLength={100} placeholder="e.g. Ground Floor"
                      className="mt-2 w-full rounded-xl border border-[#dcece2] bg-white p-3 text-sm"/>
                  </label>
                  <label className="block text-xs font-semibold text-[#424845]">Floor number
                    <input type="number" step="1" value={floorNumber} onChange={event => setFloorNumber(event.target.value)}
                      required placeholder="e.g. 0 for ground floor"
                      className="mt-2 w-full rounded-xl border border-[#dcece2] bg-white p-3 text-sm"/>
                  </label>
                </>
              )}

              {mode === 'unit' && (
                <>
                  <label className="block text-xs font-semibold text-[#424845]">Floor
                    <select value={floorId} onChange={event => setFloorId(event.target.value)} required
                      className="mt-2 w-full rounded-xl border border-[#dcece2] bg-white p-3 text-sm">
                      {floorsInBuilding.map(floor => <option key={floor.id} value={floor.id}>{floor.name}</option>)}
                    </select>
                  </label>
                  {floorsInBuilding.length === 0 && (
                    <p className="rounded-xl bg-[#fff5dc] p-3 text-xs text-[#7e621a]">
                      This building has no floors yet. Add a floor first.
                    </p>
                  )}
                  <label className="block text-xs font-semibold text-[#424845]">Unit name
                    <input value={unitName} onChange={event => setUnitName(event.target.value)}
                      required maxLength={100} placeholder="e.g. A9"
                      className="mt-2 w-full rounded-xl border border-[#dcece2] bg-white p-3 text-sm"/>
                  </label>
                  <label className="block text-xs font-semibold text-[#424845]">
                    Default rent (KES) · Optional
                    <input type="number" min="0" step="0.01" value={rent} onChange={event => setRent(event.target.value)}
                      placeholder="e.g. 12000"
                      className="mt-2 w-full rounded-xl border border-[#dcece2] bg-white p-3 text-sm"/>
                  </label>
                  <p className="rounded-xl bg-[#e7f7ee] p-3 text-xs leading-5 text-[#424845]">
                    New units start as Vacant. If usage-based billing services exist, configure a meter for this unit under Billing services afterward.
                  </p>
                </>
              )}

              <div className="flex justify-end gap-3 border-t border-[#dcece2] pt-4">
                <button type="button" disabled={busy} onClick={() => { setMode(null); setError('') }}
                  className="rounded-xl px-4 py-2.5 text-sm font-semibold text-[#424845] disabled:opacity-50">Cancel</button>
                <button type="submit" disabled={busy || (mode === 'unit' && !floorId)}
                  className="rounded-xl bg-[#10211c] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                  {busy ? 'Saving…' : mode === 'unit' ? 'Add unit' : mode === 'floor' ? 'Add floor' : 'Add building'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </section>
  )
}
