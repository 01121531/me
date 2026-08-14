# Incremental Migration Runbook

1. Back up MySQL and the configured storage root.
2. Run `npm run db:migrate` twice; the second run must be a no-op.
3. Run `npm run db:reconcile` to sync and compare old notes and attachments.
4. Run `npm run smoke:workspace` and the existing smoke suite.
5. Deploy the API and Web build without moving legacy files.
6. Set `DATA_ROOT` for new production deployments, or retain `STORAGE_LOCAL_ROOT` for an existing deployment.
7. Rebuild the AI index after reconciliation.
8. Keep old tables writable through adapters until all client paths use `/api/v1`.
9. Run `npm run resources:describe` to backfill missing descriptions. Use `npm run resources:describe -- --all` only to regenerate every automatic description.

Rollback is intentionally guarded. Set `ALLOW_MIGRATION_ROLLBACK=true` and run `node server/scripts/workspace-migrate.js down`. Never use rollback on production after new resource writes without a fresh backup.

Automatic descriptions never replace manual descriptions. OCR or model failures retain a local file metadata description so the resource remains searchable.
