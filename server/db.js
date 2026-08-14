import mysql from 'mysql2/promise';
import { config } from './config.js';
import { runVersionedMigrations } from '../packages/database/src/migrations.js';

let pool;

const createDatabaseSql = (database) =>
  `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`;

export async function ensureDatabase() {
  const bootstrap = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    multipleStatements: false,
  });

  await bootstrap.query(createDatabaseSql(config.db.database));
  await bootstrap.end();

  pool = mysql.createPool({
    ...config.db,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    dateStrings: true,
  });
  pool.on('connection', (connection) => {
    connection.query("SET time_zone = '+08:00'");
  });
  await pool.query("SET time_zone = '+08:00'");

  await migrate(pool);
  return pool;
}

export function getPool() {
  if (!pool) {
    throw new Error('Database has not been initialized.');
  }
  return pool;
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

async function migrate(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      title VARCHAR(160) NOT NULL,
      description TEXT NULL,
      priority ENUM('low', 'medium', 'high') NOT NULL DEFAULT 'medium',
      due_date DATE NULL,
      progress TINYINT UNSIGNED NOT NULL DEFAULT 0,
      status ENUM('todo', 'in_progress', 'done') NOT NULL DEFAULT 'todo',
      tags VARCHAR(255) NULL,
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_tasks_status_sort (status, sort_order),
      INDEX idx_tasks_due_date (due_date),
      INDEX idx_tasks_priority (priority)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS work_logs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      task_id BIGINT UNSIGNED NOT NULL,
      stage ENUM('todo', 'in_progress', 'done') NOT NULL DEFAULT 'in_progress',
      log_date DATE NOT NULL,
      content TEXT NOT NULL,
      hours DECIMAL(5,2) NOT NULL DEFAULT 0,
      progress_snapshot TINYINT UNSIGNED NOT NULL DEFAULT 0,
      next_step TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_logs_task_date (task_id, log_date),
      INDEX idx_logs_date (log_date),
      CONSTRAINT fk_logs_task
        FOREIGN KEY (task_id) REFERENCES tasks(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  if (!(await hasColumn(db, 'work_logs', 'stage'))) {
    await db.query(`
      ALTER TABLE work_logs
      ADD COLUMN stage ENUM('todo', 'in_progress', 'done') NOT NULL DEFAULT 'in_progress'
      AFTER task_id
    `);
  }
  if (!(await hasColumn(db, 'work_logs', 'deleted_at'))) {
    await db.query('ALTER TABLE work_logs ADD COLUMN deleted_at TIMESTAMP NULL DEFAULT NULL AFTER created_at');
  }
  if (!(await hasColumn(db, 'work_logs', 'deleted_reason'))) {
    await db.query('ALTER TABLE work_logs ADD COLUMN deleted_reason VARCHAR(255) NULL AFTER deleted_at');
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS log_attachments (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      log_id BIGINT UNSIGNED NOT NULL,
      original_name VARCHAR(255) NOT NULL,
      stored_name VARCHAR(255) NOT NULL,
      relative_path VARCHAR(500) NOT NULL,
      mime_type VARCHAR(120) NOT NULL,
      file_size BIGINT UNSIGNED NOT NULL DEFAULT 0,
      note VARCHAR(255) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_attachments_log (log_id),
      CONSTRAINT fk_attachments_log
        FOREIGN KEY (log_id) REFERENCES work_logs(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS task_notes (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      task_id BIGINT UNSIGNED NULL,
      title VARCHAR(160) NOT NULL DEFAULT '未命名笔记',
      attachment_id BIGINT UNSIGNED NULL,
      category VARCHAR(60) NULL DEFAULT NULL,
      content TEXT NOT NULL,
      content_json JSON NULL,
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_notes_task_updated (task_id, updated_at),
      INDEX idx_notes_category (category),
      INDEX idx_notes_attachment (attachment_id),
      FULLTEXT INDEX ft_notes_content (content),
      CONSTRAINT fk_notes_task
        FOREIGN KEY (task_id) REFERENCES tasks(id)
        ON DELETE CASCADE,
      CONSTRAINT fk_notes_attachment
        FOREIGN KEY (attachment_id) REFERENCES log_attachments(id)
        ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  if (!(await columnIsNullable(db, 'task_notes', 'task_id'))) {
    await db.query('ALTER TABLE task_notes MODIFY COLUMN task_id BIGINT UNSIGNED NULL');
  }
  if (!(await hasColumn(db, 'task_notes', 'title'))) {
    await db.query('ALTER TABLE task_notes ADD COLUMN title VARCHAR(160) NULL AFTER task_id');
    await db.query(`
      UPDATE task_notes
      SET title = LEFT(
        COALESCE(NULLIF(TRIM(REPLACE(REPLACE(content, '\r', ' '), '\n', ' ')), ''), '未命名笔记'),
        80
      )
      WHERE title IS NULL OR title = ''
    `);
    await db.query("ALTER TABLE task_notes MODIFY COLUMN title VARCHAR(160) NOT NULL DEFAULT '未命名笔记'");
  }
  if (!(await hasColumn(db, 'task_notes', 'sort_order'))) {
    await db.query('ALTER TABLE task_notes ADD COLUMN sort_order INT NOT NULL DEFAULT 0');
  }
  if (!(await hasColumn(db, 'task_notes', 'content_json'))) {
    await db.query('ALTER TABLE task_notes ADD COLUMN content_json JSON NULL AFTER content');
  }
  if (!(await hasColumn(db, 'task_notes', 'deleted_at'))) {
    await db.query('ALTER TABLE task_notes ADD COLUMN deleted_at TIMESTAMP NULL DEFAULT NULL AFTER updated_at');
  }
  if (!(await hasColumn(db, 'task_notes', 'deleted_reason'))) {
    await db.query('ALTER TABLE task_notes ADD COLUMN deleted_reason VARCHAR(255) NULL AFTER deleted_at');
  }
  await db.query('ALTER TABLE task_notes MODIFY COLUMN category VARCHAR(60) NULL DEFAULT NULL');

  await db.query(`
    CREATE TABLE IF NOT EXISTS note_attachments (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      note_id BIGINT UNSIGNED NOT NULL,
      original_name VARCHAR(255) NOT NULL,
      stored_name VARCHAR(255) NOT NULL,
      relative_path VARCHAR(500) NOT NULL,
      mime_type VARCHAR(120) NOT NULL,
      file_size BIGINT UNSIGNED NOT NULL DEFAULT 0,
      note VARCHAR(255) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_note_attachments_note (note_id),
      CONSTRAINT fk_note_attachments_note
        FOREIGN KEY (note_id) REFERENCES task_notes(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS note_versions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      note_id BIGINT UNSIGNED NOT NULL,
      source VARCHAR(32) NOT NULL DEFAULT 'manual',
      change_note VARCHAR(255) NULL,
      before_snapshot JSON NOT NULL,
      after_snapshot JSON NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_note_versions_note_created (note_id, created_at),
      CONSTRAINT fk_note_versions_note
        FOREIGN KEY (note_id) REFERENCES task_notes(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS log_versions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      log_id BIGINT UNSIGNED NOT NULL,
      source VARCHAR(32) NOT NULL DEFAULT 'manual',
      change_note VARCHAR(255) NULL,
      before_snapshot JSON NOT NULL,
      after_snapshot JSON NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_log_versions_log_created (log_id, created_at),
      CONSTRAINT fk_log_versions_log
        FOREIGN KEY (log_id) REFERENCES work_logs(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS task_attachments (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      task_id BIGINT UNSIGNED NOT NULL,
      original_name VARCHAR(255) NOT NULL,
      stored_name VARCHAR(255) NOT NULL,
      relative_path VARCHAR(500) NOT NULL,
      mime_type VARCHAR(120) NOT NULL,
      file_size BIGINT UNSIGNED NOT NULL DEFAULT 0,
      note VARCHAR(255) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_task_attachments_task (task_id),
      CONSTRAINT fk_task_attachments_task
        FOREIGN KEY (task_id) REFERENCES tasks(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  for (const tableName of ['log_attachments', 'note_attachments', 'task_attachments']) {
    if (!(await hasColumn(db, tableName, 'storage_provider'))) {
      await db.query(`ALTER TABLE ${tableName} ADD COLUMN storage_provider VARCHAR(16) NOT NULL DEFAULT 'local' AFTER relative_path`);
    }
    if (!(await hasColumn(db, tableName, 'storage_key'))) {
      await db.query(`ALTER TABLE ${tableName} ADD COLUMN storage_key VARCHAR(500) NULL AFTER storage_provider`);
      await db.query(`
        UPDATE ${tableName}
        SET storage_key = SUBSTRING(relative_path, 9)
        WHERE relative_path LIKE 'uploads/%'
      `);
    }
    if (!(await hasColumn(db, tableName, 'deleted_at'))) {
      await db.query(`ALTER TABLE ${tableName} ADD COLUMN deleted_at TIMESTAMP NULL DEFAULT NULL AFTER updated_at`);
    }
    if (!(await hasColumn(db, tableName, 'deleted_reason'))) {
      await db.query(`ALTER TABLE ${tableName} ADD COLUMN deleted_reason VARCHAR(255) NULL AFTER deleted_at`);
    }
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS attachment_text_cache (
      attachment_kind ENUM('log', 'note', 'task') NOT NULL,
      attachment_id BIGINT UNSIGNED NOT NULL,
      status ENUM('pending', 'processing', 'completed', 'failed', 'unsupported') NOT NULL DEFAULT 'pending',
      parser VARCHAR(40) NULL,
      text MEDIUMTEXT NULL,
      text_chars INT UNSIGNED NOT NULL DEFAULT 0,
      page_count INT UNSIGNED NULL,
      truncated TINYINT(1) NOT NULL DEFAULT 0,
      content_hash CHAR(64) NULL,
      error_message TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (attachment_kind, attachment_id),
      INDEX idx_attachment_text_status (status, updated_at),
      FULLTEXT INDEX ft_attachment_text (text)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS audit_events (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      request_id VARCHAR(80) NOT NULL,
      actor_type VARCHAR(32) NOT NULL DEFAULT 'local',
      actor_id VARCHAR(191) NULL,
      action VARCHAR(255) NOT NULL,
      target_type VARCHAR(64) NULL,
      target_id VARCHAR(80) NULL,
      request_payload JSON NULL,
      result_status SMALLINT UNSIGNED NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_audit_created (created_at),
      INDEX idx_audit_actor_created (actor_id, created_at),
      INDEX idx_audit_target (target_type, target_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS ai_index_jobs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      entity_type VARCHAR(32) NOT NULL,
      entity_id VARCHAR(80) NOT NULL,
      operation ENUM('upsert', 'delete') NOT NULL,
      reason VARCHAR(255) NULL,
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
      INDEX idx_ai_jobs_status_available (status, available_at, id),
      INDEX idx_ai_jobs_entity (entity_type, entity_id, status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS ai_index_state (
      entity_type VARCHAR(32) NOT NULL,
      entity_id VARCHAR(80) NOT NULL,
      root_task_id BIGINT UNSIGNED NULL,
      content_hash CHAR(64) NOT NULL,
      index_version VARCHAR(32) NOT NULL,
      metadata JSON NULL,
      indexed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (entity_type, entity_id),
      INDEX idx_ai_state_task (root_task_id),
      INDEX idx_ai_state_indexed (indexed_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS mcp_action_requests (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      source VARCHAR(64) NOT NULL DEFAULT 'mcp',
      tool_name VARCHAR(80) NOT NULL,
      action_type ENUM('create_task', 'update_task', 'create_log', 'update_log', 'create_note', 'update_note') NOT NULL,
      target_type VARCHAR(64) NULL,
      target_id BIGINT UNSIGNED NULL,
      title VARCHAR(160) NULL,
      payload JSON NOT NULL,
      status ENUM('pending', 'applied', 'rejected', 'failed') NOT NULL DEFAULT 'pending',
      result_json JSON NULL,
      error_message TEXT NULL,
      requested_by VARCHAR(191) NULL,
      decided_by VARCHAR(191) NULL,
      decided_at TIMESTAMP NULL DEFAULT NULL,
      applied_at TIMESTAMP NULL DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_mcp_actions_status_created (status, created_at),
      INDEX idx_mcp_actions_target (target_type, target_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS ai_conversations (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      scope ENUM('workspace', 'task') NOT NULL DEFAULT 'workspace',
      task_id BIGINT UNSIGNED NULL,
      title VARCHAR(160) NOT NULL DEFAULT '新对话',
      preview TEXT NULL,
      local_key VARCHAR(80) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_ai_conversations_scope_updated (scope, task_id, updated_at),
      INDEX idx_ai_conversations_local_key (local_key),
      CONSTRAINT fk_ai_conversations_task
        FOREIGN KEY (task_id) REFERENCES tasks(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS ai_messages (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      conversation_id BIGINT UNSIGNED NOT NULL,
      role ENUM('user', 'assistant') NOT NULL,
      content MEDIUMTEXT NOT NULL,
      sources_json JSON NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_ai_messages_conversation_created (conversation_id, created_at),
      CONSTRAINT fk_ai_messages_conversation
        FOREIGN KEY (conversation_id) REFERENCES ai_conversations(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS weixin_temp_media (
      id CHAR(36) NOT NULL,
      account_id VARCHAR(191) NOT NULL,
      peer_id VARCHAR(191) NOT NULL,
      original_name VARCHAR(255) NOT NULL,
      stored_path VARCHAR(700) NOT NULL,
      mime_type VARCHAR(120) NOT NULL DEFAULT 'application/octet-stream',
      file_size BIGINT UNSIGNED NOT NULL DEFAULT 0,
      extracted_text MEDIUMTEXT NULL,
      status ENUM('temporary', 'saved', 'expired') NOT NULL DEFAULT 'temporary',
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_weixin_temp_peer_created (account_id, peer_id, created_at),
      INDEX idx_weixin_temp_expiry (status, expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await db.query("UPDATE tasks SET progress = 0 WHERE status = 'todo' AND progress <> 0");
  await db.query("UPDATE tasks SET progress = 100 WHERE status = 'done' AND progress <> 100");

  if (!(await hasColumn(db, 'tasks', 'deleted_at'))) {
    await db.query('ALTER TABLE tasks ADD COLUMN deleted_at TIMESTAMP NULL DEFAULT NULL AFTER updated_at');
  }
  if (!(await hasColumn(db, 'tasks', 'deleted_reason'))) {
    await db.query('ALTER TABLE tasks ADD COLUMN deleted_reason VARCHAR(255) NULL AFTER deleted_at');
  }

  await runVersionedMigrations(db);
}

async function hasColumn(db, tableName, columnName) {
  const [rows] = await db.query(
    `
      SELECT COUNT(*) AS count
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?
    `,
    [tableName, columnName],
  );
  return Number(rows[0]?.count || 0) > 0;
}

async function columnIsNullable(db, tableName, columnName) {
  const [rows] = await db.query(
    `
      SELECT IS_NULLABLE AS is_nullable
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?
      LIMIT 1
    `,
    [tableName, columnName],
  );
  return rows[0]?.is_nullable === 'YES';
}
