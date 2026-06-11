-- Etapa D — RLS por papel (substitui políticas abertas {public, true})

-- Função para identificar o master (lê profiles ignorando RLS via security definer).
create or replace function public.is_master()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'master');
$$;

-- ============ freight_calculations ============
drop policy if exists "Enable read access for all users"   on public.freight_calculations;
drop policy if exists "Enable insert access for all users" on public.freight_calculations;
drop policy if exists "Enable update access for all users" on public.freight_calculations;
drop policy if exists "Enable delete access for all users" on public.freight_calculations;
create policy fc_select on public.freight_calculations for select to authenticated using (true);
create policy fc_insert on public.freight_calculations for insert to authenticated with check (true);
create policy fc_update on public.freight_calculations for update to authenticated using (true) with check (true);
create policy fc_delete on public.freight_calculations for delete to authenticated using (public.is_master());

-- ============ customers ============
drop policy if exists "Enable all access for customers" on public.customers;
drop policy if exists "Enable delete for authenticated users only" on public.customers;
create policy cust_select on public.customers for select to authenticated using (true);
create policy cust_insert on public.customers for insert to authenticated with check (public.is_master());
create policy cust_update on public.customers for update to authenticated using (public.is_master()) with check (public.is_master());
create policy cust_delete on public.customers for delete to authenticated using (public.is_master());

-- ============ system_config ============
drop policy if exists "Enable all access for system_config" on public.system_config;
create policy sc_select on public.system_config for select to authenticated using (true);
create policy sc_insert on public.system_config for insert to authenticated with check (public.is_master());
create policy sc_update on public.system_config for update to authenticated using (public.is_master()) with check (public.is_master());

-- ============ vehicle_configs ============
drop policy if exists "Enable all access for vehicle_configs" on public.vehicle_configs;
create policy vc_select on public.vehicle_configs for select to authenticated using (true);
create policy vc_insert on public.vehicle_configs for insert to authenticated with check (public.is_master());
create policy vc_update on public.vehicle_configs for update to authenticated using (public.is_master()) with check (public.is_master());
create policy vc_delete on public.vehicle_configs for delete to authenticated using (public.is_master());
