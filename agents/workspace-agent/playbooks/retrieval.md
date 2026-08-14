# Retrieval Playbook

1. Prefer exact identifiers and titles.
2. Use deterministic MySQL queries for status, counts, dates and progress.
3. Use keyword search over notes and `resource_contents` before semantic recall.
4. Add Qdrant hits only when they pass intent-aware source filtering.
5. For task questions, admit only task, log and related-resource sources by default.
6. For note or resource questions, return only strongly matched content.
7. If a source is AI-denied, omit both its text and its existence from model context.
