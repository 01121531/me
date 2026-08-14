# Workspace Data Model

## Core

- `workspaces`: single personal workspace today, future-compatible ownership boundary.
- `folders`: adjacency-list directory tree with cycle checks in the domain service.
- `tags`: user-created shared tags.
- `notes`: unified note records; `note_task_links` supports zero or many task links.

## Resources

- `resources`: logical file, link or text item with folder, AI visibility and processing state. `description_source` protects manual descriptions from automatic replacement.
- `resource_versions`: immutable versions, checksums, storage keys and source URLs.
- `resource_contents`: extracted text, parser result, summary, automatic description, search keywords, generation status/model and processing errors.
- `resource_relations`: polymorphic task, log and note links.
- `legacy_resource_map`: one-to-one map from every old attachment row to its migrated resource version.

## Tags

- `task_tags`, `note_tags`, `resource_tags`: shared taxonomy relations.
- `source = legacy` identifies values mirrored from old text category fields.
- Deleting a tag removes relations only; it never deletes the tagged entity.

## Identifiers

New APIs accept stable UUID `publicId` values. Numeric IDs remain accepted by compatibility paths and internal database relations.
