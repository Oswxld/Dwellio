import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import PageSkeleton from '../components/loading/PageSkeleton'
import {
  fetchOrganizationName,
  fetchOrganizationProperties,
  type OrganizationProperty,
} from '../features/properties/data/propertiesRepository'

type PropertiesPageProps = {
  organizationId: string
}

function locationLabel(property: OrganizationProperty) {
  return [property.address, property.city, property.county]
    .filter((value, index, values) =>
      Boolean(value?.trim()) &&
      values.findIndex(item => item?.trim().toLowerCase() === value?.trim().toLowerCase()) === index,
    )
    .join(' · ') || 'Location not added'
}

function statusLabel(status: OrganizationProperty['status']) {
  if (status === 'under_maintenance') return 'Under maintenance'
  return status === 'active' ? 'Active' : 'Inactive'
}

export default function PropertiesPage({ organizationId }: PropertiesPageProps) {
  const [properties, setProperties] = useState<OrganizationProperty[]>([])
  const [organizationName, setOrganizationName] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError('')
      try {
        const [items, name] = await Promise.all([
          fetchOrganizationProperties(organizationId),
          fetchOrganizationName(organizationId),
        ])
        if (cancelled) return
        setProperties(items)
        setOrganizationName(name)
      } catch (caught) {
        if (cancelled) return
        setError(caught instanceof Error ? caught.message : 'Could not load properties.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => { cancelled = true }
  }, [organizationId, retryKey])

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return properties
    return properties.filter(property =>
      [property.name, property.address, property.city, property.county, property.status]
        .some(value => value?.toLowerCase().includes(query)),
    )
  }, [properties, search])

  const activeCount = properties.filter(property => property.status === 'active').length

  if (loading) return <PageSkeleton variant="dashboard" />

  return (
    <main className="min-h-full bg-[#edfdf3] px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1450px] space-y-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#1e6a59]">
              Organization workspace
            </div>
            <h1 className="mt-1 font-['Newsreader'] text-4xl font-medium tracking-tight text-[#111e19]">
              Properties
            </h1>
            <p className="mt-2 text-sm text-[#424845]">
              Manage properties belonging to your organization.
            </p>
          </div>
          <div className="inline-flex items-center gap-3 rounded-2xl border border-[#dcece2] bg-white px-4 py-3 shadow-[0_10px_26px_rgba(16,33,28,0.05)]">
            <span className="material-symbols-outlined rounded-xl bg-[#e7f7ee] p-2 text-[#1e6a59]">apartment</span>
            <div>
              <span className="block text-[10px] font-bold uppercase tracking-widest text-[#737875]">Organization</span>
              <strong className="block text-sm text-[#111e19]">{organizationName}</strong>
            </div>
          </div>
        </header>

        {error ? (
          <section role="alert" className="rounded-2xl border border-[#ba1a1a]/20 bg-white p-6 shadow-sm">
            <h2 className="font-semibold text-[#93000a]">Unable to load properties</h2>
            <p className="mt-2 text-sm text-[#424845]">{error}</p>
            <button type="button" onClick={() => setRetryKey(value => value + 1)}
              className="mt-4 rounded-xl bg-[#10211c] px-5 py-2.5 text-sm font-semibold text-white">
              Try again
            </button>
          </section>
        ) : (
          <>
            <section className="grid gap-3 sm:grid-cols-3">
              {[
                { label: 'Properties', value: properties.length, icon: 'domain' },
                { label: 'Active properties', value: activeCount, icon: 'check_circle' },
                { label: 'Other statuses', value: properties.length - activeCount, icon: 'info' },
              ].map(stat => (
                <div key={stat.label} className="rounded-2xl border border-[#dcece2] bg-white p-5 shadow-[0_12px_32px_rgba(16,33,28,0.04)]">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-[#737875]">{stat.label}</span>
                    <span className="material-symbols-outlined rounded-lg bg-[#e7f7ee] p-2 text-[20px] text-[#1e6a59]">{stat.icon}</span>
                  </div>
                  <div className="mt-2 font-['Newsreader'] text-3xl font-semibold text-[#111e19]">{stat.value}</div>
                </div>
              ))}
            </section>

            <section className="rounded-2xl border border-[#dcece2] bg-white p-5 shadow-[0_14px_40px_rgba(16,33,28,0.05)] sm:p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="font-['Newsreader'] text-2xl text-[#111e19]">Your properties</h2>
                  <p className="mt-1 text-xs text-[#737875]">Select a property to manage its billing services.</p>
                </div>
                <label className="flex w-full items-center gap-2 rounded-xl border border-[#dcece2] bg-[#edfdf3] px-3 py-2 sm:max-w-[340px]">
                  <span className="material-symbols-outlined text-[20px] text-[#1e6a59]">search</span>
                  <input
                    type="search"
                    aria-label="Search properties"
                    value={search}
                    onChange={event => setSearch(event.target.value)}
                    placeholder="Search properties or locations"
                    className="min-w-0 w-full border-0 bg-transparent text-sm text-[#111e19] outline-none"
                  />
                </label>
              </div>

              {properties.length === 0 ? (
                <div className="mt-6 rounded-2xl bg-[#edfdf3] px-6 py-12 text-center">
                  <span className="material-symbols-outlined text-4xl text-[#1e6a59]">apartment</span>
                  <h3 className="mt-3 font-semibold text-[#111e19]">No properties yet</h3>
                  <p className="mt-1 text-sm text-[#737875]">Properties added to this organization will appear here.</p>
                </div>
              ) : filtered.length === 0 ? (
                <p className="mt-6 rounded-xl bg-[#edfdf3] p-6 text-center text-sm text-[#737875]">
                  No properties match your search.
                </p>
              ) : (
                <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {filtered.map(property => (
                    <Link
                      key={property.id}
                      to={`/properties/${property.id}`}
                      className="group flex min-h-[190px] flex-col justify-between rounded-2xl border border-[#dcece2] bg-[#f3fbf6] p-5 shadow-[0_8px_22px_rgba(16,33,28,0.035)] transition hover:-translate-y-0.5 hover:border-[#a8d8c5] hover:shadow-[0_14px_30px_rgba(16,33,28,0.09)]"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="material-symbols-outlined rounded-xl bg-white p-3 text-[26px] text-[#1e6a59] shadow-sm">
                          apartment
                        </span>
                        <span className={`rounded-full px-3 py-1 text-[11px] font-semibold ${
                          property.status === 'active'
                            ? 'bg-[#a8f1db]/55 text-[#005142]'
                            : 'bg-[#dcece2] text-[#5c7267]'
                        }`}>
                          {statusLabel(property.status)}
                        </span>
                      </div>
                      <div className="mt-5">
                        <h3 className="font-['Newsreader'] text-[22px] font-semibold text-[#111e19]">{property.name}</h3>
                        <p className="mt-1 flex items-start gap-1 text-xs text-[#737875]">
                          <span className="material-symbols-outlined text-[16px]">location_on</span>
                          <span>{locationLabel(property)}</span>
                        </p>
                      </div>
                      <div className="mt-5 flex items-center justify-between border-t border-[#dcece2] pt-3">
                        <span className="text-xs font-semibold text-[#1e6a59]">Manage billing services</span>
                        <span className="material-symbols-outlined text-[#1e6a59] transition group-hover:translate-x-1">arrow_forward</span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  )
}
