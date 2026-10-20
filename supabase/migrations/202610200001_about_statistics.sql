-- About Us statistics: adds an optional "stats" website-content section.
-- Non-destructive. No rows, tables, policies or grants are removed. The section check is widened to accept
-- 'stats', the content validator gains a 'stats' branch (the other sections validate exactly as before), and the
-- placeholder figures are seeded UNPUBLISHED, so nothing appears publicly until an administrator confirms and
-- publishes them. Run once, after migrations 1-3. It runs in one transaction and changes nothing if any step fails.
begin;

alter table public.site_content drop constraint site_content_section_check;
alter table public.site_content add constraint site_content_section_check
  check (section in ('about','services','contact','copy','stats'));

create or replace function public.valid_site_content(section text, value jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare item jsonb; allowed text[]; field record;
begin
  if jsonb_typeof(value) <> 'object' then return false; end if;
  if section = 'stats' then
    if (select count(*) from jsonb_object_keys(value)) <> 1 or jsonb_typeof(value->'items') is distinct from 'array' then return false; end if;
    if jsonb_array_length(value->'items') not between 1 and 8 then return false; end if;
    for item in select * from jsonb_array_elements(value->'items') loop
      if jsonb_typeof(item) <> 'object' then return false; end if;
      if (select count(*) from jsonb_object_keys(item)) <> 5
        or jsonb_typeof(item->'label') is distinct from 'string'
        or jsonb_typeof(item->'value') is distinct from 'number'
        or jsonb_typeof(item->'suffix') is distinct from 'string'
        or jsonb_typeof(item->'order') is distinct from 'number'
        or jsonb_typeof(item->'enabled') is distinct from 'boolean' then return false; end if;
      if length(item->>'label') not between 1 and 60 or btrim(item->>'label') = ''
        or (item->>'value')::numeric not between 0 and 1000000 or (item->>'value')::numeric % 1 <> 0
        or (item->>'order')::numeric not between 0 and 99 or (item->>'order')::numeric % 1 <> 0
        or item->>'suffix' not in ('', '+', '%')
        or (item->>'suffix' = '%' and (item->>'value')::numeric > 100) then return false; end if;
    end loop;
    return true;
  end if;
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

-- Placeholder figures, pending the owner's confirmation. Unpublished: invisible to the public site.
insert into public.site_content (section, data, published) values
('stats','{"items":[{"label":"Vehicles sold","value":500,"suffix":"+","order":1,"enabled":true},{"label":"Years experience","value":20,"suffix":"+","order":2,"enabled":true},{"label":"Client satisfaction","value":98,"suffix":"%","order":3,"enabled":true},{"label":"Premium brands","value":50,"suffix":"+","order":4,"enabled":true}]}',false)
on conflict do nothing;

commit;
