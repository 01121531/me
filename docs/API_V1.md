# API v1

The machine-readable entry is `GET /api/v1/openapi.json`.

Main resources:

- `/api/v1/folders`
- `/api/v1/tags`
- `/api/v1/entities/:type/:id/tags`
- `/api/v1/resources`
- `/api/v1/resources/upload`
- `/api/v1/resources/:id/versions`
- `/api/v1/resources/:id/relations`
- `/api/v1/search`

All endpoints use the existing authenticated session middleware. New clients should store and send stable `publicId` identifiers; numeric IDs remain a migration compatibility feature.
