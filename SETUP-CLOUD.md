# Enabling accounts & cloud sync (≈10 minutes, free)

TradeHarbor ships in **local-only mode** — everything works, data stays in each
visitor's browser. Follow these steps once to turn on sign-in and cross-device
sync. No servers to run; the free Supabase tier covers it.

## 1. Create the Supabase project
1. Go to https://supabase.com → **Start your project** → sign up (GitHub login works).
2. **New project** → name it `tradeharbor` → pick a strong database password
   (you won't need it day-to-day) → choose a region near your users → **Create**.

## 2. Create the table & security rules
1. In the project, open **SQL Editor** → **New query**.
2. Paste the entire contents of [`supabase/schema.sql`](supabase/schema.sql) → **Run**.
   You should see "Success". This creates one table plus row-level-security
   policies so each user can only ever touch their own rows.

## 3. Allow sign-in redirects to your site
1. **Authentication → URL Configuration**.
2. Set **Site URL** to your deployed site, e.g.
   `https://sameedev-bit.github.io/trading-journal-website/`
3. Add to **Redirect URLs**:
   `https://sameedev-bit.github.io/trading-journal-website/app/account.html`

## 4. Paste the two public keys into the app
1. **Project Settings → API**. Copy **Project URL** and the **anon / public** key.
   (Both are safe to publish — security comes from the RLS policies, not secrecy.
   Never copy the `service_role` key anywhere.)
2. Edit [`js/cloud-config.js`](js/cloud-config.js):
   ```js
   window.TH_CLOUD = {
     url: 'https://YOURPROJECT.supabase.co',
     anonKey: 'eyJ...'
   };
   ```
3. Commit & push — GitHub Pages redeploys automatically. The **Account & Sync**
   page now shows the sign-in form, and email magic links work immediately.

## 5. (Optional, later) Google sign-in
1. Supabase: **Authentication → Providers → Google** — it shows you the exact
   redirect URL to register.
2. Google Cloud console → create OAuth credentials (type: Web application),
   paste Supabase's callback URL, then copy the client ID/secret back into the
   Supabase Google provider form and enable it.
   Until then, the "Continue with Google" button will show a friendly error.

## Notes
- Free-tier limits (500 MB database, 50k monthly active users) are far beyond
  early needs. Screenshots count against storage; the app already downsizes them.
- Users can delete their cloud copy anytime from Account & Sync; full account
  deletion (the email record) is done in Supabase **Authentication → Users**.
- `sw.js` has a `CACHE_VERSION` constant — bump it when you ship changes so
  installed PWA clients fetch the new files promptly.
