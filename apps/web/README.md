# Web App Boundary

The existing Vite application remains in `src/` during the incremental migration. New feature modules are created under `src/features`, starting with the resource library.

Move the Vite entry and shared application shell into this directory only after legacy task, note and attachment adapters have stable `/api/v1` coverage. This avoids a risky all-at-once relocation.
