import crypto from 'node:crypto';

const version = '2026081401';

async function hasColumn(db, tableName, columnName) {
  const [[row]] = await db.query(
    `
      SELECT COUNT(*) AS count
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
    `,
    [tableName, columnName],
  );
  return Number(row?.count || 0) > 0;
}

async function ensureLegacyAiVisibility(db) {
  if (!(await hasColumn(db, 'task_notes', 'ai_visibility'))) {
    await db.query(`
      ALTER TABLE task_notes
      ADD COLUMN ai_visibility ENUM('inherit', 'allow', 'deny') NOT NULL DEFAULT 'inherit'
      AFTER sort_order
    `);
  }
}

async function createTables(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      public_id CHAR(36) NOT NULL,
      name VARCHAR(120) NOT NULL,
      is_default TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_workspaces_public_id (public_id),
      INDEX idx_workspaces_default (is_default)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS folders (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      public_id CHAR(36) NOT NULL,
      workspace_id BIGINT UNSIGNED NOT NULL,
      parent_id BIGINT UNSIGNED NULL,
      name VARCHAR(120) NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      deleted_at TIMESTAMP NULL DEFAULT NULL,
      deleted_reason VARCHAR(255) NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uk_folders_public_id (public_id),
      INDEX idx_folders_workspace_parent (workspace_id, parent_id, sort_order),
      CONSTRAINT fk_folders_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
      CONSTRAINT fk_folders_parent FOREIGN KEY (parent_id) REFERENCES folders(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS tags (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      public_id CHAR(36) NOT NULL,
      workspace_id BIGINT UNSIGNED NOT NULL,
      name VARCHAR(80) NOT NULL,
      normalized_name VARCHAR(80) NOT NULL,
      color VARCHAR(16) NULL,
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      deleted_at TIMESTAMP NULL DEFAULT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uk_tags_public_id (public_id),
      UNIQUE KEY uk_tags_workspace_name (workspace_id, normalized_name),
      INDEX idx_tags_workspace_sort (workspace_id, sort_order, name),
      CONSTRAINT fk_tags_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS notes (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      public_id CHAR(36) NOT NULL,
      workspace_id BIGINT UNSIGNED NOT NULL,
      title VARCHAR(160) NOT NULL DEFAULT '未命名笔记',
      content MEDIUMTEXT NOT NULL,
      content_json JSON NULL,
      sort_order INT NOT NULL DEFAULT 0,
      ai_visibility ENUM('inherit', 'allow', 'deny') NOT NULL DEFAULT 'inherit',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      deleted_at TIMESTAMP NULL DEFAULT NULL,
      deleted_reason VARCHAR(255) NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uk_notes_public_id (public_id),
      INDEX idx_notes_workspace_updated (workspace_id, updated_at),
      FULLTEXT KEY ft_workspace_notes (title, content),
      CONSTRAINT fk_notes_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS note_task_links (
      note_id BIGINT UNSIGNED NOT NULL,
      task_id BIGINT UNSIGNED NOT NULL,
      is_primary TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (note_id, task_id),
      INDEX idx_note_task_links_task (task_id, note_id),
      CONSTRAINT fk_note_task_links_note FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
      CONSTRAINT fk_note_task_links_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS resources (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      public_id CHAR(36) NOT NULL,
      workspace_id BIGINT UNSIGNED NOT NULL,
      folder_id BIGINT UNSIGNED NULL,
      kind ENUM('file', 'link', 'text') NOT NULL DEFAULT 'file',
      title VARCHAR(255) NOT NULL,
      description TEXT NULL,
      status ENUM('draft', 'processing', 'ready', 'failed') NOT NULL DEFAULT 'draft',
      ai_visibility ENUM('inherit', 'allow', 'deny') NOT NULL DEFAULT 'inherit',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      deleted_at TIMESTAMP NULL DEFAULT NULL,
      deleted_reason VARCHAR(255) NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uk_resources_public_id (public_id),
      INDEX idx_resources_workspace_folder (workspace_id, folder_id, updated_at),
      INDEX idx_resources_kind_status (kind, status, updated_at),
      FULLTEXT KEY ft_resources_title_description (title, description),
      CONSTRAINT fk_resources_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
      CONSTRAINT fk_resources_folder FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS resource_versions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      public_id CHAR(36) NOT NULL,
      resource_id BIGINT UNSIGNED NOT NULL,
      version_no INT UNSIGNED NOT NULL,
      original_name VARCHAR(255) NULL,
      stored_name VARCHAR(255) NULL,
      relative_path VARCHAR(700) NULL,
      storage_provider VARCHAR(16) NOT NULL DEFAULT 'local',
      storage_key VARCHAR(700) NULL,
      mime_type VARCHAR(160) NULL,
      file_size BIGINT UNSIGNED NOT NULL DEFAULT 0,
      checksum_sha256 CHAR(64) NULL,
      source_url TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_resource_versions_public_id (public_id),
      UNIQUE KEY uk_resource_versions_number (resource_id, version_no),
      INDEX idx_resource_versions_checksum (checksum_sha256),
      CONSTRAINT fk_resource_versions_resource FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS resource_contents (
      version_id BIGINT UNSIGNED NOT NULL,
      status ENUM('pending', 'processing', 'completed', 'failed', 'unsupported') NOT NULL DEFAULT 'pending',
      parser VARCHAR(80) NULL,
      extracted_text MEDIUMTEXT NULL,
      summary TEXT NULL,
      suggested_tags_json JSON NULL,
      text_chars INT UNSIGNED NOT NULL DEFAULT 0,
      page_count INT UNSIGNED NULL,
      truncated TINYINT(1) NOT NULL DEFAULT 0,
      content_hash CHAR(64) NULL,
      error_message TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (version_id),
      INDEX idx_resource_contents_status (status, updated_at),
      FULLTEXT KEY ft_resource_contents_text (extracted_text),
      CONSTRAINT fk_resource_contents_version FOREIGN KEY (version_id) REFERENCES resource_versions(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS resource_relations (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      resource_id BIGINT UNSIGNED NOT NULL,
      target_type ENUM('task', 'log', 'note') NOT NULL,
      target_id BIGINT UNSIGNED NOT NULL,
      relation_type VARCHAR(32) NOT NULL DEFAULT 'reference',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_resource_relations_target (resource_id, target_type, target_id, relation_type),
      INDEX idx_resource_relations_lookup (target_type, target_id, resource_id),
      CONSTRAINT fk_resource_relations_resource FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  for (const [table, ownerTable, ownerKey] of [
    ['task_tags', 'tasks', 'task_id'],
    ['note_tags', 'notes', 'note_id'],
    ['resource_tags', 'resources', 'resource_id'],
  ]) {
    await db.query(`
      CREATE TABLE IF NOT EXISTS ${table} (
        ${ownerKey} BIGINT UNSIGNED NOT NULL,
        tag_id BIGINT UNSIGNED NOT NULL,
        source VARCHAR(16) NOT NULL DEFAULT 'manual',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (${ownerKey}, tag_id),
        INDEX idx_${table}_tag (tag_id, ${ownerKey}),
        CONSTRAINT fk_${table}_owner FOREIGN KEY (${ownerKey}) REFERENCES ${ownerTable}(id) ON DELETE CASCADE,
        CONSTRAINT fk_${table}_tag FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS legacy_resource_map (
      legacy_kind ENUM('task', 'log', 'note') NOT NULL,
      legacy_id BIGINT UNSIGNED NOT NULL,
      resource_id BIGINT UNSIGNED NOT NULL,
      version_id BIGINT UNSIGNED NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (legacy_kind, legacy_id),
      UNIQUE KEY uk_legacy_resource_version (version_id),
      CONSTRAINT fk_legacy_resource_map_resource FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE,
      CONSTRAINT fk_legacy_resource_map_version FOREIGN KEY (version_id) REFERENCES resource_versions(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS resource_processing_jobs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      resource_id BIGINT UNSIGNED NOT NULL,
      version_id BIGINT UNSIGNED NOT NULL,
      status ENUM('pending', 'processing', 'completed', 'failed') NOT NULL DEFAULT 'pending',
      attempts INT UNSIGNED NOT NULL DEFAULT 0,
      available_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      locked_at TIMESTAMP NULL DEFAULT NULL,
      locked_by VARCHAR(120) NULL,
      last_error TEXT NULL,
      completed_at TIMESTAMP NULL DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_resource_processing_version (version_id),
      INDEX idx_resource_processing_status (status, available_at, id),
      CONSTRAINT fk_resource_processing_resource FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE,
      CONSTRAINT fk_resource_processing_version FOREIGN KEY (version_id) REFERENCES resource_versions(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function seedWorkspaceAndNotes(db) {
  const [[workspace]] = await db.query('SELECT id FROM workspaces WHERE is_default = 1 ORDER BY id LIMIT 1');
  let workspaceId = workspace?.id;
  if (!workspaceId) {
    const [result] = await db.query(
      'INSERT INTO workspaces (public_id, name, is_default) VALUES (?, ?, 1)',
      [crypto.randomUUID(), '个人工作区'],
    );
    workspaceId = result.insertId;
  }

  await db.query(
    `
      INSERT INTO notes
        (id, public_id, workspace_id, title, content, content_json, sort_order, ai_visibility,
         created_at, updated_at, deleted_at, deleted_reason)
      SELECT n.id, UUID(), ?, n.title, n.content, n.content_json, n.sort_order,
             COALESCE(n.ai_visibility, 'inherit'), n.created_at, n.updated_at, n.deleted_at, n.deleted_reason
      FROM task_notes n
      LEFT JOIN notes current_note ON current_note.id = n.id
      WHERE current_note.id IS NULL
    `,
    [workspaceId],
  );
  await db.query(
    `
      UPDATE notes target
      JOIN task_notes source ON source.id = target.id
      SET target.title = source.title,
          target.content = source.content,
          target.content_json = source.content_json,
          target.sort_order = source.sort_order,
          target.ai_visibility = COALESCE(source.ai_visibility, 'inherit'),
          target.updated_at = source.updated_at,
          target.deleted_at = source.deleted_at,
          target.deleted_reason = source.deleted_reason
    `,
  );
  await db.query(
    `
      INSERT INTO note_task_links (note_id, task_id, is_primary)
      SELECT id, task_id, 1 FROM task_notes WHERE task_id IS NOT NULL
      ON DUPLICATE KEY UPDATE is_primary = 1
    `,
  );
}

export const workspaceResourcesMigration = {
  version,
  name: 'personal intelligent workspace resources',
  async up(db) {
    await ensureLegacyAiVisibility(db);
    await createTables(db);
    await seedWorkspaceAndNotes(db);
  },
  async down(db) {
    for (const table of [
      'resource_processing_jobs',
      'legacy_resource_map',
      'resource_tags',
      'note_tags',
      'task_tags',
      'resource_relations',
      'resource_contents',
      'resource_versions',
      'resources',
      'note_task_links',
      'notes',
      'tags',
      'folders',
      'workspaces',
    ]) {
      await db.query(`DROP TABLE IF EXISTS ${table}`);
    }
  },
};
