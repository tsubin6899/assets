# Supabase sync setup

This dashboard stores personal asset data in Supabase only after a user signs in. GitHub and Vercel do not store the private asset records.

## 1. Create the table

In Supabase, open SQL Editor and run `supabase-schema.sql`.

The table is:

- `asset_dashboard_profiles`

It stores one encrypted-at-rest JSON document per Supabase Auth user. Row Level Security is enabled so each signed-in user can only read and write their own row.

## 2. Enable email login

In Supabase:

- Authentication -> Providers -> Email
- Enable Email provider
- Magic Link login is enough; password login is not required

Add the Vercel site URL to:

- Authentication -> URL Configuration -> Site URL
- Authentication -> URL Configuration -> Redirect URLs

## 3. Add Vercel environment variables

In Vercel project settings, add:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

Use values from Supabase:

- Project Settings -> API -> Project URL
- Project Settings -> API -> anon public key

Redeploy Vercel after adding them.

## 4. Use the dashboard

Open the dashboard and use the top-right cloud controls:

- enter email
- press `登入同步`
- open the email magic link
- press `儲存雲端` or `載入雲端`

The browser still keeps a local copy, so the dashboard remains usable offline.
