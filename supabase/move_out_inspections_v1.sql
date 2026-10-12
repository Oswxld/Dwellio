-- Dwellio move-out inspection storage; apply after existing lease and org tables.
-- Drafts only. Processing the final invoice and terminating leases require separate
-- audited billing and vacancy RPCs; these tables never modify accounting totals.
create table if not exists public.move_out_inspections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  lease_id uuid not null unique references public.leases(id),
  tenant_id uuid not null references public.tenants(id),
  unit_id uuid not null references public.units(id),
  inspected_at date not null default current_date,
  status text not null default 'draft' check (status in ('draft','completed')),
  notes text,
  created_by uuid not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.move_out_inspection_bills (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.move_out_inspections(id) on delete cascade,
  title text not null check (length(btrim(title)) between 2 and 150),
  description text,
  amount numeric(14,2) not null check (amount > 0),
  created_at timestamptz not null default now()
);
create index if not exists move_out_bills_inspection_idx on public.move_out_inspection_bills(inspection_id);
alter table public.move_out_inspections enable row level security;
alter table public.move_out_inspection_bills enable row level security;
create policy move_out_inspections_read on public.move_out_inspections for select to authenticated
  using (public.is_org_admin(organization_id));
create policy move_out_inspections_insert on public.move_out_inspections for insert to authenticated
  with check (public.is_org_admin(organization_id) and created_by = auth.uid()
    and exists (select 1 from public.leases l where l.id = lease_id
      and l.tenant_id = tenant_id and l.unit_id = unit_id and l.organization_id = organization_id
      and l.status in ('active','notice_given','expired')));
create policy move_out_inspections_update on public.move_out_inspections for update to authenticated
  using (public.is_org_admin(organization_id) and status = 'draft')
  with check (public.is_org_admin(organization_id) and status in ('draft','completed'));
create policy move_out_bills_read on public.move_out_inspection_bills for select to authenticated
  using (exists (select 1 from public.move_out_inspections i
    where i.id = inspection_id and public.is_org_admin(i.organization_id)));
create policy move_out_bills_insert on public.move_out_inspection_bills for insert to authenticated
  with check (exists (select 1 from public.move_out_inspections i
    where i.id = inspection_id and i.status = 'draft' and public.is_org_admin(i.organization_id)));
create policy move_out_bills_update on public.move_out_inspection_bills for update to authenticated
  using (exists (select 1 from public.move_out_inspections i
    where i.id = inspection_id and i.status = 'draft' and public.is_org_admin(i.organization_id)))
  with check (exists (select 1 from public.move_out_inspections i
    where i.id = inspection_id and i.status = 'draft' and public.is_org_admin(i.organization_id)));
create policy move_out_bills_delete on public.move_out_inspection_bills for delete to authenticated
  using (exists (select 1 from public.move_out_inspections i
    where i.id = inspection_id and i.status = 'draft' and public.is_org_admin(i.organization_id)));
grant select,insert,update on public.move_out_inspections to authenticated;
grant select,insert,update,delete on public.move_out_inspection_bills to authenticated;
