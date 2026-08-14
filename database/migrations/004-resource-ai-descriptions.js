async function hasColumn(db, tableName, columnName) {
  const [[row]] = await db.query(
    `SELECT COUNT(*) AS count FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [tableName, columnName],
  );
  return Number(row?.count || 0) > 0;
}

export const resourceAiDescriptionsMigration = {
  version: '2026081404',
  name: 'resource ai descriptions and keywords',
  async up(db) {
    if (!(await hasColumn(db, 'resources', 'description_source'))) {
      await db.query(
        "ALTER TABLE resources ADD COLUMN description_source ENUM('none', 'manual', 'ai') NOT NULL DEFAULT 'none' AFTER description",
      );
    }
    await db.query(
      "UPDATE resources SET description_source = 'manual' WHERE description_source = 'none' AND NULLIF(TRIM(description), '') IS NOT NULL",
    );

    if (!(await hasColumn(db, 'resource_contents', 'auto_description'))) {
      await db.query('ALTER TABLE resource_contents ADD COLUMN auto_description TEXT NULL AFTER summary');
    }
    if (!(await hasColumn(db, 'resource_contents', 'keywords_json'))) {
      await db.query('ALTER TABLE resource_contents ADD COLUMN keywords_json JSON NULL AFTER auto_description');
    }
    if (!(await hasColumn(db, 'resource_contents', 'description_status'))) {
      await db.query(
        "ALTER TABLE resource_contents ADD COLUMN description_status ENUM('pending', 'completed', 'fallback', 'skipped', 'failed') NOT NULL DEFAULT 'pending' AFTER keywords_json",
      );
    }
    if (!(await hasColumn(db, 'resource_contents', 'description_model'))) {
      await db.query('ALTER TABLE resource_contents ADD COLUMN description_model VARCHAR(160) NULL AFTER description_status');
    }
    if (!(await hasColumn(db, 'resource_contents', 'description_error'))) {
      await db.query('ALTER TABLE resource_contents ADD COLUMN description_error TEXT NULL AFTER description_model');
    }
  },
  async down(db) {
    for (const column of ['description_error', 'description_model', 'description_status', 'keywords_json', 'auto_description']) {
      if (await hasColumn(db, 'resource_contents', column)) {
        await db.query(`ALTER TABLE resource_contents DROP COLUMN ${column}`);
      }
    }
    if (await hasColumn(db, 'resources', 'description_source')) {
      await db.query('ALTER TABLE resources DROP COLUMN description_source');
    }
  },
};
