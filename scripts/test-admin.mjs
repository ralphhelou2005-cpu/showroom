import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { validateSupabaseConfig } from '../js/site-config.js';
import { CARS } from '../js/cars.js';
import { validatePhotoFile } from '../admin/data.js';
import { escapeHtml, safeImageUrl, safeEmail, whatsappNumber, visibleStatistics } from '../js/content-utils.js';
import { toPublicCar, loadPublicSnapshot } from '../js/public-data.js';

const root = new URL('../', import.meta.url);
const database = new PGlite();
const admin = '11111111-1111-4111-8111-111111111111';
const staff = '22222222-2222-4222-8222-222222222222';
let checks = 0;

async function check(name, action) {
  await action();
  checks += 1;
  console.log(`PASS ${name}`);
}

async function asRole(role, user, action) {
  await database.exec(`set role ${role}`);
  await database.query("select set_config('request.jwt.claim.sub', $1, false)", [user ?? '']);
  try { return await action(); }
  finally { await database.exec('reset role'); }
}

try {
  await check('only browser-safe Supabase configuration is accepted', () => {
    assert.equal(validateSupabaseConfig().configured, false);
    assert.equal(validateSupabaseConfig({ url: 'https://example.supabase.co', publishableKey: 'sb_publishable_test' }).configured, true);
    for (const publishableKey of ['sb_secret_rejected', `header.${btoa(JSON.stringify({ role: 'service_role' }))}.signature`]) {
      assert.throws(() => validateSupabaseConfig({ url: 'https://example.supabase.co', publishableKey }));
    }
    assert.throws(() => validateSupabaseConfig({ url: 'http://example.com', publishableKey: 'sb_publishable_test' }));
  });
  await check('remote text, image URLs and upload types are constrained', () => {
    assert.equal(escapeHtml('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    assert.equal(safeImageUrl('javascript:alert(1)', 'https://example.supabase.co'), '');
    assert.equal(safeImageUrl('https://evil.example/image.webp', 'https://example.supabase.co'), '');
    assert.equal(safeImageUrl('assets/photos/../secret.jpg'), '');
    assert.equal(safeImageUrl('assets/photos/bmw-m4-welt.jpg', '', 'https://example.com/showroom/'), 'https://example.com/showroom/assets/photos/bmw-m4-welt.jpg');
    assert.equal(safeEmail('hello@example.com?subject=bad'), '');
    assert.equal(whatsappNumber('javascript:alert(1)'), '');
    assert.throws(() => validatePhotoFile({ type: 'image/svg+xml', size: 100 }));
    assert.throws(() => validatePhotoFile({ type: 'image/jpeg', size: 21 * 1024 * 1024 }));
    validatePhotoFile({ type: 'image/jpeg', size: 100 });
  });
  await check('public adapter preserves identifiers, rejects foreign images and chooses the cover', async () => {
    const car = toPublicCar({ id: 'uuid', legacy_id: 'bmw-m4', model: 'M4', brand: 'BMW', year: 2021, price: '95000.00', mileage: null, mileage_label: 'Delivery mileage', vehicle_images: [
      { label: 'Other', legacy_path: 'assets/photos/m4-g82-rear.jpg', sort_order: 0, is_cover: false },
      { label: 'Cover', legacy_path: 'assets/photos/bmw-m4-welt.jpg', sort_order: 1, is_cover: true },
      { label: 'Unsafe', legacy_path: 'javascript:alert(1)', sort_order: 2, is_cover: false },
    ] }, new Map(), '', 'https://example.com/showroom/');
    assert.equal(car.id, 'bmw-m4'); assert.equal(car.priceLabel, '$95,000');
    assert.equal(car.photographs[0].label, 'Cover'); assert.equal(car.photographs[2].pending, true);
    const client = { from: () => ({ select: () => ({ order: () => ({ range: async () => ({ data: [], error: null }) }) }) }) };
    const snapshot = await loadPublicSnapshot(client, 'https://example.supabase.co', 'https://example.com/showroom/');
    assert.deepEqual(snapshot.cars, []); assert.deepEqual(snapshot.content, {});
  });

  await database.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    grant usage on schema auth to anon, authenticated;
    create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text not null, unique(bucket_id, name));
    alter table storage.objects enable row level security;
    grant usage on schema public, storage to anon, authenticated;
    grant select, insert, update, delete on storage.objects to anon, authenticated;
  `);
  await check('schema migration executes on PostgreSQL', async () => {
    await database.exec(await readFile(new URL('supabase/migrations/202610190001_admin_schema.sql', root), 'utf8'));
    await database.exec(await readFile(new URL('supabase/migrations/202610190002_admin_commands.sql', root), 'utf8'));
  });
  await database.query('insert into auth.users(id) values ($1), ($2)', [admin, staff]);
  await database.query('insert into public.admin_users(user_id) values ($1)', [admin]);
  await check('authentication alone does not grant admin membership', async () => {
    await asRole('authenticated', staff, async () => {
      assert.equal((await database.query('select public.is_admin() as admin')).rows[0].admin, false);
      await assert.rejects(database.query('insert into public.admin_users(user_id) values ($1)', [staff]));
      await assert.rejects(database.query('delete from public.admin_users'));
      await assert.rejects(database.query("insert into public.vehicles(brand,model,year,price) values ('BMW','Private',2025,10)"));
    });
  });
  await check('explicit admin membership is visible only to its owner', async () => {
    await asRole('authenticated', admin, async () => {
      assert.equal((await database.query('select public.is_admin() as admin')).rows[0].admin, true);
      assert.equal((await database.query('select * from public.admin_users')).rows.length, 1);
    });
    await asRole('authenticated', staff, async () => {
      assert.equal((await database.query('select * from public.admin_users')).rows.length, 0);
    });
  });
  const vehicleId = '33333333-3333-4333-8333-333333333333';
  const payload = { id: vehicleId, brand: 'BMW', model: 'Test', year: 2025, price: 95000, published: false };
  const save = (data, images = [], version = null) => database.query(
    'select * from public.save_vehicle($1::jsonb, $2::jsonb, $3)', [JSON.stringify(data), JSON.stringify(images), version],
  );
  await check('commands reject anonymous and authenticated non-admin callers', async () => {
    await asRole('anon', null, () => assert.rejects(save(payload)));
    await asRole('authenticated', staff, async () => {
      await assert.rejects(save(payload), /Admin access required/);
      await assert.rejects(database.query('select public.delete_vehicle($1, 1)', [vehicleId]), /Admin access required/);
      await assert.rejects(database.query("select public.save_site_content('about','{}',true,1)"), /Admin access required/);
    });
  });
  await check('admin can create drafts, publish and mark sold with version protection', async () => {
    await asRole('authenticated', admin, async () => {
      assert.equal((await save(payload)).rows[0].version, 1);
      await assert.rejects(save({ ...payload, published: true }, [], 9), /Reload before saving/);
      assert.equal((await save({ ...payload, published: true }, [], 1)).rows[0].version, 2);
    });
    await asRole('anon', null, async () => assert.equal((await database.query('select * from public.vehicles')).rows.length, 1));
    await asRole('authenticated', admin, () => save({ ...payload, published: true, status: 'sold' }, [], 2));
    await asRole('anon', null, async () => assert.equal((await database.query('select * from public.vehicles')).rows.length, 0));
  });
    await check('seed preserves all six vehicles, real image credits and pending views', async () => {
      const seed = await readFile(new URL('supabase/migrations/202610190003_preserve_inventory.sql', root), 'utf8');
      await database.exec(seed);
      await database.exec(seed);
      for (const original of CARS) {
        const vehicle = (await database.query('select * from public.vehicles where legacy_id=$1', [original.id])).rows[0];
        for (const [column, key] of Object.entries({ brand: 'brand', model: 'name', year: 'year', horsepower: 'horsepower', engine: 'engine', transmission: 'transmission', fuel: 'fuel', mileage_label: 'mileage', body_type: 'type', collection: 'collection' })) {
          assert.equal(vehicle[column], original[key]);
        }
        assert.equal(Number(vehicle.price), original.price);
        const images = (await database.query('select * from public.vehicle_images where vehicle_id=$1 order by sort_order', [vehicle.id])).rows;
        assert.equal(images.length, original.photographs.length);
        images.forEach((image, index) => {
          assert.equal(image.label, original.photographs[index].label);
          assert.equal(image.credit, original.photographs[index].credit ?? '');
          assert.equal(image.legacy_path, original.photographs[index].src ?? null);
          assert.equal(image.pending, original.photographs[index].pending ?? false);
          assert.equal(image.is_cover, index === 0);
        });
      }
      assert.equal((await database.query('select * from public.site_content')).rows.length, 4);
      await asRole('anon', null, async () => assert.equal((await database.query('select * from public.vehicles')).rows.length, 6));
    });
    const objectPath = `${vehicleId}/44444444-4444-4444-8444-444444444444.webp`;
    const image = { id: '55555555-5555-4555-8555-555555555555', storage_path: objectPath, label: 'Front', is_cover: true };
    await check('private storage allows only admin upload and public linked available images', async () => {
      await asRole('anon', null, async () => {
        await assert.rejects(database.query("insert into storage.objects(bucket_id,name) values ('vehicle-images',$1)", [objectPath]));
      });
      await asRole('authenticated', staff, async () => {
        await assert.rejects(database.query("insert into storage.objects(bucket_id,name) values ('vehicle-images',$1)", [objectPath]));
        await assert.rejects(database.query('select public.queue_vehicle_upload($1,$2)', [vehicleId, objectPath]), /Admin access required/);
      });
      await asRole('authenticated', admin, async () => {
        await database.query('select public.queue_vehicle_upload($1,$2)', [vehicleId, objectPath]);
        assert.equal((await database.query('select * from public.storage_cleanup where not_before > now()')).rows.length, 1);
        await database.query("insert into storage.objects(bucket_id,name) values ('vehicle-images',$1)", [objectPath]);
        await assert.rejects(save({ ...payload, published: true }, [{ ...image, is_cover: false }], 3), /exactly one cover/);
        await save({ ...payload, published: true }, [image], 3);
        assert.equal((await database.query('select * from public.storage_cleanup')).rows.length, 0);
      });
      await asRole('anon', null, async () => assert.equal((await database.query('select * from storage.objects')).rows.length, 1));
      await asRole('authenticated', admin, async () => {
        assert.equal((await database.query('delete from storage.objects returning *')).rows.length, 0);
        await save({ ...payload, published: true, status: 'sold' }, [image], 4);
      });
      await asRole('anon', null, async () => assert.equal((await database.query('select * from storage.objects')).rows.length, 0));
    });
    await check('invalid photo metadata rolls back the listing, version and existing photos together', async () => {
      await asRole('authenticated', admin, async () => {
        await assert.rejects(
          save({ ...payload, model: 'Must not be saved', published: true }, [image, { ...image, is_cover: false }], 5),
          /duplicate key|unique constraint/i,
        );
        const vehicle = (await database.query('select * from public.vehicles where id=$1', [vehicleId])).rows[0];
        assert.equal(vehicle.model, payload.model);
        assert.equal(vehicle.status, 'sold');
        assert.equal(vehicle.version, 5);
        const photographs = (await database.query('select * from public.vehicle_images where vehicle_id=$1', [vehicleId])).rows;
        assert.equal(photographs.length, 1);
        assert.equal(photographs[0].id, image.id);
        assert.equal(photographs[0].storage_path, objectPath);
        assert.equal(photographs[0].is_cover, true);
        assert.equal((await database.query('select * from public.storage_cleanup')).rows.length, 0);
      });
    });
    await check('vehicle deletion cascades metadata and makes files eligible for safe cleanup', async () => {
      await asRole('authenticated', admin, async () => {
        await assert.rejects(database.query('select public.delete_vehicle($1, 1)', [vehicleId]), /Reload/);
        await database.query('select public.delete_vehicle($1, 5)', [vehicleId]);
        assert.equal((await database.query('select * from public.storage_cleanup where not_before <= now()')).rows.length, 1);
        assert.equal((await database.query('delete from storage.objects returning *')).rows.length, 1);
        assert.equal((await database.query('select public.finish_vehicle_cleanup($1) as removed', [[objectPath]])).rows[0].removed, 1);
      });
    });
    await check('content has published-only public access, schema constraints and version protection', async () => {
      const about = (await database.query("select * from public.site_content where section='about'")).rows[0];
      await asRole('authenticated', admin, async () => {
        const content = { ...about.data, paragraph1: '<script>not executable</script>' };
        await database.query("select * from public.save_site_content('about',$1,false,1)", [JSON.stringify(content)]);
        await assert.rejects(database.query("select * from public.save_site_content('about',$1,true,1)", [JSON.stringify(content)]), /Reload/);
        await assert.rejects(database.query("select * from public.save_site_content('about',$1,true,2)", [JSON.stringify({ ...content, html: '<script>bad</script>' })]));
        await assert.rejects(database.query("select * from public.save_site_content('about',$1,true,2)", [JSON.stringify({ ...content, values: 'not an array' })]));
        await assert.rejects(database.query("select * from public.save_site_content('about',$1,true,2)", [JSON.stringify({ ...content, values: null })]));
      });
      await asRole('anon', null, async () => {
        assert.equal((await database.query("select * from public.site_content where section='about'")).rows.length, 0);
        await assert.rejects(database.query("update public.site_content set published=true"));
        await assert.rejects(database.query('select public.finish_vehicle_cleanup($1)', [[objectPath]]));
      });
      await asRole('authenticated', staff, async () => {
        assert.equal((await database.query("select * from public.site_content where section='about'")).rows.length, 0);
        await assert.rejects(database.query('select public.finish_vehicle_cleanup($1)', [[objectPath]]), /Admin access required/);
        assert.equal((await database.query("update storage.objects set name='changed.webp' returning *")).rows.length, 0);
      });
    });
    await check('about statistics migration keeps existing content and seeds unpublished placeholder figures', async () => {
      const existing = 'select section, data, published, version from public.site_content where section <> \'stats\' order by section';
      const before = (await database.query(existing)).rows;
      const migration = await readFile(new URL('supabase/migrations/202610200001_about_statistics.sql', root), 'utf8');
      await database.exec(migration);
      await database.exec(migration);
      assert.deepEqual((await database.query(existing)).rows, before);
      assert.equal((await database.query('select bool_and(public.valid_site_content(section, data)) as valid from public.site_content')).rows[0].valid, true);
      const about = before.find((row) => row.section === 'about').data;
      for (const invalid of [{ ...about, html: '<b>' }, { ...about, values: [] }, { items: [{ title: 'x', description: 'y', extra: 1 }] }]) {
        assert.equal((await database.query("select public.valid_site_content($1, $2) as valid", [invalid.items ? 'services' : 'about', JSON.stringify(invalid)])).rows[0].valid, false);
      }
      const stats = (await database.query("select * from public.site_content where section='stats'")).rows[0];
      assert.equal(stats.published, false);
      assert.deepEqual(stats.data.items.map((item) => `${item.value}${item.suffix} ${item.label}`), ['500+ Vehicles sold', '20+ Years experience', '98% Client satisfaction', '50+ Premium brands']);
      await asRole('anon', null, async () => assert.equal((await database.query("select * from public.site_content where section='stats'")).rows.length, 0));
      await assert.rejects(database.query("insert into public.site_content(section, data) values ('other', '{}')"), /violates check constraint/);
    });
    await check('about statistics accept only well-formed figures and become public only when published', async () => {
      const items = (await database.query("select data from public.site_content where section='stats'")).rows[0].data.items;
      const saveStats = (data, published, version) => database.query("select * from public.save_site_content('stats',$1,$2,$3)", [JSON.stringify(data), published, version]);
      await asRole('authenticated', staff, () => assert.rejects(saveStats({ items }, true, 1), /Admin access required/));
      await asRole('authenticated', admin, async () => {
        for (const invalid of [
          { items: [] }, { items, extra: true }, { items: Array.from({ length: 9 }, () => items[0]) },
          { items: [{ ...items[0], suffix: 'x' }] }, { items: [{ ...items[2], value: 101 }] }, { items: [{ ...items[0], value: 2.5 }] },
          { items: [{ ...items[0], value: -1 }] }, { items: [{ ...items[0], value: 1000001 }] }, { items: [{ ...items[0], value: '500' }] },
          { items: [{ ...items[0], label: '' }] }, { items: [{ ...items[0], label: '   ' }] }, { items: [{ ...items[0], label: 'x'.repeat(61) }] },
          { items: [{ ...items[0], order: 100 }] }, { items: [{ ...items[0], enabled: 'yes' }] }, { items: [{ ...items[0], html: '<b>' }] },
          { items: [{ label: 'Missing fields', value: 1 }] },
        ]) await assert.rejects(saveStats(invalid, true, 1), /violates check constraint/);
        const edited = items.map((item) => (item.order === 2 ? { ...item, enabled: false } : item));
        assert.equal((await saveStats({ items: edited }, true, 1)).rows[0].version, 2);
      });
      await asRole('anon', null, async () => {
        const published = (await database.query("select data from public.site_content where section='stats'")).rows[0].data.items;
        assert.deepEqual(visibleStatistics(published).map((stat) => `${stat.value}${stat.suffix} ${stat.label}`), ['500+ Vehicles sold', '98% Client satisfaction', '50+ Premium brands']);
      });
      assert.deepEqual(visibleStatistics([
        { label: 'Over 100', value: 120, suffix: '%', order: 1, enabled: true }, { label: 'Fraction', value: 1.5, suffix: '', order: 2, enabled: true },
        { label: 'Second', value: 2, suffix: '', order: 9, enabled: true }, { label: '<b>First</b>', value: 1, suffix: '+', order: 0, enabled: true },
      ]).map((stat) => stat.label), ['<b>First</b>', 'Second']);
      assert.deepEqual(visibleStatistics('not a list'), []);
    });
  console.log(`\n${checks} admin foundation checks passed. Auth/Storage service tables are local test fixtures, not a live Supabase project.`);
} catch (error) {
  console.error('FAIL', error.message, error.code ?? '', error.detail ?? '', error.hint ?? '');
  process.exitCode = 1;
} finally {
  await database.close();
}