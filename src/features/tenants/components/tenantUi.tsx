import type { ReactNode } from 'react'
import type { TenantLease, TenantProfile } from '../data/tenantManagementRepository'

export function money(value: number | null | undefined, compact = false): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'Unavailable'
  return `KSh ${value.toLocaleString('en-KE', {
    minimumFractionDigits: compact ? 0 : 2,
    maximumFractionDigits: 2,
  })}`
}

export function dateLabel(value: string | null | undefined): string {
  if (!value) return '—'
  return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('en-KE', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

export function monthLabel(value: string): string {
  return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('en-KE', {
    month: 'short', year: 'numeric',
  })
}

export function kenyaDate(): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const part = (name: string) => parts.find(row => row.type === name)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

export function daysUntil(date: string, today = kenyaDate()): number {
  const day = (raw: string) => Date.parse(`${raw.slice(0, 10)}T12:00:00Z`)
  return Math.round((day(date) - day(today)) / 86400000)
}

export function currentLease(profile: TenantProfile): TenantLease | null {
  return profile.leases.find(lease => ['active', 'notice_given'].includes(lease.status)) ??
    profile.leases.find(lease => ['not_moved_in_yet', 'pending_confirmation', 'pending_acceptance'].includes(lease.status)) ??
    profile.leases[0] ?? null
}

export function leaseStatus(status: string): string {
  const names: Record<string, string> = {
    active: 'Active',
    notice_given: 'Notice given',
    pending_acceptance: 'Awaiting acceptance',
    pending_confirmation: 'Awaiting acceptance',
    not_moved_in_yet: 'Not moved in yet',
    expired: 'Expired',
    terminated: 'Terminated',
    declined: 'Declined',
    draft: 'Draft',
  }
  return names[status] ?? status.replaceAll('_', ' ')
}

export function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase()).join('')
}

export function Icon({ name, className = '' }: { name: string; className?: string }) {
  return <span aria-hidden="true" className={`material-symbols-outlined ${className}`}>{name}</span>
}

export function Status({ status }: { status: string }) {
  const tone = status === 'active' || status === 'paid' || status === 'accepted' ? 'good' :
    ['pending_confirmation','pending_acceptance','not_moved_in_yet','notice_given','pending','issued','partially_paid'].includes(status) ? 'wait' :
      status === 'overdue' ? 'bad' : 'neutral'
  return (
    <span className={`ts-status ts-status--${tone}`}>
      <span className="ts-status-dot"/>
      {leaseStatus(status)}
    </span>
  )
}

export function SectionHeading({ eyebrow, title, aside }: {
  eyebrow?: string; title: string; aside?: ReactNode
}) {
  return (
    <div className="ts-section-header">
      <div>
        {eyebrow && <p className="ts-eyebrow">{eyebrow}</p>}
        <h2 className="ts-section-title">{title}</h2>
      </div>
      {aside}
    </div>
  )
}

export function Detail({ label, value, icon }: { label: string; value: ReactNode; icon?: string }) {
  return (
    <div className="ts-detail">
      <div className="ts-detail-label">{icon && <Icon name={icon}/>} {label}</div>
      <div className="ts-detail-value">{value}</div>
    </div>
  )
}
