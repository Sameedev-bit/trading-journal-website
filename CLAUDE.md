# TradeHarbor — project notes for Claude

## Hard rules
- **Never add AI attribution anywhere.** No "Generated with Claude Code" footers, no
  claude.ai session links, no `Co-Authored-By` / `Claude-Session` trailers — not in PR
  titles or bodies, not in commit messages, not in code comments, not in issues. Plain
  descriptive commit messages and PR bodies only.

## Project facts
- Pure static HTML/CSS/JS — no build step, no frameworks, no CDNs. Classic `<script>`
  tags under the global `window.TH` namespace.
- Tests: `node tests/run.js` (runs in CI on every push).
- Deploys: merging to `main` auto-publishes GitHub Pages. Bump `CACHE_VERSION` in
  `sw.js` whenever shipping user-facing changes so installed PWAs refresh.
- Cloud sync is optional and dormant until `js/cloud-config.js` is filled in
  (setup guide: `SETUP-CLOUD.md`). Never commit the Supabase `service_role` key.
