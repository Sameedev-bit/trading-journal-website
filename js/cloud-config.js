/* TradeHarbor cloud configuration.
   Leave blank to run in local-only mode (everything stays in this browser).
   To enable accounts + cross-device sync, create a free Supabase project
   (see SETUP-CLOUD.md) and paste its values here. Both values are PUBLIC —
   the anon key is designed to ship in frontend code; row-level security
   in supabase/schema.sql is what protects each user's data. */
window.TH_CLOUD = {
  url: '',      // e.g. 'https://abcdefgh.supabase.co'
  anonKey: ''   // the long 'anon / public' key from Project Settings → API
};
