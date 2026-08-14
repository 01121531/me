# Agent Core

The production implementation currently lives in `server/ai/search.js`, `server/ai/action-planner.js`, `packages/domain/src/redaction.js` and `server/action-requests.js`.

This directory is the stable ownership boundary for the next incremental extraction. Move one behavior at a time and keep the existing API adapters until Web and Windows clients both use `/api/v1`.

Core responsibilities:

- intent and scope routing;
- database context assembly;
- cloud-bound redaction;
- citation validation;
- approval policy enforcement.
