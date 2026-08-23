# Setup guide — shared cloud sync (you + your wife, one live inventory)

This connects a free **Supabase** database so both of your phones share the same
inventory. Local data still works offline; changes sync when there's signal.

~15 minutes, one-time. Free at your scale. You'll do it once; she just signs in.

---

## 1. Create a Supabase project (~5 min)

1. Go to **https://supabase.com** → **Start your project** → sign in with GitHub.
2. Click **New project**.
   - **Name:** `flipping-friend`
   - **Database password:** let it generate one and save it somewhere (you won't need it day-to-day).
   - **Region:** pick the one closest to you.
3. Click **Create new project** and wait ~2 minutes while it sets up.

## 2. Create the data table (~2 min)

1. In your project, open **SQL Editor** (left sidebar) → **New query**.
2. Paste this in and click **Run**:

```sql
create table if not exists items (
  id text primary key,
  data jsonb,
  deleted boolean default false,
  updated_at bigint not null
);

alter table items enable row level security;

create policy "household access"
  on items for all
  to authenticated
  using (true)
  with check (true);
```

This creates the shared table and says: only signed-in users can read/write it.

## 3. Lock the door + create ONE shared login (~3 min)

1. Go to **Authentication → Providers → Email** and make sure **Email** is enabled.
2. Go to **Authentication → Sign In / Providers** (or **Settings**) and **turn OFF
   "Allow new users to sign up"** (sometimes labeled *Disable signups*). This means only
   accounts *you* create can ever log in — keeping strangers out.
3. Go to **Authentication → Users → Add user → Create new user**. Create **ONE shared
   household login** (one email + one password) and use it on **every** device.
   Tick **Auto-confirm** so it works immediately.

> One shared login is deliberate: it's the simplest thing that works, halves the ways
> sign-in can go wrong, and is just as safe for a two-person household. (Separate accounts
> also work if you prefer — everything is shared either way.)

## 4. Grab the two connection values (~1 min)

1. Go to **Project Settings → API**.
2. Copy these two:
   - **Project URL** (looks like `https://abcd1234.supabase.co`)
   - **anon public** key (a long `eyJ...` string — the one labeled **anon/public**, NOT `service_role`)

> The anon key is safe to put in the app — it only works for signed-in users because of
> the rule you set in step 2.

## 5. Turn on sync — first device (~2 min)

1. Open Flipping Friend → **Settings → Cloud sync**.
2. Paste the **Project URL** and **anon public key**, tap **Connect**.
3. Sign in with the shared email + password.
4. It uploads what's on that device and pulls everything else. Done.

## 6. Every other device: use the setup link (30 seconds)

No more copy-pasting keys. On the device that's already working:

1. **Settings → Cloud sync → "Copy setup link for another device."**
2. Text/AirDrop/email that link to the other phone or laptop.
3. Open the link there → it connects automatically and pre-fills the email →
   type the password → **Sign in & sync**. That's it.

From then on, edits on any device show up on the others automatically when online
(or next time it gets signal). The chip in the app's header shows the live sync
state — green "Synced" means all good; anything orange/red, tap it.

### If two devices ever show different items
**Settings → Cloud sync → "Repair sync (merge everything)"** — run it on each device.
It re-uploads and re-downloads everything and merges by newest edit. Nothing gets
deleted; a minute later both devices match.

---

### Good to know
- **Offline still works.** Changes you make with no signal are queued and sync when you're back online (or tap **Sync now** in Settings).
- **Two people editing the same item:** the most recent save wins. In practice you'll rarely touch the same item at the same second.
- **Photos** sync too (they're stored compressed). Hundreds of items fit comfortably in the free tier.
- If sign-in fails, double-check you created the user in step 3 and ticked Auto-confirm.
