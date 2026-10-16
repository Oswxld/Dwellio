import {
  useEffect, useMemo, useState, type FormEvent,
} from 'react'
import { useNavigate } from 'react-router-dom'
import {
  createBuildingFloorUnits,
  createFloorUnits,
  createUnits,
  listQuickAddBuildings,
  listQuickAddFloors,
  listQuickAddProperties,
  type QuickAddBuilding,
  type QuickAddFloor,
  type QuickAddKind,
  type QuickAddProperty,
  type CreationResult,
} from '../data/propertyQuickAddRepository'

type Step = 'property' | 'building' | 'floor' | 'details' | 'units' | 'review'
type UnitRow = { key: number; name: string; rent: string }
const steps: Record<QuickAddKind, Step[]> = {
  building: ['property', 'details', 'units', 'review'],
  floor: ['property', 'building', 'details', 'units', 'review'],
  units: ['property', 'building', 'floor', 'units', 'review'],
}
const headings: Record<QuickAddKind, string> = {
  building: 'Create a building',
  floor: 'Add a new floor',
  units: 'Add units',
}
const stepTitles: Record<Step, string> = {
  property: 'Choose a property',
  building: 'Choose a building',
  floor: 'Choose a floor',
  details: 'Describe the structure',
  units: 'Design your units',
  review: 'Review & create',
}
const stepIcons: Record<Step,string> = {
  property: 'domain', building: 'apartment', floor: 'layers',
  details: 'edit_square', units: 'meeting_room', review: 'verified',
}
const inputClass = 'w-full rounded-2xl border border-[#d9e8df] bg-white px-4 py-3 text-sm font-medium text-[#10211c] outline-none transition focus:border-[#2a896c] focus:ring-4 focus:ring-[#86bda2]/15 placeholder:text-[#a1b0a6]'
const numberFormat = new Intl.NumberFormat('en-KE', { maximumFractionDigits: 2 })
let counter = 1

type Props = {
  kind: QuickAddKind
  organizationId: string
  onClose: () => void
  onCreated: () => void
}

function errorText(value: unknown) {
  return value instanceof Error ? value.message : 'Could not load the requested information.'
}
function makeUnit(): UnitRow {
  return { key: counter++, name: '', rent: '' }
}
function LocationLabel({property}:{property:QuickAddProperty}) {
  return <span className="text-xs text-[#72877a]">
    {[property.address, property.city, property.county].filter(Boolean).join(', ')
      || 'Location not specified'}
  </span>
}
function Symbol({name,className=''}:{name:string;className?:string}) {
  return <span aria-hidden className={`material-symbols-outlined ${className}`}>{name}</span>
}

