from pathlib import Path
import re

path = Path('src/features/billing/data/billingRepository.ts')
text = path.read_text()

pattern = re.compile(
    r"export async function createCurrentBillingCycle\(.*?\n}\n\nexport async function fetchBillingDashboard",
    re.S,
)

replacement = '''export async function createCurrentBillingCycle(
  propertyId: string,
): Promise<string> {
  const { data, error } = await supabase.rpc(
    'create_billing_cycle',
    {
      p_property_id: propertyId,
    },
  )

  if (error) {
    logBillingRepositoryError(
      'create billing cycle rpc',
      error,
      { propertyId },
    )
    throw error
  }

  if (typeof data !== 'string' || !data) {
    const resultError = new Error(
      'The billing cycle RPC did not return a cycle id.',
    )

    logBillingRepositoryError(
      'validate create billing cycle rpc result',
      resultError,
      { propertyId, data },
    )

    throw resultError
  }

  return data
}

export async function fetchBillingDashboard'''

updated, count = pattern.subn(replacement, text, count=1)
if count != 1:
    raise SystemExit(f'Expected to patch one createCurrentBillingCycle function, patched {count}.')

path.write_text(updated)
