export const resourceActionsMigration = {
  version: '2026081402',
  name: 'resource action approvals',
  async up(db) {
    await db.query(`
      ALTER TABLE mcp_action_requests
      MODIFY COLUMN action_type ENUM(
        'create_task',
        'update_task',
        'create_log',
        'update_log',
        'create_note',
        'update_note',
        'attach_weixin_media_to_task',
        'attach_weixin_media_to_note',
        'create_note_with_weixin_media',
        'create_resource',
        'update_resource'
      ) NOT NULL
    `);
  },
  async down(db) {
    const [[resourceActions]] = await db.query(`
      SELECT COUNT(*) AS count
      FROM mcp_action_requests
      WHERE action_type IN ('create_resource', 'update_resource')
    `);
    if (Number(resourceActions?.count || 0) > 0) {
      throw new Error('仍有资料操作审批记录，不能回滚资料动作枚举。');
    }
    await db.query(`
      ALTER TABLE mcp_action_requests
      MODIFY COLUMN action_type ENUM(
        'create_task',
        'update_task',
        'create_log',
        'update_log',
        'create_note',
        'update_note',
        'attach_weixin_media_to_task',
        'attach_weixin_media_to_note',
        'create_note_with_weixin_media'
      ) NOT NULL
    `);
  },
};