export default function DashboardQuickAddFlow({
  kind, organizationId, onClose, onCreated,
}: Props) {
  const navigate = useNavigate()
  const flow = steps[kind]
  const [stepIndex, setStepIndex] = useState(0)
  const [properties, setProperties] = useState<QuickAddProperty[]>([])
  const [buildings, setBuildings] = useState<QuickAddBuilding[]>([])
  const [floors, setFloors] = useState<QuickAddFloor[]>([])
  const [propertyId, setPropertyId] = useState('')
  const [buildingId, setBuildingId] = useState('')
  const [floorId, setFloorId] = useState('')
  const [buildingName, setBuildingName] = useState('')
  const [floorName, setFloorName] = useState('')
  const [floorNumber, setFloorNumber] = useState('')
  const [units, setUnits] = useState<UnitRow[]>([makeUnit()])
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [formError, setFormError] = useState('')
  const [retry, setRetry] = useState(0)
  const [created, setCreated] = useState<CreationResult | null>(null)

  const step = flow[stepIndex]
  const selectedProperty = properties.find(p=>p.id===propertyId)
  const selectedBuilding = buildings.find(b=>b.id===buildingId)
  const selectedFloor = floors.find(f=>f.id===floorId)

  useEffect(() => {
    let alive=true
    setLoading(true)
    setLoadError('')
    void listQuickAddProperties(organizationId).then(rows=>{
      if(alive) setProperties(rows)
    }).catch(e=>{if(alive) setLoadError(errorText(e))})
      .finally(()=>{if(alive) setLoading(false)})
    return ()=>{alive=false}
  },[organizationId,retry])

  useEffect(() => {
    if (!propertyId || kind==='building') return
    let alive=true
    setLoading(true)
    setLoadError('')
    void listQuickAddBuildings(propertyId).then(rows=>{
      if(alive) setBuildings(rows)
    }).catch(e=>{if(alive) setLoadError(errorText(e))})
      .finally(()=>{if(alive) setLoading(false)})
    return ()=>{alive=false}
  },[propertyId,kind,retry])

  useEffect(()=>{
    if(!buildingId || kind!=='units') return
    let alive=true
    setLoading(true)
    setLoadError('')
    void listQuickAddFloors(buildingId).then(rows=>{
      if(alive) setFloors(rows)
    }).catch(e=>{if(alive) setLoadError(errorText(e))})
      .finally(()=>{if(alive) setLoading(false)})
    return ()=>{alive=false}
  },[buildingId,kind,retry])

  useEffect(()=>{
    function keydown(event: KeyboardEvent) {
      if(event.key==='Escape' && !busy) onClose()
    }
    document.addEventListener('keydown',keydown)
    return ()=>document.removeEventListener('keydown',keydown)
  },[busy,onClose])

  // Prevent background scrolling while the guided creation flow is open.
  useEffect(()=>{
    const overflow=document.body.style.overflow
    document.body.style.overflow='hidden'
    return ()=>{document.body.style.overflow=overflow}
  },[])

  const filtered = useMemo(()=>properties.filter(p=>
    [p.name,p.address,p.city,p.county].some(v=>
      (v??'').toLowerCase().includes(search.trim().toLowerCase()),
    ),
  ),[properties,search])

  const next = () => {
    setFormError('')
    setStepIndex(current=>Math.min(current+1,flow.length-1))
  }
  const back = () => {
    setFormError('')
    setStepIndex(current=>Math.max(0,current-1))
  }
  const chooseProperty = (id: string) => {
    setPropertyId(id)
    setBuildingId('')
    setFloorId('')
    setBuildings([])
    setFloors([])
    next()
  }
  const chooseBuilding = (id: string) => {
    setBuildingId(id)
    setFloorId('')
    setFloors([])
    next()
  }
  const chooseFloor = (id: string) => {
    setFloorId(id)
    next()
  }
  function validateDetails() {
    if(kind==='building' && !buildingName.trim()) return 'Please enter a building name.'
    if(!floorName.trim()) return 'Please name the floor.'
    if(floorNumber.trim()==='' || !Number.isSafeInteger(Number(floorNumber)))
      return 'Enter a whole-number floor number (use 0 for ground floor).'
    return ''
  }
  function parsedUnits() {
    const unique = new Set<string>()
    return units.map((unit,index)=>{
      const name=unit.name.trim()
      if(!name || name.length>100) throw new Error(`Unit ${index+1} needs a name (up to 100 characters).`)
      if(unique.has(name.toLowerCase())) throw new Error(`Unit ${name} is listed twice.`)
      unique.add(name.toLowerCase())
      const rawRent=unit.rent.trim()
      const defaultRent=rawRent===''?null:Number(rawRent)
      if(defaultRent!==null && (!Number.isFinite(defaultRent) || defaultRent<0
        || defaultRent>9999999999.99 || !/^\d+(?:\.\d{1,2})?$/.test(rawRent))) {
        throw new Error(`Invalid default rent for ${name}. Use a positive amount with up to two decimal places.`)
      }
      return {name,defaultRent}
    })
  }
  const goNext = () => {
    setFormError('')
    try {
      if(step==='details'){
        const error=validateDetails()
        if(error) throw new Error(error)
      } else if(step==='units') parsedUnits()
      next()
    } catch(e){setFormError(errorText(e))}
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if(busy || created || !propertyId) return
    try {
      setFormError('')
      const values=parsedUnits()
      setBusy(true)
      let result:CreationResult
      if(kind==='building'){
        result=await createBuildingFloorUnits({
          propertyId,buildingName:buildingName.trim(),floorName:floorName.trim(),
          floorNumber:Number(floorNumber),units:values,
        })
      } else if(kind==='floor'){
        result=await createFloorUnits({
          propertyId,buildingId,floorName:floorName.trim(),
          floorNumber:Number(floorNumber),units:values,
        })
      } else {
        result=await createUnits({propertyId,buildingId,floorId,units:values})
      }
      if(result.units_created!==values.length)
        throw new Error('The backend returned a different unit count. Please verify the property inventory.')
      setCreated(result)
      onCreated()
    } catch(e){
      console.error('[Dashboard quick add] Creation failed',e)
      setFormError(errorText(e))
    } finally {setBusy(false)}
  }

  return (
    <div className="fixed inset-0 z-[95] flex items-end justify-center bg-[#081b14]/75 p-0 backdrop-blur-[8px] sm:items-center sm:p-5"
      role="presentation" onMouseDown={e=>{
        if(e.target===e.currentTarget && !busy) onClose()
      }}>
      <section role="dialog" aria-modal="true" aria-label={headings[kind]}
        className="dwellio-quickadd-pop relative flex max-h-[98dvh] w-full max-w-[940px] flex-col overflow-hidden rounded-t-[28px] bg-[#f7fbf8] shadow-[0_32px_110px_rgba(0,0,0,.35)] sm:max-h-[92dvh] sm:rounded-[30px]">

        <div className="relative shrink-0 overflow-hidden bg-[#102820] px-5 pb-5 pt-5 text-white sm:px-8 sm:pt-7">
          <div className="pointer-events-none absolute -right-20 -top-32 h-80 w-80 rounded-full bg-[#48a381]/20 blur-3xl"/>
          <div className="pointer-events-none absolute -bottom-32 left-1/3 h-52 w-52 rounded-full bg-[#9ccfb1]/10 blur-3xl"/>
          <div className="relative flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-2xl border border-white/20 bg-white/10">
                <Symbol name={kind==='building'?'domain_add':kind==='floor'?'layers':'meeting_room'}
                  className="text-[25px] text-[#a8f1db]"/>
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[.22em] text-[#a8f1db]">
                  DWELLIO · PROPERTY BUILDER
                </div>
                <h2 className="mt-1 font-['Newsreader'] text-[27px] font-semibold leading-tight sm:text-[33px]">
                  {created ? 'Your space is ready' : headings[kind]}
                </h2>
              </div>
            </div>
            <button type="button" aria-label="Close property builder" onClick={onClose}
              disabled={busy} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/15 bg-white/10 text-white transition hover:bg-white/20 disabled:opacity-40">
              <Symbol name="close"/>
            </button>
          </div>
          <div className="relative mt-6 flex items-center gap-1.5" aria-label="Creation progress">
            {flow.map((s,i)=>(
              <div key={s} className="min-w-0 flex-1">
                <div className={`h-[5px] rounded-full transition-colors duration-500 ${created||i<=stepIndex?'bg-[#88e4bf]':'bg-white/20'}`}/>
                <span className={`mt-2 hidden text-[10px] font-bold sm:block ${i<=stepIndex?'text-[#e6fff1]':'text-[#76998c]'}`}>
                  {stepTitles[s]}
                </span>
              </div>
            ))}
          </div>
        </div>

        {created ? (
          <div className="dwellio-quickadd-stage flex min-h-[330px] flex-col items-center justify-center overflow-y-auto px-6 py-11 text-center">
            <div className="grid h-[86px] w-[86px] place-items-center rounded-[26px] bg-[#d9f4e7] text-[#117453] shadow-[0_15px_36px_rgba(30,106,89,.12)]">
              <Symbol name="task_alt" className="text-[52px]"/>
            </div>
            <h3 className="mt-6 font-['Newsreader'] text-3xl font-semibold text-[#102820]">Successfully created!</h3>
            <p className="mt-3 max-w-md text-sm leading-7 text-[#64776c]">
              {created.units_created} unit{created.units_created===1?'':'s'} {kind==='units'?'were added':'were created with their new building or floor'} in <b>{selectedProperty?.name}</b>.
              Every unit begins with <strong>Vacant</strong> status.
            </p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <button type="button" onClick={onClose} className="rounded-2xl border border-[#d9e8df] bg-white px-6 py-3 text-sm font-bold text-[#102820]">
                Back to dashboard
              </button>
              <button type="button" onClick={()=>navigate(`/properties/${propertyId}`)}
                className="inline-flex items-center gap-2 rounded-2xl bg-[#102820] px-6 py-3 text-sm font-bold text-white transition hover:bg-[#23644e]">
                Open property <Symbol name="arrow_forward" className="text-lg"/>
              </button>
            </div>
          </div>
        ) : (
          <form className="flex min-h-0 flex-1 flex-col" onSubmit={event=>void submit(event)}>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-9 sm:py-8">
              <div key={step} className="dwellio-quickadd-stage">
                <div className="mb-6 flex items-start gap-4">
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#e0f3e9] text-[#146a50]">
                    <Symbol name={stepIcons[step]} className="text-[24px]"/>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-[.17em] text-[#47856c]">
                      STEP {stepIndex+1} OF {flow.length}
                    </div>
                    <h3 className="mt-1 font-['Newsreader'] text-[26px] font-semibold leading-tight text-[#102820]">{stepTitles[step]}</h3>
                    <p className="mt-1.5 text-[13px] leading-6 text-[#75867a]">
                      {step==='property'?'Which property are you configuring? Choose from your real portfolio.'
                        :step==='building'?'Choose the building that will contain the new floor or units.'
                        :step==='floor'?'Pick the existing floor where the units will be created.'
                        :step==='details'?'Give the new structure a name and floor number.'
                        :step==='units'?'Add the units you need. Each unit can have its own default rent.'
                        :'Check every detail before saving to your live property inventory.'}
                    </p>
                  </div>
                </div>

                {loadError && <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[#f3d1cb] bg-[#fff0ee] p-4 text-sm text-[#9a4439]">
                  <span>{loadError}</span>
                  <button type="button" onClick={()=>setRetry(n=>n+1)} className="font-bold underline">Try again</button>
                </div>}
                {formError && <div role="alert" className="mb-4 flex items-start gap-2 rounded-2xl border border-[#f3d1cb] bg-[#fff0ee] p-4 text-sm text-[#9a4439]">
                  <Symbol name="error_outline" className="shrink-0"/>{formError}
                </div>}

                {step==='property' && (
                  <>
                    <label className="mb-4 flex items-center gap-3 rounded-2xl border border-[#e3ede6] bg-white px-4 py-3 shadow-sm">
                      <Symbol name="search" className="text-[#739988]"/>
                      <input aria-label="Search properties" type="search" value={search}
                        onChange={e=>setSearch(e.target.value)} placeholder="Find a property by name or location"
                        className="w-full bg-transparent text-sm font-medium text-[#102820] outline-none"/>
                    </label>
                    {loading && properties.length===0
                      ? <LoadingChoices/>
                      : <div className="grid gap-3 sm:grid-cols-2">
                        {filtered.map(p=>(
                          <button type="button" key={p.id} onClick={()=>chooseProperty(p.id)}
                            className="group flex min-h-[103px] items-center gap-4 rounded-[22px] border border-[#deece3] bg-white p-4 text-left shadow-[0_5px_22px_rgba(16,33,28,.025)] transition duration-200 hover:-translate-y-0.5 hover:border-[#74b89b] hover:bg-[#f4fcf6] hover:shadow-[0_12px_30px_rgba(16,73,51,.08)]">
                            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-[17px] bg-gradient-to-br from-[#e0f5e8] to-[#cae8d8] font-['Newsreader'] text-3xl font-bold text-[#226a50]">
                              {p.name.slice(0,1).toUpperCase()}
                            </span>
                            <span className="min-w-0 flex-1">
                              <strong className="block truncate text-[15px] text-[#102820]">{p.name}</strong>
                              <LocationLabel property={p}/>
                            </span>
                            <Symbol name="arrow_forward_ios" className="text-[17px] text-[#afc8b7] transition group-hover:translate-x-1 group-hover:text-[#1e6a59]"/>
                          </button>
                        ))}
                      </div>}
                    {!loading && !loadError && filtered.length===0 && <EmptyChoice
                      title={properties.length?'No matching properties':'No active properties'}
                      subtitle={properties.length?'Try a different search.':'You need an active property before you can add a building, floor or unit.'}/>}
                  </>
                )}

                {step==='building' && (
                  loading && buildings.length===0 ? <LoadingChoices/> : (
                    buildings.length===0 ? <EmptyChoice
                      title="No buildings yet"
                      subtitle="Start with Add building + floor + units to create the first building."/> :
                    <div className="grid gap-3 sm:grid-cols-2">
                      {buildings.map(b=>(
                        <button type="button" key={b.id} onClick={()=>chooseBuilding(b.id)}
                          className="group flex items-center gap-4 rounded-[20px] border border-[#deece3] bg-white p-5 text-left transition hover:-translate-y-0.5 hover:border-[#74b89b] hover:bg-[#f4fcf6]">
                          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[#e2f2e8] text-[#1e6a59]"><Symbol name="apartment" className="text-[26px]"/></span>
                          <span className="min-w-0 flex-1">
                            <strong className="block truncate text-sm text-[#102820]">{b.name}</strong>
                            <small className="mt-1 block text-xs text-[#81968b]">Building · {selectedProperty?.name}</small>
                          </span>
                          <Symbol name="chevron_right" className="text-[#a8c7b7]"/>
                        </button>
                      ))}
                    </div>
                  )
                )}

                {step==='floor' && (
                  loading && floors.length===0 ? <LoadingChoices/> : (
                    floors.length===0 ? <EmptyChoice title="No floors yet"
                      subtitle="Select Add floor + units to set up this building's first floor."/> :
                    <div className="grid gap-3 sm:grid-cols-2">
                      {floors.map(f=>(
                        <button type="button" key={f.id} onClick={()=>chooseFloor(f.id)}
                          className="group flex items-center gap-4 rounded-[20px] border border-[#deece3] bg-white p-5 text-left transition hover:-translate-y-0.5 hover:border-[#74b89b] hover:bg-[#f4fcf6]">
                          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[#e2f2e8] text-[#1e6a59]"><Symbol name="layers" className="text-[26px]"/></span>
                          <span className="min-w-0 flex-1">
                            <strong className="block truncate text-sm text-[#102820]">{f.name}</strong>
                            <small className="mt-1 block text-xs text-[#81968b]">Floor number {f.floor_number}</small>
                          </span>
                          <Symbol name="chevron_right" className="text-[#a8c7b7]"/>
                        </button>
                      ))}
                    </div>
                  )
                )}

                {step==='details' && (
                  <div className="space-y-4 rounded-[24px] border border-[#e3ede6] bg-white p-5 shadow-sm sm:p-7">
                    {kind==='building' && <label className="block">
                      <span className="mb-2 block text-xs font-bold text-[#466254]">Building name</span>
                      <input className={inputClass} required maxLength={100} value={buildingName}
                        onChange={e=>setBuildingName(e.target.value)} placeholder="e.g. Block A"/>
                    </label>}
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="block">
                        <span className="mb-2 block text-xs font-bold text-[#466254]">Floor name</span>
                        <input className={inputClass} required maxLength={100} value={floorName}
                          onChange={e=>setFloorName(e.target.value)} placeholder="e.g. Ground Floor"/>
                      </label>
                      <label className="block">
                        <span className="mb-2 block text-xs font-bold text-[#466254]">Floor number</span>
                        <input type="number" step="1" className={inputClass} required value={floorNumber}
                          onChange={e=>setFloorNumber(e.target.value)} placeholder="0"/>
                        <span className="mt-2 block text-[11px] text-[#8b9c91]">Ground = 0 · First floor = 1 · Basement = -1</span>
                      </label>
                    </div>
                    <div className="flex items-start gap-3 rounded-2xl bg-[#ebf8f0] p-4 text-xs leading-6 text-[#38735a]">
                      <Symbol name="info" className="text-[20px]"/> The building and floor will be created with the units in one atomic operation, never left empty.
                    </div>
                  </div>
                )}

                {step==='units' && (
                  <div className="overflow-hidden rounded-[24px] border border-[#e3ede6] bg-white shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#ecf2ed] p-5">
                      <div>
                        <h4 className="font-['Newsreader'] text-xl font-semibold text-[#102820]">Unit directory</h4>
                        <p className="mt-1 text-xs text-[#82958a]">{units.length} unit{units.length===1?'':'s'} ready for configuration</p>
                      </div>
                      <button type="button" disabled={units.length>=150 || busy}
                        onClick={()=>setUnits(current=>[...current,makeUnit()])}
                        className="inline-flex items-center gap-1 rounded-xl bg-[#e6f5eb] px-3.5 py-2.5 text-xs font-bold text-[#1e6a59] transition hover:bg-[#d0edda] disabled:opacity-50">
                        <Symbol name="add" className="text-lg"/> Add unit
                      </button>
                    </div>
                    <div className="max-h-[330px] space-y-3 overflow-y-auto p-4 sm:p-5">
                      {units.map((u,i)=>(
                        <div key={u.key} className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2 rounded-2xl bg-[#f5faf6] p-3 sm:gap-4">
                          <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#dceddf] text-xs font-bold text-[#347755]">{String(i+1).padStart(2,'0')}</span>
                          <label className="min-w-0 text-[10px] font-bold text-[#5d7365]">Unit name
                            <input className={`${inputClass} mt-1 !rounded-xl !px-3 !py-2.5`} required maxLength={100}
                              value={u.name} onChange={e=>setUnits(cur=>cur.map(row=>row.key===u.key?{...row,name:e.target.value}:row))}
                              placeholder="A01"/>
                          </label>
                          <label className="min-w-0 text-[10px] font-bold text-[#5d7365]">Default rent (KSh)
                            <input type="number" min="0" step=".01"
                              className={`${inputClass} mt-1 !rounded-xl !px-3 !py-2.5`}
                              value={u.rent} onChange={e=>setUnits(cur=>cur.map(row=>row.key===u.key?{...row,rent:e.target.value}:row))}
                              placeholder="Optional"/>
                          </label>
                          <button type="button" aria-label={`Remove unit ${i+1}`}
                            disabled={units.length===1||busy}
                            onClick={()=>setUnits(cur=>cur.filter(row=>row.key!==u.key))}
                            className="grid h-9 w-9 place-items-center rounded-xl text-[#b26b62] transition hover:bg-[#ffeae6] disabled:opacity-30">
                            <Symbol name="delete_outline" className="text-[20px]"/>
                          </button>
                        </div>
                      ))}
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#ecf2ed] bg-[#f8fbf9] px-5 py-4">
                      <span className="text-xs text-[#728679]"><Symbol name="check_circle" className="mr-1 align-middle text-[17px] text-[#408866]"/>New units start as vacant</span>
                      <span className="text-[11px] font-bold text-[#367755]">Default rent is optional</span>
                    </div>
                  </div>
                )}

                {step==='review' && (
                  <div className="overflow-hidden rounded-[24px] border border-[#e2ede6] bg-white shadow-sm">
                    <div className="border-b border-[#edf2ee] bg-[#f0f9f4] p-6">
                      <div className="text-[10px] font-bold uppercase tracking-[.17em] text-[#438467]">CREATION SUMMARY</div>
                      <h4 className="mt-1 font-['Newsreader'] text-2xl font-semibold text-[#102820]">
                        {selectedProperty?.name}
                      </h4>
                      <p className="mt-1 text-xs text-[#7d9083]">{kind==='building'?'A new building with its first floor':kind==='floor'?'A new floor in an existing building':'More units for an existing floor'}</p>
                    </div>
                    <div className="grid gap-5 p-6 sm:grid-cols-2">
                      <ReviewItem label="Property" value={selectedProperty?.name??'—'} icon="domain"/>
                      <ReviewItem label="Building" value={kind==='building'?buildingName:selectedBuilding?.name??'—'} icon="apartment"/>
                      <ReviewItem label="Floor" value={kind==='units'?selectedFloor?.name??'—':`${floorName} · Level ${floorNumber}`} icon="layers"/>
                      <ReviewItem label="New units" value={String(units.length)} icon="meeting_room"/>
                    </div>
                    <div className="border-t border-[#edf2ee] p-6">
                      <div className="mb-3 flex items-center justify-between text-xs font-bold text-[#466254]"><span>Units to create</span><span>{units.length} total</span></div>
                      <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto">
                        {units.map(u=><span key={u.key} className="rounded-xl border border-[#dcece2] bg-[#f3faf5] px-3 py-2 text-xs font-semibold text-[#315c49]">
                          {u.name.trim()} <span className="ml-1 font-normal text-[#7a9887]">{u.rent.trim()? `· KSh ${numberFormat.format(Number(u.rent))}` : '· Rent not set'}</span>
                        </span>)}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-[#e3ebe4] bg-white px-5 py-4 sm:px-9">
              <button type="button" onClick={stepIndex===0?onClose:back} disabled={busy}
                className="inline-flex items-center gap-2 rounded-xl border border-[#d9e8df] bg-white px-4 py-2.5 text-xs font-bold text-[#395a48] transition hover:bg-[#f3faf5] disabled:opacity-50">
                <Symbol name={stepIndex===0?'close':'arrow_back'} className="text-lg"/>
                {stepIndex===0?'Cancel':'Back'}
              </button>
              <div className="flex items-center gap-3">
                <span className="hidden text-[11px] font-semibold text-[#8d9f92] sm:inline">
                  Step {stepIndex+1} / {flow.length}
                </span>
                {step==='review'? (
                  <button type="submit" disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-[#102820] px-5 py-3 text-xs font-bold text-white shadow-lg shadow-[#102820]/15 transition hover:bg-[#256d52] disabled:opacity-60">
                    <Symbol name={busy?'progress_activity':'task_alt'} className="text-lg"/>
                    {busy?'Saving…':'Confirm & create'}
                  </button>
                ) : step==='details'||step==='units' ? (
                  <button type="button" onClick={goNext} disabled={busy}
                    className="inline-flex items-center gap-2 rounded-xl bg-[#102820] px-5 py-3 text-xs font-bold text-white transition hover:bg-[#256d52]">
                    Continue <Symbol name="arrow_forward" className="text-lg"/>
                  </button>
                ) : (
                  <span className="hidden text-[11px] font-medium text-[#98aa9e] sm:block">Select a card to continue →</span>
                )}
              </div>
            </footer>
          </form>
        )}
      </section>
    </div>
  )
}

function ReviewItem({label,value,icon}:{label:string;value:string;icon:string}) {
  return <div className="flex items-center gap-3">
    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#e8f5ec] text-[#368263]"><Symbol name={icon}/></span>
    <div className="min-w-0">
      <div className="text-[10px] font-bold uppercase tracking-wider text-[#8da195]">{label}</div>
      <div className="truncate text-sm font-semibold text-[#183f2c]">{value}</div>
    </div>
  </div>
}
function EmptyChoice({title,subtitle}:{title:string;subtitle:string}) {
  return <div className="flex min-h-[190px] flex-col items-center justify-center rounded-[24px] border border-dashed border-[#bedac8] bg-[#f3faf6] px-6 text-center">
    <Symbol name="inventory_2" className="text-[40px] text-[#7fab91]"/>
    <h4 className="mt-3 text-sm font-bold text-[#244d37]">{title}</h4>
    <p className="mt-2 max-w-sm text-xs leading-6 text-[#809687]">{subtitle}</p>
  </div>
}
function LoadingChoices() {
  return <div className="grid gap-3 sm:grid-cols-2">
    {[0,1,2,3].map(i=><div key={i} className="h-[104px] animate-pulse rounded-[22px] border border-[#e3ebe5] bg-[#eaf3ed]"/>)}
  </div>
}
