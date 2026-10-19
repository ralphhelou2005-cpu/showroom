# Administration Setup

## Current Status

The database schema, six-vehicle seed, private photo storage, protected admin commands and public-data adapter are implemented locally. All 13 local database foundation checks pass, including rollback of a failed photo save without changing the listing, version or existing photographs.

The hosted database is **not created or connected yet**. The connection fields in [js/site-config.js](../js/site-config.js) are intentionally empty, so the admin page correctly shows an unavailable state. The steps below must be completed in your own Supabase account before a real administrator can sign in. No account, password, secret key or live deployment has been created automatically.

## Separate URLs

The administration area is a separate HTML entry, not a showroom section. There is no Admin link in the public navigation.

| Environment | URL |
| --- | --- |
| Existing PowerShell development server | `http://localhost:8001/admin/` |
| Vite (`npm run dev`) | `http://localhost:5173/admin/` |
| GitHub Pages | `https://YOUR-USERNAME.github.io/showroom/admin/` |
| Build preview (`npm run preview`) | `http://localhost:4173/showroom/admin/` |

If the PowerShell server selects another port, use its printed URL followed by `admin/`. Restart an already-running PowerShell task once after this upgrade to activate directory-index handling. `/admin` redirects to `/admin/`; direct loads and refreshes serve `admin/index.html`. There is no client-side router or 404-page workaround.

## 1. Create The Supabase Project

