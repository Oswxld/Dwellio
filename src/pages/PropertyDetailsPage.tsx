import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import PageSkeleton from '../components/loading/PageSkeleton'
import BillingServicesPanel from '../features/billing/components/BillingServicesPanel'
import { fetchBillingServicesManagerData } from '../features/billing/data/billingServicesRepository'
import type { BillingServicesManagerData } from '../features/billing/data/billingServicesRepository'
import {
  fetchOrganizationProperty,
  type OrganizationProperty,
} from '../features/properties/data/propertiesRepository'

type PropertyDetailsPageProps = {
  organizationId: string
}

function nairobiMonthStart() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date())
  const year = parts.find(part => part.type === 'year')?.value
  const month = parts.find(part => part.type === 'month')?.value
  const fallback = new Date()
  return `${year ?? fallback.getFullYear()}-${month ?? String(fallback.getMonth() + 1).padStart(2, '0')}-01`
}

function propertyLocation(property: OrganizationProperty) {
  const places = [property.address, property.city, property.county]
    .filter((value): value is string => Boolean(value?.trim()))
  return [...new Set(places)].join(' · ') || 'Location not added'
}

export default function PropertyDetailsPage({ organizationId }: PropertyDetailsPageProps) {
  const { propertyId } = useParams<{ propertyId: string }>()
  const [effectiveFrom, setEffectiveFrom] = useState(nairobiMonthStart)
  const [property, setProperty] = useState<OrganizationProperty | null>(null)
  const [managerData, setManagerData] = useState<BillingServicesManagerData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError('')
      try {
        if (!propertyId) {
          throw new Error('No property was selected.')
        }

        const selected = await fetchOrganizationProperty(organizationId, propertyId)
        if (!selected) {
          throw new Error('Property not found in your organization, or you do not have access to it.')
        }

        // Fetch the service data for this exact effective date before
        // removing the page skeleton, so the service list does not flash.
        const services = await fetchBillingServicesManagerData(propertyId, effectiveFrom)
        if (cancelled) return
        setProperty(selected)
        setManagerData(services)
      } catch (caught) {
        if (cancelled) return
        setError(caught instanceof Error ? caught.message : 'Unable to load this property.')
        setManagerData(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => { cancelled = true }
  }, [organizationId, propertyId, effectiveFrom, retryKey])

  if (loading) return <PageSkeleton variant="billing" />

  if (error || !property || !managerData) {
    return (
      <div className="min-h-full bg-[#edfdf3] px-4 py-8 sm:px-6">
        <div className="mx-auto max-w-5xl">
          <Link to="/properties" className="inline-flex items-center gap-1 text-sm font-semibold text-[#1e6a59]">
            <span className="material-symbols-outlined text-[18px]">arrow_back</span>
            Back to properties
          </Link>
          <section role="alert" className="mt-5 rounded-2xl border border-[#ba1a1a]/20 bg-white p-7">
            <h1 className="font-['Newsreader'] text-2xl font-semibold">Could not load property</h1>
            <p className="mt-2 text-sm text-[#93000a]">{error || 'Billing services could not be loaded.'}</p>
            <button type="button" onClick={() => setRetryKey(value => value + 1)}
              className="mt-5 rounded-xl bg-[#10211c] px-5 py-2.5 text-sm font-semibold text-white">Retry</button>
          </section>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-full bg-[#edfdf3] px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1450px] space-y-5">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-xs font-semibold">
          <Link to="/properties" className="text-[#1e6a59] hover:underline">Properties</Link>
          <span className="material-symbols-outlined text-[14px] text-[#9aaba1]">chevron_right</span>
          <span className="truncate text-[#424845]">{property.name}</span>
        </nav>

        <header className="rounded-2xl border border-[#dcece2] bg-white p-6 shadow-[0_14px_40px_rgba(16,33,28,0.05)] sm:p-7">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-4">
              <span className="material-symbols-outlined rounded-2xl bg-[#e7f7ee] p-3 text-[32px] text-[#1e6a59]">apartment</span>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#1e6a59]">Property workspace</div>
                <h1 className="mt-1 font-['Newsreader'] text-3xl font-semibold text-[#111e19] sm:text-4xl">{property.name}</h1>
                <p className="mt-2 flex items-start gap-1 text-sm text-[#737875]">
                  <span className="material-symbols-outlined text-[18px]">location_on</span>
                  {propertyLocation(property)}
                </p>
                <div className="mt-3">
                  <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
                    property.status === 'active'
                      ? 'bg-[#a8f1db]/50 text-[#005142]'
                      : 'bg-[#dcece2] text-[#5c7267]'
                  }`}>
                    {property.status === 'under_maintenance' ? 'Under maintenance' : property.status === 'active' ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>
            </div>
            <Link
              to="/properties"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#e7f7ee] px-4 py-2.5 text-sm font-semibold text-[#1e6a59] transition hover:bg-[#d8eddf]"
            >
              <span className="material-symbols-outlined text-[18px]">arrow_back</span>
              All properties
            </Link>
          </div>
        </header>

        <section className="flex flex-col gap-4 rounded-2xl border border-[#dcece2] bg-white px-5 py-4 shadow-[0_10px_28px_rgba(16,33,28,0.04)] sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#1e6a59]">Billing service configuration</div>
            <h2 className="mt-1 font-semibold text-[#111e19]">Rate effective date</h2>
            <p className="mt-1 max-w-xl text-xs leading-5 text-[#424845]">
              Choose the effective-from date to use when creating or updating billing service rates.
              The same services are used by the Billing module.
            </p>
          </div>
          <label className="flex w-full flex-col gap-1 sm:w-auto sm:min-w-[220px]">
            <span className="text-[10px] font-bold uppercase tracking-wide text-[#737875]">Effective from</span>
            <input
              type="date"
              aria-label="Billing service rate effective from"
              value={effectiveFrom}
              onChange={event => {
                if (event.target.value) setEffectiveFrom(event.target.value)
              }}
              className="w-full rounded-xl border border-[#dcece2] bg-[#edfdf3] px-3 py-2 text-sm font-semibold text-[#111e19] outline-none focus:border-[#1e6a59] focus:ring-2 focus:ring-[#1e6a59]/15"
            />
          </label>
        </section>

        <BillingServicesPanel
          key={`${property.id}:${effectiveFrom}`}
          propertyId={property.id}
          effectiveFrom={effectiveFrom}
          effectiveDate={effectiveFrom}
          initialData={managerData}
          onChanged={async () => {
            // BillingServicesPanel already refreshes its own data after saving.
            // There is no monthly billing dashboard to refresh in Properties.
          }}
        />
      </div>
    </div>
  )
}
