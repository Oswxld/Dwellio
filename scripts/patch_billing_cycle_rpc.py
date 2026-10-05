from pathlib import Path
import re

repo_path = Path('src/features/billing/data/billingRepository.ts')
text = repo_path.read_text()

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

repo_path.write_text(updated)

page_path = Path('src/pages/BillingPage.tsx')
page = page_path.read_text()
old = 'return <PageSkeleton />'
new = 'return <PageSkeleton variant="billing" />'

if old in page:
    page = page.replace(old, new, 1)
elif new not in page:
    raise SystemExit('Could not find BillingPage PageSkeleton usage to patch.')

page_path.write_text(page)
