# Domain front door (nahalabs.co.za) — ClaimTrace

State since 28 Nov 2026 (approved: his "Replace", 09:35):

- claimtrace.nahalabs.co.za serves the ClaimTrace claims app via the
  `nahalabs-app-proxy` Cloudflare Worker (shieldFrontdoor branch), origin
  https://naha-shield-claims-production.up.railway.app.
- shield.nahalabs.co.za returns 301 to https://claimtrace.nahalabs.co.za
  (path and query preserved), same worker.
- nahashield.nahalabs.co.za still serves the app (unchanged).
- The older ClaimTrace globe project (insurance-god-eye-view) is UNTOUCHED:
  worker `claimtrace-frontdoor` still runs and serves it at
  https://claimtrace-frontdoor.naha-thabiso.workers.dev/
  Only its claimtrace.nahalabs.co.za custom-domain attachment moved to
  nahalabs-app-proxy (workers domain id 89c9c25fd59942fa429d1c4a92ff333ea0e86e4a).
- Railway's free plan does not allow custom domains, and the Cloudflare
  account is at the 100-worker free limit, so the move runs inside the
  existing nahalabs-app-proxy worker.

## One-step restore (roll back the domain move)

1. Re-deploy the previous worker code:
   `docs/ops/nahalabs-app-proxy.worker.js.backup-2026-11-28-pre-claimtrace`
   PUT it as the content of nahalabs-app-proxy (production) from the Cloudflare
   dashboard (Edit code → paste → Deploy) or the workers content API with
   metadata {"main_module":"worker.js","compatibility_date":"2025-01-01"}.
   That removes the claimtrace host from the front door and makes
   shield.nahalabs.co.za serve the app directly again (no redirect).
2. Re-attach the custom domain to the globe worker:
   Cloudflare dashboard → Workers → claimtrace-frontdoor → Domains →
   add custom domain claimtrace.nahalabs.co.za (zone nahalabs.co.za,
   zone id ed5c110f9143c8d81473a773712e5773). This detaches it from
   nahalabs-app-proxy. The globe project then answers at
   claimtrace.nahalabs.co.za again.

No DNS records were created, changed or deleted for this move (custom-domain
attachments manage their own DNS). Do not touch other nahalabs.co.za records.
