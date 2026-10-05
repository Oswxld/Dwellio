from pathlib import Path
import re

repo = Path('.')
repository = repo / 'src/features/billing/data/billingRepository.ts'
page = repo / 'src/pages/BillingPage.tsx'

repo_text = repository.read_text()
page_text = page.read_text()

repo_helper = r'''
type BillingErrorLike = {
  message?: unknown
  code?: unknown
  details?: unknown
  hint?: unknown
}

function logBillingRepositoryError(
  operation: string,
  error: unknown,
  context: Record<string, unknown> = {},
) {
  const payload =
    typeof error === 'object' && error !== null
      ? error as BillingErrorLike
      : {}

  console.error(`[BillingRepository] ${operation} failed`, {
    context,
    message:
      typeof payload.message === 'string'
        ? payload.message
        : error instanceof Error
          ? error.message
          : String(error),
    code: payload.code,
    details: payload.details,
    hint: payload.hint,
    error,
  })
}
'''

marker = "function numberValue(value: unknown) {"
if repo_helper.strip() not in repo_text:
    repo_text = repo_text.replace(marker, repo_helper + "\n" + marker, 1)

old_create = r'''export async function createCurrentBillingCycle(
  propertyId: string,
): Promise<string> {
  const { start, end } = monthDateRange()

  const { data: existing, error: existingError } = await supabase
    .from('billing_cycles')
    .select('id')
    .eq('property_id', propertyId)
    .eq('period_start', start)
    .maybeSingle()

  if (existingError) throw existingError
  if (existing?.id) return existing.id

  const { data: userResult, error: userError } = await supabase.auth.getUser()
  if (userError) throw userError
  if (!userResult.user) throw new Error('You are not signed in.')

  const { data, error } = await supabase
    .from('billing_cycles')
    .insert({
      property_id: propertyId,
      period_start: start,
      period_end: end,
      status: 'draft',
      created_by: userResult.user.id,
    })
    .select('id')
    .single()

  if (error) throw error
  return data.id
}'''

new_create = r'''export async function createCurrentBillingCycle(
  propertyId: string,
): Promise<string> {
  const { start, end } = monthDateRange()

  const { data: existing, error: existingError } = await supabase
    .from('billing_cycles')
    .select('id')
    .eq('property_id', propertyId)
    .eq('period_start', start)
    .maybeSingle()

  if (existingError) {
    logBillingRepositoryError(
      'check existing billing cycle',
      existingError,
      { propertyId, periodStart: start },
    )
    throw existingError
  }

  if (existing?.id) {
    console.info('[BillingRepository] Reusing existing billing cycle', {
      propertyId,
      periodStart: start,
      billingCycleId: existing.id,
    })
    return existing.id
  }

  const { data: userResult, error: userError } = await supabase.auth.getUser()

  if (userError) {
    logBillingRepositoryError(
      'get current user before billing cycle creation',
      userError,
      { propertyId, periodStart: start },
    )
    throw userError
  }

  if (!userResult.user) {
    const error = new Error('You are not signed in.')
    logBillingRepositoryError(
      'validate signed-in user before billing cycle creation',
      error,
      { propertyId, periodStart: start },
    )
    throw error
  }

  const insertPayload = {
    property_id: propertyId,
    period_start: start,
    period_end: end,
    status: 'draft',
    created_by: userResult.user.id,
  }

  const { data, error } = await supabase
    .from('billing_cycles')
    .insert(insertPayload)
    .select('id')
    .single()

  if (error) {
    logBillingRepositoryError(
      'insert billing cycle',
      error,
      {
        propertyId,
        periodStart: start,
        periodEnd: end,
        userId: userResult.user.id,
        status: 'draft',
      },
    )
    throw error
  }

  console.info('[BillingRepository] Billing cycle created', {
    propertyId,
    periodStart: start,
    billingCycleId: data.id,
  })

  return data.id
}'''

if old_create not in repo_text:
    raise SystemExit('createCurrentBillingCycle block not found')
repo_text = repo_text.replace(old_create, new_create, 1)
repository.write_text(repo_text)

page_helper = r'''
type BillingUiErrorLike = {
  message?: unknown
  code?: unknown
  details?: unknown
  hint?: unknown
}

function billingErrorMessage(
  error: unknown,
  fallback: string,
) {
  if (error instanceof Error) {
    return error.message
  }

  if (
    typeof error === 'object'
    && error !== null
    && 'message' in error
    && typeof (error as BillingUiErrorLike).message === 'string'
  ) {
    return (error as BillingUiErrorLike).message as string
  }

  return fallback
}

function logBillingPageError(
  operation: string,
  error: unknown,
  context: Record<string, unknown> = {},
) {
  const payload =
    typeof error === 'object' && error !== null
      ? error as BillingUiErrorLike
      : {}

  console.error(`[BillingPage] ${operation} failed`, {
    context,
    message: billingErrorMessage(error, 'Unknown billing error'),
    code: payload.code,
    details: payload.details,
    hint: payload.hint,
    error,
  })
}
'''

page_marker = "function money(\n"
if page_helper.strip() not in page_text:
    page_text = page_text.replace(page_marker, page_helper + "\n\n" + page_marker, 1)

# Replace every generic Supabase error message expression so plain PostgREST errors keep their message.
pattern = re.compile(
    r"setError\(\s*err instanceof Error\s*\? err\.message\s*:\s*('(?:[^'\\]|\\.)*')\s*,?\s*\)",
    re.MULTILINE,
)
page_text, count = pattern.subn(r"setError(\n          billingErrorMessage(\n            err,\n            \1,\n          ),\n        )", page_text)
if count == 0:
    raise SystemExit('No BillingPage generic error handlers were updated')

# Add a structured console log at every BillingPage catch if one is not already there.
page_text = re.sub(
    r"(\} catch \(err\) \{\n)(?!\s*logBillingPageError)",
    r"\1\n      logBillingPageError(\n        'billing operation',\n        err,\n        { propertyId, cycleId },\n      )\n",
    page_text,
)

page.write_text(page_text)
print(f'Updated BillingPage error handlers: {count}')
