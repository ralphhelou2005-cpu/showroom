begin;

create function public.save_vehicle(payload jsonb, images jsonb, expected_version integer default null)
returns public.vehicles language plpgsql security definer set search_path = '' as $$
<<command>>
declare vehicle_id uuid; saved public.vehicles; previous public.vehicles; image jsonb; image_id uuid;
begin
  if not public.is_admin() then raise exception 'Admin access required' using errcode = '42501'; end if;
  if jsonb_typeof(payload) is distinct from 'object' or jsonb_typeof(images) is distinct from 'array'
    or jsonb_array_length(images) > 24 then raise exception 'Invalid vehicle or image data'; end if;
  vehicle_id := (payload->>'id')::uuid;
  if vehicle_id is null then raise exception 'Vehicle ID is required'; end if;
  select * into previous from public.vehicles where id = vehicle_id for update;
  if found then
    if expected_version is distinct from previous.version then
      raise exception 'This vehicle changed. Reload before saving.' using errcode = '40001';
    end if;
  elsif expected_version is not null then
    raise exception 'This vehicle was deleted. Reload the inventory.' using errcode = '40001';
  end if;
  if (select count(*) from jsonb_array_elements(images) as item where coalesce((item->>'is_cover')::boolean, false))
    <> (case when exists (select 1 from jsonb_array_elements(images) as item where not coalesce((item->>'pending')::boolean, false)) then 1 else 0 end)
    then raise exception 'Choose exactly one cover for a vehicle with photographs'; end if;
  for image in select * from jsonb_array_elements(images) loop
    if jsonb_typeof(image) is distinct from 'object' then raise exception 'Invalid image'; end if;
    image_id := (image->>'id')::uuid;
    if image_id is null then raise exception 'Image ID is required'; end if;
    if image->>'legacy_path' is not null and not exists (
      select 1 from public.vehicle_images where id = image_id and vehicle_images.vehicle_id = command.vehicle_id
        and legacy_path = image->>'legacy_path'
    ) then raise exception 'Legacy image references cannot be created or replaced'; end if;
    if image->>'storage_path' is not null and not exists (
      select 1 from storage.objects where bucket_id = 'vehicle-images' and name = image->>'storage_path'
    ) then raise exception 'Upload the photograph before saving its reference'; end if;
  end loop;
  insert into public.vehicles (
    id, legacy_id, brand, model, year, price, mileage, mileage_label, fuel, transmission, color, body_type,
    collection, horsepower, engine, description, specifications, status, published, version
  ) values (
    vehicle_id, previous.legacy_id, trim(payload->>'brand'), trim(payload->>'model'), (payload->>'year')::smallint,
    (payload->>'price')::numeric, nullif(payload->>'mileage','')::integer, coalesce(payload->>'mileage_label',''),
    coalesce(payload->>'fuel',''), coalesce(payload->>'transmission',''), coalesce(payload->>'color',''),
    coalesce(payload->>'body_type',''), coalesce(payload->>'collection',''), coalesce(payload->>'horsepower',''),
    coalesce(payload->>'engine',''), coalesce(payload->>'description',''), coalesce(payload->'specifications','{}'),
    coalesce(payload->>'status','available'), coalesce((payload->>'published')::boolean, false), coalesce(previous.version + 1, 1)
  ) on conflict (id) do update set
    brand = excluded.brand, model = excluded.model, year = excluded.year, price = excluded.price,
    mileage = excluded.mileage, mileage_label = excluded.mileage_label, fuel = excluded.fuel,
    transmission = excluded.transmission, color = excluded.color, body_type = excluded.body_type,
    collection = excluded.collection, horsepower = excluded.horsepower, engine = excluded.engine,
    description = excluded.description, specifications = excluded.specifications, status = excluded.status,
    published = excluded.published, version = excluded.version, updated_at = now()
    where public.vehicles.version = previous.version
  returning * into saved;
  if not found then raise exception 'This vehicle changed. Reload before saving.' using errcode = '40001'; end if;
  delete from public.vehicle_images where vehicle_images.vehicle_id = command.vehicle_id;
  insert into public.vehicle_images (id, vehicle_id, storage_path, legacy_path, label, credit, sort_order, is_cover, pending)
    select (item->>'id')::uuid, vehicle_id, item->>'storage_path', item->>'legacy_path',
      coalesce(item->>'label',''), coalesce(item->>'credit',''), (position - 1)::integer,
      coalesce((item->>'is_cover')::boolean, false), coalesce((item->>'pending')::boolean, false)
    from jsonb_array_elements(images) with ordinality as entries(item, position);
  delete from public.storage_cleanup where path in (
    select storage_path from public.vehicle_images where vehicle_images.vehicle_id = command.vehicle_id
  );
  return saved;
