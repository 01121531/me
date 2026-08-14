async function hasColumn(db, tableName, columnName) {
  const [[row]] = await db.query(
    `SELECT COUNT(*) AS count FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [tableName, columnName],
  );
  return Number(row?.count || 0) > 0;
}

const triggerNames = [
  'trg_task_notes_workspace_insert_note',
  'trg_task_notes_workspace_insert_link',
  'trg_task_notes_workspace_update_unlink',
  'trg_task_notes_workspace_update_note',
  'trg_task_notes_workspace_update_link',
  'trg_task_notes_workspace_delete_relations',
  'trg_task_notes_workspace_delete_note',
];

async function dropTriggers(db) {
  for (const name of triggerNames) await db.query(`DROP TRIGGER IF EXISTS ${name}`);
}

export const legacyNoteDualWriteMigration = {
  version: '2026081403',
  name: 'legacy note transactional dual write',
  async up(db) {
    if (!(await hasColumn(db, 'note_task_links', 'is_primary'))) {
      await db.query('ALTER TABLE note_task_links ADD COLUMN is_primary TINYINT(1) NOT NULL DEFAULT 0 AFTER task_id');
    }
    await db.query(`
      UPDATE note_task_links links
      JOIN task_notes legacy ON legacy.id = links.note_id AND legacy.task_id = links.task_id
      SET links.is_primary = 1
    `);
    await dropTriggers(db);

    await db.query(`
      CREATE TRIGGER trg_task_notes_workspace_insert_note
      AFTER INSERT ON task_notes FOR EACH ROW
      INSERT INTO notes
        (id, public_id, workspace_id, title, content, content_json, sort_order, ai_visibility,
         created_at, updated_at, deleted_at, deleted_reason)
      VALUES
        (NEW.id, UUID(), (SELECT id FROM workspaces WHERE is_default = 1 ORDER BY id LIMIT 1),
         NEW.title, NEW.content, NEW.content_json, NEW.sort_order, COALESCE(NEW.ai_visibility, 'inherit'),
         NEW.created_at, NEW.updated_at, NEW.deleted_at, NEW.deleted_reason)
      ON DUPLICATE KEY UPDATE
        title = NEW.title, content = NEW.content, content_json = NEW.content_json,
        sort_order = NEW.sort_order, ai_visibility = COALESCE(NEW.ai_visibility, 'inherit'),
        updated_at = NEW.updated_at, deleted_at = NEW.deleted_at, deleted_reason = NEW.deleted_reason
    `);
    await db.query(`
      CREATE TRIGGER trg_task_notes_workspace_insert_link
      AFTER INSERT ON task_notes FOR EACH ROW
      INSERT INTO note_task_links (note_id, task_id, is_primary)
      SELECT NEW.id, NEW.task_id, 1 FROM DUAL WHERE NEW.task_id IS NOT NULL
      ON DUPLICATE KEY UPDATE is_primary = 1
    `);
    await db.query(`
      CREATE TRIGGER trg_task_notes_workspace_update_unlink
      BEFORE UPDATE ON task_notes FOR EACH ROW
      DELETE FROM note_task_links
      WHERE note_id = OLD.id AND is_primary = 1 AND NOT (OLD.task_id <=> NEW.task_id)
    `);
    await db.query(`
      CREATE TRIGGER trg_task_notes_workspace_update_note
      AFTER UPDATE ON task_notes FOR EACH ROW
      INSERT INTO notes
        (id, public_id, workspace_id, title, content, content_json, sort_order, ai_visibility,
         created_at, updated_at, deleted_at, deleted_reason)
      VALUES
        (NEW.id, UUID(), (SELECT id FROM workspaces WHERE is_default = 1 ORDER BY id LIMIT 1),
         NEW.title, NEW.content, NEW.content_json, NEW.sort_order, COALESCE(NEW.ai_visibility, 'inherit'),
         NEW.created_at, NEW.updated_at, NEW.deleted_at, NEW.deleted_reason)
      ON DUPLICATE KEY UPDATE
        title = NEW.title, content = NEW.content, content_json = NEW.content_json,
        sort_order = NEW.sort_order, ai_visibility = COALESCE(NEW.ai_visibility, 'inherit'),
        updated_at = NEW.updated_at, deleted_at = NEW.deleted_at, deleted_reason = NEW.deleted_reason
    `);
    await db.query(`
      CREATE TRIGGER trg_task_notes_workspace_update_link
      AFTER UPDATE ON task_notes FOR EACH ROW
      INSERT INTO note_task_links (note_id, task_id, is_primary)
      SELECT NEW.id, NEW.task_id, 1 FROM DUAL WHERE NEW.task_id IS NOT NULL
      ON DUPLICATE KEY UPDATE is_primary = 1
    `);
    await db.query(`
      CREATE TRIGGER trg_task_notes_workspace_delete_relations
      BEFORE DELETE ON task_notes FOR EACH ROW
      DELETE FROM resource_relations WHERE target_type = 'note' AND target_id = OLD.id
    `);
    await db.query(`
      CREATE TRIGGER trg_task_notes_workspace_delete_note
      AFTER DELETE ON task_notes FOR EACH ROW
      DELETE FROM notes WHERE id = OLD.id
    `);
  },
  async down(db) {
    await dropTriggers(db);
    if (await hasColumn(db, 'note_task_links', 'is_primary')) {
      await db.query('ALTER TABLE note_task_links DROP COLUMN is_primary');
    }
  },
};
