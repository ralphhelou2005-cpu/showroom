begin;

create table public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admin_users enable row level security;
revoke all on public.admin_users from anon, authenticated;
grant select on public.admin_users to authenticated;
create policy membership_read_self on public.admin_users for select to authenticated
  using (user_id = (select auth.uid()));

create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admin_users where user_id = (select auth.uid()));
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

create function public.valid_vehicle_specs(value jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
begin
  if jsonb_typeof(value) <> 'object' then return false; end if;
  return (select count(*) <= 24 and coalesce(bool_and(
    length(key) between 1 and 80 and jsonb_typeof(entry) = 'string'
    and length(entry #>> '{}') <= 400), true)
    from jsonb_each(value) as fields(key, entry));
end;
$$;

create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique check (legacy_id is null or legacy_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  brand text not null check (length(trim(brand)) between 1 and 80),
  model text not null check (length(trim(model)) between 1 and 120),
  year smallint not null check (year between 1886 and 2100),
  price numeric(12,2) not null check (price >= 0),
  mileage integer check (mileage >= 0),
  mileage_label text not null default '' check (length(mileage_label) <= 100),
  fuel text not null default '' check (length(fuel) <= 100),
  transmission text not null default '' check (length(transmission) <= 120),
  color text not null default '' check (length(color) <= 80),
  body_type text not null default '' check (length(body_type) <= 80),
  collection text not null default '' check (length(collection) <= 80),
  horsepower text not null default '' check (length(horsepower) <= 120),
  engine text not null default '' check (length(engine) <= 200),
  description text not null default '' check (length(description) <= 10000),
  specifications jsonb not null default '{}' check (public.valid_vehicle_specs(specifications)),
  status text not null default 'available' check (status in ('available', 'sold')),
  published boolean not null default false,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index vehicles_public_inventory on public.vehicles (created_at desc) where published and status = 'available';
alter table public.vehicles enable row level security;
revoke all on public.vehicles from anon, authenticated;
grant select on public.vehicles to anon, authenticated;
create policy vehicles_public_read on public.vehicles for select to anon, authenticated
  using (published and status = 'available');
create policy vehicles_admin_read on public.vehicles for select to authenticated using ((select public.is_admin()));

create table public.vehicle_images (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  storage_path text unique,
  legacy_path text,
  label text not null default '' check (length(label) <= 120),
  credit text not null default '' check (length(credit) <= 800),
  sort_order integer not null default 0 check (sort_order between 0 and 23),
  is_cover boolean not null default false,
  pending boolean not null default false,
  check (storage_path is null or storage_path ~ ('^' || vehicle_id::text || '/[0-9a-f-]{36}\.webp$')),
  check (legacy_path is null or legacy_path ~ '^assets/photos/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp)$'),
  check ((pending and storage_path is null and legacy_path is null and not is_cover)
    or (not pending and num_nonnulls(storage_path, legacy_path) = 1))
);
create unique index vehicle_one_cover on public.vehicle_images (vehicle_id) where is_cover;
create index vehicle_images_inventory on public.vehicle_images (vehicle_id, sort_order);
alter table public.vehicle_images enable row level security;
revoke all on public.vehicle_images from anon, authenticated;
grant select on public.vehicle_images to anon, authenticated;
create policy images_public_read on public.vehicle_images for select to anon, authenticated using (
  exists (select 1 from public.vehicles where id = vehicle_id and published and status = 'available')
);
create policy images_admin_read on public.vehicle_images for select to authenticated using ((select public.is_admin()));

create table public.storage_cleanup (
  path text primary key,
  not_before timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table public.storage_cleanup enable row level security;
revoke all on public.storage_cleanup from anon, authenticated;
grant select, delete on public.storage_cleanup to authenticated;
create policy cleanup_admin_read on public.storage_cleanup for select to authenticated using ((select public.is_admin()));
create policy cleanup_admin_delete on public.storage_cleanup for delete to authenticated using ((select public.is_admin()));

create function public.queue_vehicle_image_cleanup() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.storage_path is not null then
    insert into public.storage_cleanup(path) values (old.storage_path) on conflict do nothing;
  end if;
  return old;
end;
$$;
revoke all on function public.queue_vehicle_image_cleanup() from public;
create trigger queue_deleted_image after delete on public.vehicle_images
  for each row execute function public.queue_vehicle_image_cleanup();

create function public.valid_site_content(section text, value jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare item jsonb; allowed text[]; field record;
begin
  if jsonb_typeof(value) <> 'object' then return false; end if;
  allowed := case section
    when 'about' then array['paragraph1','paragraph2','values']
    when 'services' then array['items']
    when 'contact' then array['email','phone','whatsapp','address','hours']
    when 'copy' then array['inventory_title','inventory_intro','brands_title','brands_intro','services_title','services_intro','about_title','about_intro','contact_title','contact_intro']
    else null end;
  if allowed is null then return false; end if;
  for field in select * from jsonb_each(value) loop
    if not field.key = any(allowed) then return false; end if;
    if field.key in ('values','items') then
      if jsonb_typeof(field.value) <> 'array' or jsonb_array_length(field.value) not between 1 and 12 then return false; end if;
      for item in select * from jsonb_array_elements(field.value) loop
        if jsonb_typeof(item) <> 'object' or jsonb_typeof(item->'title') is distinct from 'string'
          or jsonb_typeof(item->'description') is distinct from 'string'
          or length(item->>'title') not between 1 and 120 or length(item->>'description') > 2000
          or (select count(*) from jsonb_object_keys(item)) <> 2 then return false; end if;
      end loop;
    elsif jsonb_typeof(field.value) <> 'string' or length(field.value #>> '{}') > 4000 then return false;
    end if;
  end loop;
  return (select count(*) from jsonb_object_keys(value)) = cardinality(allowed);
end;
$$;

create table public.site_content (
  section text primary key check (section in ('about','services','contact','copy')),
  data jsonb not null,
  published boolean not null default false,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  check (public.valid_site_content(section, data))
);
alter table public.site_content enable row level security;
revoke all on public.site_content from anon, authenticated;
grant select on public.site_content to anon, authenticated;
create policy content_public_read on public.site_content for select to anon, authenticated using (published);
create policy content_admin_read on public.site_content for select to authenticated using ((select public.is_admin()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vehicle-images', 'vehicle-images', false, 2097152, array['image/webp']);

create policy vehicle_storage_public_read on storage.objects for select to anon, authenticated using (
  bucket_id = 'vehicle-images' and exists (
    select 1 from public.vehicle_images as image
    join public.vehicles as vehicle on vehicle.id = image.vehicle_id
    where image.storage_path = name and vehicle.published and vehicle.status = 'available'
  )
);
create policy vehicle_storage_admin_read on storage.objects for select to authenticated
  using (bucket_id = 'vehicle-images' and (select public.is_admin()));
create policy vehicle_storage_admin_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'vehicle-images' and (select public.is_admin()) and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.webp$'
  and exists (select 1 from public.vehicles where id::text = split_part(name, '/', 1))
);
create policy vehicle_storage_admin_delete on storage.objects for delete to authenticated using (
  bucket_id = 'vehicle-images' and (select public.is_admin())
  and not exists (select 1 from public.vehicle_images where storage_path = name)
);

commit;