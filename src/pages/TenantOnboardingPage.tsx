import { useEffect, useMemo, useState } from 'react'
import {
  createTenantWithLease,
  getTenantSetupBuildings,
  getTenantSetupFloors,
  getTenantSetupProperties,
  getTenantSetupUnits,
  type BuildingOption,
  type FloorOption,
  type PropertyOption,
  type TenantOnboardingInput,
  type UnitOption,
} from '../lib/tenantLeases'

type Step = 1 | 2 | 3 | 4 | 5 | 6

const initialForm: TenantOnboardingInput = {
  tenant: {
    full_name: '',
    email: '',
    phone: '',
    identification_type: 'national_id',
    identification_number: '',
    date_of_birth: '',
  },

  emergency_contact: {
    full_name: '',
    relationship: '',
    phone: '',
  },

  lease: {
    unit_id: '',
    start_date: '',
    end_date: '',
    rent_amount: 0,
    deposit_amount: 0,
    due_day: 5,
    grace_period_days: 0,
    billing_frequency: 'monthly',
    notes: '',
  },
}

export default function TenantOnboardingPage({
  organizationId,
  onComplete,
  onCancel,
}: {
  organizationId: string
  onComplete: () => void
  onCancel: () => void
}) {
  const [step, setStep] = useState<Step>(1)

  const [form, setForm] =
    useState<TenantOnboardingInput>(initialForm)

  const [properties, setProperties] =
    useState<PropertyOption[]>([])

  const [buildings, setBuildings] =
    useState<BuildingOption[]>([])

  const [floors, setFloors] =
    useState<FloorOption[]>([])

  const [units, setUnits] =
    useState<UnitOption[]>([])

  const [propertyId, setPropertyId] = useState('')
  const [buildingId, setBuildingId] = useState('')
  const [floorId, setFloorId] = useState('')

  const [loadingOptions, setLoadingOptions] =
    useState(false)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const progress = useMemo(
    () => `${Math.round((step / 6) * 100)}%`,
    [step],
  )

  const selectedProperty =
    properties.find(x => x.id === propertyId)

  const selectedBuilding =
    buildings.find(x => x.id === buildingId)

  const selectedFloor =
    floors.find(x => x.id === floorId)

  const selectedUnit =
    units.find(x => x.id === form.lease.unit_id)

  useEffect(() => {
    getTenantSetupProperties(organizationId)
      .then(setProperties)
      .catch(err => {
        setError(
          err instanceof Error
            ? err.message
            : 'Could not load properties.',
        )
      })
  }, [organizationId])

  async function chooseProperty(id: string) {
    setPropertyId(id)
    setBuildingId('')
    setFloorId('')

    setForm(prev => ({
      ...prev,
      lease: {
        ...prev.lease,
        unit_id: '',
      },
    }))

    setBuildings([])
    setFloors([])
    setUnits([])

    if (!id) return

    setLoadingOptions(true)

    try {
      setBuildings(
        await getTenantSetupBuildings(id),
      )
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not load buildings.',
      )
    } finally {
      setLoadingOptions(false)
    }
  }

  async function chooseBuilding(id: string) {
    setBuildingId(id)
    setFloorId('')

    setForm(prev => ({
      ...prev,
      lease: {
        ...prev.lease,
        unit_id: '',
      },
    }))

    setFloors([])
    setUnits([])

    if (!id) return

    setLoadingOptions(true)

    try {
      setFloors(
        await getTenantSetupFloors(id),
      )
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not load floors.',
      )
    } finally {
      setLoadingOptions(false)
    }
  }

  async function chooseFloor(id: string) {
    setFloorId(id)

    setForm(prev => ({
      ...prev,
      lease: {
        ...prev.lease,
        unit_id: '',
      },
    }))

    setUnits([])

    if (!id) return

    setLoadingOptions(true)

    try {
      setUnits(
        await getTenantSetupUnits(id),
      )
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not load units.',
      )
    } finally {
      setLoadingOptions(false)
    }
  }

  function setTenant(
    key: keyof TenantOnboardingInput['tenant'],
    value: string,
  ) {
    setForm(prev => ({
      ...prev,
      tenant: {
        ...prev.tenant,
        [key]: value,
      },
    }))
  }

  function setEmergency(
    key: keyof TenantOnboardingInput['emergency_contact'],
    value: string,
  ) {
    setForm(prev => ({
      ...prev,
      emergency_contact: {
        ...prev.emergency_contact,
        [key]: value,
      },
    }))
  }

  function setLease(
    key: keyof TenantOnboardingInput['lease'],
    value: string | number,
  ) {
    setForm(prev => ({
      ...prev,
      lease: {
        ...prev.lease,
        [key]: value,
      },
    }))
  }

  function validateStep(): string | null {
    if (step === 1) {
      if (!form.tenant.full_name.trim()) {
        return 'Enter the tenant’s full name.'
      }

      if (
        !form.tenant.email.trim() ||
        !form.tenant.email.includes('@')
      ) {
        return 'Enter a valid email address.'
      }

      if (!form.tenant.phone.trim()) {
        return 'Enter the tenant’s phone number.'
      }
    }

    if (step === 2) {
      if (
        !form.tenant.identification_number.trim()
      ) {
        return 'Enter the identification number.'
      }
    }

    if (step === 3) {
      if (
        !form.emergency_contact.full_name.trim()
      ) {
        return 'Enter the emergency contact’s name.'
      }

      if (
        !form.emergency_contact.relationship.trim()
      ) {
        return 'Enter the relationship.'
      }

      if (
        !form.emergency_contact.phone.trim()
      ) {
        return 'Enter the emergency contact’s phone number.'
      }
    }

    if (step === 4) {
      if (
        !propertyId ||
        !buildingId ||
        !floorId ||
        !form.lease.unit_id
      ) {
        return 'Select the property, building, floor and unit.'
      }

      if (selectedUnit?.status !== 'vacant') {
        return 'Only vacant units can receive a new lease.'
      }
    }

    if (step === 5) {
      if (
        !form.lease.start_date ||
        !form.lease.end_date
      ) {
        return 'Choose the lease start and end dates.'
      }

      if (
        form.lease.end_date <=
        form.lease.start_date
      ) {
        return 'The lease end date must be after the start date.'
      }

      if (form.lease.rent_amount <= 0) {
        return 'Enter a rent amount greater than zero.'
      }

      if (form.lease.deposit_amount < 0) {
        return 'Deposit cannot be negative.'
      }

      if (
        form.lease.due_day < 1 ||
        form.lease.due_day > 31
      ) {
        return 'Due day must be between 1 and 31.'
      }
    }

    return null
  }

  function next() {
    setError('')

    const validationError = validateStep()

    if (validationError) {
      setError(validationError)
      return
    }

    setStep(
      prev => Math.min(6, prev + 1) as Step,
    )
  }

  function back() {
    setError('')

    setStep(
      prev => Math.max(1, prev - 1) as Step,
    )
  }

  async function finish() {
    setError('')
    setSaving(true)

    try {
      const result =
        await createTenantWithLease(
          organizationId,
          form,
        )

      setSuccess(
        result.linked_user_id
          ? 'Tenant created and linked to their existing Dwellio account. The lease is waiting for their acceptance.'
          : 'Tenant created. The lease is waiting for tenant acceptance and the unit is now reserved.',
      )

      setTimeout(onComplete, 1000)
    } catch (err) {
  if (err && typeof err === 'object' && 'message' in err) {
    // Typecast as any to bypass the unknown check, then enforce string
    setError(String((err as any).message));
  } 
  else if (err instanceof Error) {
    setError(err.message);
  } 
  else {
    setError('Something went wrong. Please try again.');
  }
} finally {
      setSaving(false)
    }
  }

  return (
    <main className="onboarding-shell">
      <header className="onboarding-header">
        <div className="brand">
          dwellio<span>.</span>
        </div>

        <div className="progress-wrap">
          <span>Tenant {step}/6</span>

          <div className="progress">
            <i style={{ width: progress }} />
          </div>
        </div>
      </header>

      <section className="setup-card tenant-setup-card">
        <p className="eyebrow">ADD TENANT</p>

        {step === 1 && (
          <>
            <h1>Who are we adding?</h1>

            <p className="muted">
              Start with the tenant’s basic contact
              details. If they already have a Dwellio
              account, we’ll link it automatically.
            </p>

            <div className="form-grid">
              <label>
                Full name
                <input
                  autoFocus
                  value={form.tenant.full_name}
                  onChange={e =>
                    setTenant(
                      'full_name',
                      e.target.value,
                    )
                  }
                  placeholder="John Kamau"
                />
              </label>

              <label>
                Email
                <input
                  type="email"
                  value={form.tenant.email}
                  onChange={e =>
                    setTenant(
                      'email',
                      e.target.value,
                    )
                  }
                  placeholder="john@example.com"
                />
              </label>

              <label>
                Phone
                <input
                  value={form.tenant.phone}
                  onChange={e =>
                    setTenant(
                      'phone',
                      e.target.value,
                    )
                  }
                  placeholder="0712 345 678"
                />
              </label>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h1>Identification details.</h1>

            <p className="muted">
              Keep identity information with the
              tenant rather than the lease so it
              remains part of their rental history.
            </p>

            <div className="form-grid">
              <label>
                Identification type
                <select
                  value={
                    form.tenant.identification_type
                  }
                  onChange={e =>
                    setTenant(
                      'identification_type',
                      e.target.value,
                    )
                  }
                >
                  <option value="national_id">
                    National ID
                  </option>

                  <option value="passport">
                    Passport
                  </option>

                  <option value="other">
                    Other
                  </option>
                </select>
              </label>

              <label>
                Identification number
                <input
                  autoFocus
                  value={
                    form.tenant
                      .identification_number
                  }
                  onChange={e =>
                    setTenant(
                      'identification_number',
                      e.target.value,
                    )
                  }
                  placeholder="12345678"
                />
              </label>

              <label>
                Date of birth
                <span className="optional">
                  optional
                </span>

                <input
                  type="date"
                  value={
                    form.tenant.date_of_birth
                  }
                  onChange={e =>
                    setTenant(
                      'date_of_birth',
                      e.target.value,
                    )
                  }
                />
              </label>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h1>Emergency contact.</h1>

            <p className="muted">
              Who should the property manager
              contact if there’s an emergency?
            </p>

            <div className="form-grid">
              <label>
                Full name
                <input
                  autoFocus
                  value={
                    form.emergency_contact
                      .full_name
                  }
                  onChange={e =>
                    setEmergency(
                      'full_name',
                      e.target.value,
                    )
                  }
                  placeholder="Jane Kamau"
                />
              </label>

              <label>
                Relationship
                <input
                  value={
                    form.emergency_contact
                      .relationship
                  }
                  onChange={e =>
                    setEmergency(
                      'relationship',
                      e.target.value,
                    )
                  }
                  placeholder="Sister"
                />
              </label>

              <label>
                Phone
                <input
                  value={
                    form.emergency_contact.phone
                  }
                  onChange={e =>
                    setEmergency(
                      'phone',
                      e.target.value,
                    )
                  }
                  placeholder="0722 345 678"
                />
              </label>
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <h1>Where will they live?</h1>

            <p className="muted">
              Choose the exact unit. Creating the
              lease will reserve the unit until the
              tenant accepts.
            </p>

            <div className="form-grid four-columns">
              <label>
                Property

                <select
                  autoFocus
                  value={propertyId}
                  onChange={e =>
                    chooseProperty(e.target.value)
                  }
                >
                  <option value="">
                    Select property
                  </option>

                  {properties.map(item => (
                    <option
                      key={item.id}
                      value={item.id}
                    >
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Building

                <select
                  value={buildingId}
                  onChange={e =>
                    chooseBuilding(e.target.value)
                  }
                  disabled={!propertyId}
                >
                  <option value="">
                    Select building
                  </option>

                  {buildings.map(item => (
                    <option
                      key={item.id}
                      value={item.id}
                    >
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Floor

                <select
                  value={floorId}
                  onChange={e =>
                    chooseFloor(e.target.value)
                  }
                  disabled={!buildingId}
                >
                  <option value="">
                    Select floor
                  </option>

                  {floors.map(item => (
                    <option
                      key={item.id}
                      value={item.id}
                    >
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Unit

                <select
                  value={form.lease.unit_id}
                  onChange={e => {
                    const unit =
                      units.find(
                        item =>
                          item.id ===
                          e.target.value,
                      )

                    setLease(
                      'unit_id',
                      e.target.value,
                    )

                    if (
                      unit?.default_rent_amount
                    ) {
                      setLease(
                        'rent_amount',
                        Number(
                          unit.default_rent_amount,
                        ),
                      )
                    }
                  }}
                  disabled={!floorId}
                >
                  <option value="">
                    Select unit
                  </option>

                  {units.map(item => (
                    <option
                      key={item.id}
                      value={item.id}
                      disabled={
                        item.status !== 'vacant'
                      }
                    >
                      {item.name}
                      {item.status !== 'vacant'
                        ? ` — ${item.status}`
                        : ''}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {loadingOptions && (
              <p className="builder-note">
                Loading available options…
              </p>
            )}
          </>
        )}

        {step === 5 && (
          <>
            <h1>Set the lease terms.</h1>

            <p className="muted">
              This creates a lease proposal. It
              will be <strong>waiting for tenant
              acceptance</strong>; it will not be
              billed as an active lease yet.
            </p>

            <div className="form-grid">
              <label>
                Start date
                <input
                  autoFocus
                  type="date"
                  value={
                    form.lease.start_date
                  }
                  onChange={e =>
                    setLease(
                      'start_date',
                      e.target.value,
                    )
                  }
                />
              </label>

              <label>
                End date
                <input
                  type="date"
                  value={
                    form.lease.end_date
                  }
                  onChange={e =>
                    setLease(
                      'end_date',
                      e.target.value,
                    )
                  }
                />
              </label>

              <label>
                Monthly rent
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={
                    form.lease.rent_amount
                  }
                  onChange={e =>
                    setLease(
                      'rent_amount',
                      Number(e.target.value),
                    )
                  }
                />
              </label>

              <label>
                Deposit
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={
                    form.lease.deposit_amount
                  }
                  onChange={e =>
                    setLease(
                      'deposit_amount',
                      Number(e.target.value),
                    )
                  }
                />
              </label>

              <label>
                Rent due day
                <input
                  type="number"
                  min="1"
                  max="31"
                  value={form.lease.due_day}
                  onChange={e =>
                    setLease(
                      'due_day',
                      Number(e.target.value),
                    )
                  }
                />
              </label>

              <label>
                Grace period
                <input
                  type="number"
                  min="0"
                  max="90"
                  value={
                    form.lease
                      .grace_period_days
                  }
                  onChange={e =>
                    setLease(
                      'grace_period_days',
                      Number(e.target.value),
                    )
                  }
                />
              </label>

              <label>
                Billing frequency

                <select
                  value={
                    form.lease
                      .billing_frequency
                  }
                  onChange={e =>
                    setLease(
                      'billing_frequency',
                      e.target.value,
                    )
                  }
                >
                  <option value="monthly">
                    Monthly
                  </option>

                  <option value="quarterly">
                    Quarterly
                  </option>

                  <option value="yearly">
                    Yearly
                  </option>
                </select>
              </label>

              <label>
                Notes
                <span className="optional">
                  optional
                </span>

                <input
                  value={form.lease.notes}
                  onChange={e =>
                    setLease(
                      'notes',
                      e.target.value,
                    )
                  }
                  placeholder="Any lease notes"
                />
              </label>
            </div>
          </>
        )}

        {step === 6 && (
          <>
            <h1>Review before sending.</h1>

            <p className="muted">
              Dwellio will create the tenant and
              a <strong>pending acceptance</strong>
              lease in one transaction.
            </p>

            <div className="review-list">
              <ReviewRow
                label="Tenant"
                value={
                  form.tenant.full_name
                }
              />

              <ReviewRow
                label="Email"
                value={form.tenant.email}
              />

              <ReviewRow
                label="Phone"
                value={form.tenant.phone}
              />

              <ReviewRow
                label="Unit"
                value={`${selectedProperty?.name ?? '—'} / ${selectedBuilding?.name ?? '—'} / ${selectedFloor?.name ?? '—'} / ${selectedUnit?.name ?? '—'}`}
              />

              <ReviewRow
                label="Lease"
                value={`${form.lease.start_date} → ${form.lease.end_date}`}
              />

              <ReviewRow
                label="Rent"
                value={`KSh ${form.lease.rent_amount.toLocaleString()}`}
              />

              <ReviewRow
                label="Deposit"
                value={`KSh ${form.lease.deposit_amount.toLocaleString()}`}
              />

              <ReviewRow
                label="Status"
                value="Waiting for tenant acceptance · Unit reserved"
              />
            </div>
          </>
        )}

        {error && (
          <div className="alert error">
            {error}
          </div>
        )}

        {success && (
          <div className="alert success">
            {success}
          </div>
        )}

        <div className="actions">
          {step === 1 && (
            <button
              className="secondary"
              onClick={onCancel}
            >
              Cancel
            </button>
          )}

          {step > 1 && (
            <button
              className="secondary"
              onClick={back}
            >
              Back
            </button>
          )}

          {step < 6 ? (
            <button
              className="primary"
              onClick={next}
            >
              Continue
            </button>
          ) : (
            <button
              className="primary"
              onClick={finish}
              disabled={saving}
            >
              {saving
                ? 'Creating tenant…'
                : 'Create & send lease'}
            </button>
          )}
        </div>
      </section>
    </main>
  )
}

function ReviewRow({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="review-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}