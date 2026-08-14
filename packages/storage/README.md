# Storage Package Boundary

`server/storage.js` remains the compatibility implementation. New resources already store provider-neutral `storage_provider` and `storage_key` fields.

Production should set `DATA_ROOT` outside the release directory or use S3-compatible storage. Legacy files are not moved during the first migration.
