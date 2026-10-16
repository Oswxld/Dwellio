-- DWELLIO | MOVE-OUT READ-ONLY SCHEMA PREFLIGHT
-- Run in Supabase SQL Editor BEFORE testing real financial processing.
-- Does not insert, update, delete, or call a financial mutation function.

-- 1) List the actual invoice/deposit/accounting columns for reconciliation.
select table_name, column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public'
   and table_name in (
      'invoices', 'invoice_lines', 'invoice_line_sources',
      'security_deposits', 'deposit_allocations',
      'payments', 'payment_allocations',
      'move_out_inspections', 'move_out_inspection_bills',
      'move_out_settlements', 'move_out_sms_deliveries'
   )
 order by table_name, ordinal_position;

-- 2) Confirm exact signatures used by process_move_out_invoice().
select
  to_regprocedure('public.apply_deposit_deduction(uuid,uuid,numeric,text)') as apply_deposit_deduction,
  to_regprocedure('public.refresh_invoice_balance(uuid)') as refresh_invoice_balance,
  to_regprocedure('public.generate_invoice_number()') as generate_invoice_number,
  to_regprocedure('public.process_move_out_invoice(uuid)') as process_move_out_invoice,
  to_regprocedure('public.claim_invoice_sms_delivery(uuid,text,uuid)') as monthly_sms_claim,
  to_regprocedure('public.claim_move_out_sms_delivery(uuid,text,uuid)') as move_out_sms_claim,
  to_regprocedure('public.claim_unified_invoice_sms_delivery(uuid,text,uuid)') as unified_sms_claim,
  to_regprocedure('public.finalize_move_out(uuid,uuid,date,boolean,boolean)') as finalize_move_out;

-- 3) Inspect the live enum labels rather than guessing them.
select cls.relname as table_name, att.attname as column_name,
       typ.typname as enum_type, e.enumlabel as enum_label
  from pg_catalog.pg_class cls
  join pg_catalog.pg_namespace n on n.oid=cls.relnamespace
  join pg_catalog.pg_attribute att on att.attrelid=cls.oid
  join pg_catalog.pg_type typ on typ.oid=att.atttypid
  join pg_catalog.pg_enum e on e.enumtypid=typ.oid
 where n.nspname='public'
   and (cls.relname,att.attname) in (
     ('invoices','invoice_type'),('invoices','status'),
     ('invoice_lines','line_type'),('leases','status'),('units','status')
   )
 order by table_name,column_name,e.enumsortorder;

-- 4) Check property ownership path without relying on units.organization_id.
select
  u.id as unit_id,
  p.id as property_id,
  p.organization_id,
  l.organization_id as lease_organization_id,
  l.id as lease_id
from public.units u
join public.floors f on f.id = u.floor_id
join public.buildings b on b.id = f.building_id
join public.properties p on p.id = b.property_id
left join public.leases l on l.unit_id = u.id and l.deleted_at is null
order by p.name,u.name,l.created_at desc
limit 25;

-- 5) Where duplicates/invalid ownership would stop the financial workflow.
select
  l.id as lease_id,
  l.tenant_id,
  l.unit_id,
  l.organization_id as lease_organization,
  t.organization_id as tenant_organization,
  p.organization_id as property_organization
from public.leases l
join public.tenants t on t.id=l.tenant_id
join public.units u on u.id=l.unit_id
join public.floors f on f.id=u.floor_id
join public.buildings b on b.id=f.building_id
join public.properties p on p.id=b.property_id
where l.organization_id is distinct from t.organization_id
   or l.organization_id is distinct from p.organization_id
limit 50;