end;
$$;

create function public.queue_vehicle_upload(vehicle_id uuid, object_path text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Admin access required' using errcode = '42501'; end if;
  if object_path is null or object_path !~ ('^' || vehicle_id::text || '/[0-9a-f-]{36}\.webp$')
    or not exists (select 1 from public.vehicles where id = vehicle_id)
    or exists (select 1 from public.vehicle_images where storage_path = object_path)
    or exists (select 1 from storage.objects where bucket_id = 'vehicle-images' and name = object_path)
  then raise exception 'Invalid upload reservation'; end if;
  insert into public.storage_cleanup(path, not_before) values (object_path, now() + interval '24 hours')
    on conflict (path) do update set not_before = excluded.not_before;
end;
$$;

create function public.finish_vehicle_cleanup(object_paths text[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare removed integer;
begin
  if not public.is_admin() then raise exception 'Admin access required' using errcode = '42501'; end if;
  delete from public.storage_cleanup where path = any(object_paths)
    and not exists (select 1 from storage.objects where bucket_id = 'vehicle-images' and name = path)
    and not exists (select 1 from public.vehicle_images where storage_path = path);
  get diagnostics removed = row_count;
  return removed;
end;
$$;

create function public.delete_vehicle(vehicle_id uuid, expected_version integer) returns void
language plpgsql security definer set search_path = '' as $$
declare previous public.vehicles;
begin
  if not public.is_admin() then raise exception 'Admin access required' using errcode = '42501'; end if;
  select * into previous from public.vehicles where id = vehicle_id for update;
  if not found or previous.version is distinct from expected_version then
    raise exception 'This vehicle changed or was deleted. Reload the inventory.' using errcode = '40001';
  end if;
  delete from public.vehicles where id = vehicle_id;
end;
$$;

create function public.save_site_content(section_id text, content jsonb, is_published boolean, expected_version integer)
returns public.site_content language plpgsql security definer set search_path = '' as $$
declare previous public.site_content; saved public.site_content;
begin
  if not public.is_admin() then raise exception 'Admin access required' using errcode = '42501'; end if;
  select * into previous from public.site_content where section = section_id for update;
  if not found or previous.version is distinct from expected_version then
    raise exception 'This content changed. Reload before saving.' using errcode = '40001';
  end if;
  update public.site_content set data = content, published = is_published, version = version + 1, updated_at = now()
    where section = section_id returning * into saved;
  return saved;
end;
$$;

revoke all on function public.save_vehicle(jsonb, jsonb, integer) from public;
revoke all on function public.queue_vehicle_upload(uuid, text) from public;
revoke all on function public.finish_vehicle_cleanup(text[]) from public;
revoke all on function public.delete_vehicle(uuid, integer) from public;
revoke all on function public.save_site_content(text, jsonb, boolean, integer) from public;
grant execute on function public.save_vehicle(jsonb, jsonb, integer) to authenticated;
grant execute on function public.queue_vehicle_upload(uuid, text) to authenticated;
grant execute on function public.finish_vehicle_cleanup(text[]) to authenticated;
grant execute on function public.delete_vehicle(uuid, integer) to authenticated;
grant execute on function public.save_site_content(text, jsonb, boolean, integer) to authenticated;

commit;