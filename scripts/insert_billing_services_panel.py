from pathlib import Path

path = Path('src/pages/BillingPage.tsx')
text = path.read_text()

import_marker = "import PageSkeleton from '../components/loading/PageSkeleton'\n"
import_line = "import BillingServicesPanel from '../features/billing/components/BillingServicesPanel'\n"

if import_line not in text:
    if import_marker not in text:
        raise SystemExit('PageSkeleton import marker not found')
    text = text.replace(import_marker, import_marker + import_line, 1)

marker = """              </section>\n\n\n\n              {/* READINESS + CYCLE */}"""
insert = """              </section>\n\n\n              <BillingServicesPanel\n                propertyId={propertyId}\n                effectiveFrom={cycle.period_start}\n                effectiveDate={cycle.period_end}\n                onChanged={refreshDashboard}\n              />\n\n\n\n              {/* READINESS + CYCLE */}"""

if '<BillingServicesPanel' not in text:
    if marker not in text:
        raise SystemExit('Metrics insertion marker not found')
    text = text.replace(marker, insert, 1)

path.write_text(text)
print('Billing services panel inserted')
