# Write Approval Playbook

- Parse an explicit instruction into a minimal action payload.
- Resolve referenced task, note, resource, folder and tag IDs against MySQL.
- If a folder or tag does not exist, ask the user to create it in the UI.
- Show the exact fields that will change.
- Store the request in `mcp_action_requests` with source `ai_chat`.
- Apply only after approval and publish a workspace change event.
- Never provide a delete action through the agent.
