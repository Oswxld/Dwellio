import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import PageSkeleton from '../components/loading/PageSkeleton'
import TenantDirectoryView from '../features/tenants/components/TenantDirectoryView'
import TenantProfileView from '../features/tenants/components/TenantProfileView'
import { Icon } from '../features/tenants/components/tenantUi'
import {
  fetchTenantDirectory,
  type TenantDirectoryData,
} from '../features/tenants/data/tenantManagementRepository'
import '../features/tenants/tenants-stitch.css'

type Props = { organizationId: string }

export default function TenantsPage({ organizationId }: Props) {
  const { tenantId } = useParams<{ tenantId: string }>()
  const [data, setData] = useState<TenantDirectoryData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      setError('')
      try {
        const next = await fetchTenantDirectory(organizationId)
        if (active) setData(next)
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : 'Could not load tenants.')
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => { active = false }
  }, [organizationId, revision])

  if (loading) return <PageSkeleton variant="dashboard" />

  if (error || !data) return (
    <main className="tenants-stitch">
      <div className="ts-surface ts-info-card" role="alert">
        <div className="ts-card-heading">
          <span className="ts-card-icon"><Icon name="error_outline"/></span>
          <h3>Unable to load tenant information</h3>
        </div>
        <p className="ts-muted-note">{error || 'No tenant records were returned.'}</p>
        <button type="button" className="ts-button ts-button--primary" style={{marginTop:18}}
          onClick={() => setRevision(v => v+1)}>Retry</button>
      </div>
    </main>
  )

  const profile = tenantId ? data.profiles.find(item => item.tenant.id === tenantId) : null

  return (
    <main className="tenants-stitch">
      {tenantId
        ? profile
          ? <TenantProfileView
              key={profile.tenant.id}
              organizationId={organizationId}
              profile={profile}
              onRefresh={() => setRevision(v => v+1)}
            />
          : <div className="ts-surface ts-info-card">
              <Link to="/tenants" className="ts-button ts-button--secondary">
                <Icon name="arrow_back"/> Back to tenants
              </Link>
              <h2 className="ts-section-title" style={{marginTop:22}}>Tenant not found</h2>
              <p className="ts-muted-note">This tenant is not available in your organization.</p>
            </div>
        : <TenantDirectoryView profiles={data.profiles}/>}
    </main>
  )
}
