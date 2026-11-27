# Private synthetic review workspace
Exact application-source snapshot of the fictional-data workspace. Original-app integration is in the repository root.
Build: npm ci; node build-worker.mjs; node build-assets.mjs.
Deploy worker.mjs as an ES module with ReviewerStore durable binding REVIEWER and service binding SYNTHETIC_ASSETS. Keep REVIEWER_HASH, REVIEWER_SALT, RUNNER_HASH as provider secrets. Set REVIEWER_PRINCIPAL and REPORT_DIGEST in deployment configuration. Never commit secret values or inbox exports. Generic assets-worker.mjs is deployed separately.
The embedded base-reviewer fixtures contain only synthetic illustrative evidence, not live claim records. No external send route is present. Human review only. R0actualcash.
