# Personal Intelligent Workspace Architecture

```mermaid
flowchart LR
  Web["React Web"] --> API["Express API /api + /api/v1"]
  Windows["Future Tauri Windows"] --> API
  WeChat["WeChat conversation bridge"] --> API
  API --> Domain["Domain services"]
  Domain --> MySQL[("MySQL source of truth")]
  Domain --> Storage["Local or S3 storage"]
  Domain --> Queue[("Processing jobs")]
  Queue --> Worker["OCR / extraction / summary / indexing"]
  Worker --> MySQL
  Worker --> Qdrant[("Qdrant rebuildable vectors")]
  Agent["Workspace agent"] --> Domain
  Agent --> Cloud["Cloud chat and embedding APIs"]
```

The system remains a modular monolith. `apps`, `packages` and `agents` are ownership boundaries inside one deployable Node.js application, not independently operated microservices.

## Invariants

- MySQL is authoritative; Qdrant is disposable and rebuildable.
- Files live outside database rows and should live outside release directories in production.
- User-created taxonomy is authoritative. AI can only use existing folders and tags.
- Cloud-bound content is redacted and respects per-record AI visibility.
- Agent writes always enter the approval table.
- Existing `/api/*` endpoints remain available during migration.
