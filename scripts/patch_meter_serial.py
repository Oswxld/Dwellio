from pathlib import Path

path = Path('src/features/billing/data/billingServicesRepository.ts')
text = path.read_text()

helper_anchor = """function numberValue(value: unknown) {\n  const parsed = Number(value ?? 0)\n  return Number.isFinite(parsed) ? parsed : 0\n}\n"""
helper = helper_anchor + """\nfunction createMeterSerialNumber(\n  serviceId: string,\n  unitId: string,\n) {\n  const randomSuffix = globalThis.crypto\n    .randomUUID()\n    .replaceAll('-', '')\n    .slice(0, 10)\n    .toUpperCase()\n\n  return [\n    'DW',\n    serviceId.slice(0, 8).toUpperCase(),\n    unitId.slice(0, 8).toUpperCase(),\n    randomSuffix,\n  ].join('-')\n}\n"""

if 'function createMeterSerialNumber' not in text:
    if helper_anchor not in text:
        raise SystemExit('numberValue anchor not found')
    text = text.replace(helper_anchor, helper, 1)

old = """      missingRows.map(item => ({\n        unit_id: item.unitId,\n        service_id: serviceId,\n        status: 'active',\n        installed_at: effectiveFrom,\n      })),\n"""
new = """      missingRows.map(item => ({\n        unit_id: item.unitId,\n        service_id: serviceId,\n        serial_number: createMeterSerialNumber(\n          serviceId,\n          item.unitId,\n        ),\n        status: 'active',\n        installed_at: effectiveFrom,\n      })),\n"""

if 'serial_number: createMeterSerialNumber' not in text:
    if old not in text:
        raise SystemExit('meter insert anchor not found')
    text = text.replace(old, new, 1)

path.write_text(text)
print('meter serial number generation added')