1. Open the [Supabase dashboard](https://supabase.com/dashboard), sign in to your own account, and create or select an organization.
2. Choose **New project**, use a recognizable name such as `auto-haus-group`, and choose your region and plan. Type the database password directly into Supabase and keep it in your password manager. Do not send the password, a secret/service-role key or an access token through chat.
3. Wait for Supabase to finish provisioning the project, then open its **SQL Editor**.
4. Run the complete contents of these files, one at a time, in this exact order. Each migration already contains its own transaction. Run each migration once; do not select and run only part of a file.

| Order | File | Creates |
| --- | --- | --- |
| 1 | [202610190001_admin_schema.sql](migrations/202610190001_admin_schema.sql) | Tables, constraints, indexes, row-level access rules and private photo bucket |
| 2 | [202610190002_admin_commands.sql](migrations/202610190002_admin_commands.sql) | Protected transactional save/delete/content/upload-cleanup commands |
| 3 | [202610190003_preserve_inventory.sql](migrations/202610190003_preserve_inventory.sql) | All six original vehicles, photo references/credits, pending photo views and four website-content sections |

Alternatively, link the Supabase CLI to the project and run `supabase db push`. Do not use both methods to apply the same initial migrations without first reconciling the CLI migration history.

The result is `vehicles`, `vehicle_images`, `site_content`, `admin_users`, an image-cleanup queue, admin-only commands, row-level policies, and the **private** `vehicle-images` bucket. Do not switch the bucket to public. The seed does not overwrite existing listings or content.

Before connecting the website, confirm that Table Editor shows six seeded vehicles and four content sections, and Storage shows a private `vehicle-images` bucket. `admin_users` being empty at this stage is expected; ordinary signups do not become administrators. If a migration reports an error, stop and keep that error for diagnosis rather than deleting tables or relaxing policies.

Use a current Node.js 24 LTS installation for `npm ci`, `npm run build`, and the development tests. The existing static PowerShell server still does not require Node.js.

## 2. Configure The Browser Connection

In `js/site-config.js`, set `url` to the HTTPS project origin (for example, `https://YOUR-PROJECT.supabase.co`) and `publishableKey` to the project's **publishable** key (`sb_publishable_...`). A legacy **anon** JWT key also works. Both are public browser configuration and do not grant administrator privileges.

Copy these values from the project's connection/API settings directly into the local configuration file, then reload the local admin page. For a hosted static site, rebuild and deploy only after reviewing and approving that configuration change. Creating a project or copying the connection details does not apply the migrations or authorize an administrator by itself.

Never put a secret key, service-role JWT, database password, staff password or access token in this file, HTML, a build variable, a Git commit or chat. The client rejects secret/service-role configuration, but server-side row-level policies remain the authorization boundary.

Configure the same project for both entries. If configuration is absent, the admin page shows an unavailable state; it does not provide a demo login or hardcoded credentials. Standard hosted `*.supabase.co` origins are supported by the admin Content Security Policy. Adjust that policy deliberately if you use a custom Supabase domain.

## 3. Create And Authorize The First Administrator

1. In **Supabase Authentication > URL Configuration**, set the Site URL to `https://YOUR-USERNAME.github.io/showroom/admin/`.
2. Add exact allowed redirect URLs for the hosted admin URL and your local URLs, including the trailing slash. For example: `http://localhost:8001/admin/`, `http://localhost:8002/admin/`, `http://localhost:5173/admin/`, and `http://localhost:4173/showroom/admin/`. Use the exact hostname and port you actually use; `127.0.0.1` is a different origin from `localhost`.
3. Under **Authentication > Users**, create the staff user with a private password, or send an invitation. Configure production SMTP/delivery and confirm the account as appropriate. The dashboard has no public signup flow. Disable public email signups in Supabase if they are not needed.
4. Copy that user's UUID from Supabase. In the trusted **SQL Editor**, run the following, replacing the example UUID with the actual Auth user ID:

```sql
insert into public.admin_users(user_id)
values ('REPLACE-WITH-ACTUAL-AUTH-USER-UUID'::uuid)
on conflict (user_id) do nothing;
```

5. Open the separate admin URL and sign in. Signing in as an ordinary Supabase user does **not** grant access. Membership in `public.admin_users` is required, and browser users, including administrators, cannot modify membership.
6. Invitations and **Forgot password?** return to the admin page and show the password-setting form. Use at least 12 characters; also configure Supabase's password-strength, rate-limit and leaked-password protections as appropriate for your project.

To revoke access, run this through the trusted SQL Editor, then revoke the user's Auth sessions if appropriate:

```sql
delete from public.admin_users
where user_id = 'REPLACE-WITH-ACTUAL-AUTH-USER-UUID'::uuid;
```

The database denies further administrative writes immediately, even with an existing login token. Use **Sign out** on shared machines. Persistent browser sessions are used only on the admin entry; do not share a browser profile with untrusted users. There is no frontend service-role client or automatic administrator enrollment.

## 4. Deployment

Run `npm ci` and `npm run build`. Deploy the **contents of `dist/`** to the existing GitHub Pages `/showroom/` site, retaining the `admin/` directory and all generated assets. This is the same build process with a second HTML entry; do not deploy only the root HTML file. `/showroom/admin/` must resolve as a physical directory index.

The browser Auth client and admin CSS/JS are bundled into the admin entry, not the showroom's initial bundle. Source-mode localhost uses pinned CDN import-map dependencies; production bundles the installed packages. A first deployment/configuration is required. Subsequent database edits do not require Git commits or redeployment.

GitHub Pages does not support custom response security headers. The admin HTML has a restrictive CSP and refuses iframe embedding; for response-level `frame-ancestors`, stricter session isolation or organization-specific security headers, use a header-capable host/proxy for the admin entry. Do not treat an unlisted URL, `robots` directives, client-side checks or CSP as a replacement for RLS.

## 5. Daily Administration

- Overview shows live, sold and unpublished counts and recently updated vehicles.
- Inventory supports search, visibility/status filters, create/edit, sold/available changes and confirmed deletion.
- New vehicles are unpublished by default. Only published, available listings and their linked photos are publicly readable. A sold listing is hidden even if its Published checkbox remains selected.
- Add up to 24 JPEG/PNG/WebP originals, each up to 20 MB. The browser re-encodes them as WebP, at most 1920 pixels on the longest edge and 2 MB each, stripping original metadata. Select a cover, change order, add labels/credits, or remove photographs before saving. SVG and arbitrary HTML uploads are rejected.
- A vehicle and its image metadata are committed together. New uploads first reserve an unpublished vehicle when necessary. A failed upload/save remains visible as an error and can leave an unpublished draft, never an automatically published incomplete listing.
- Removed photo references and deleted vehicles queue private files for cleanup. Use **Overview > Clean unused photos**. Interrupted uploads have a 24-hour grace period before cleanup; the operation never deletes a currently linked file. Cleanup is manual, not an unattended scheduled job.
- Website content edits company paragraphs/values, service entries, contact details/WhatsApp and section headings. These are plain text/structured fields, not executable HTML or JavaScript.
- Concurrent saves use version numbers. If another staff member saves first, reload before applying your changes; the stale save does not overwrite their work.

Private storage uses five-minute signed image URLs. Already issued URLs can remain usable until expiry after a listing is unpublished/sold; RLS prevents issuing new public URLs immediately. Uploaded objects are immutable through the client (no upsert/update permission).

## Verification

`npm run test:admin` executes the migrations on embedded PostgreSQL and runs 13 checks covering anonymous, ordinary authenticated and explicit-admin permissions, storage policies, transactional saves and rollback, sold/draft visibility, conflicts, image constraints and seed preservation. The Auth and Storage service tables are test fixtures; this is not a claim of live Supabase service verification. Verify a real login, upload, recovery email and public update against your configured project before granting staff production access.

### First Live Verification

1. Sign in with the explicitly authorized administrator and confirm the original six listings are present.
2. Create an unpublished test vehicle and upload a real JPEG/PNG/WebP photograph. Save, reload the admin page, and confirm its fields, cover and photo order persist.
3. Confirm that draft is absent from the public inventory. Publish it and refresh the public data; confirm it appears with its photograph. Mark it sold and confirm it disappears again.
4. Edit and save a website-content field, then confirm the public text updates after the next public-data refresh. Keep genuine company details and do not publish placeholder contact information accidentally.
5. Delete the test vehicle and use **Clean unused photos**. Confirm its unused uploaded file is removed while photos linked to other vehicles remain.
6. Verify password recovery using your configured email delivery. Sign out and confirm anonymous visitors and non-admin accounts cannot access administrative data or commands.

These live checks remain pending until the account-owned project and first administrator exist. Do not use a service-role key in the browser to make a failed permission test pass.

No Supabase project, remote administrator account, deployment, commit or push is created automatically by this upgrade.