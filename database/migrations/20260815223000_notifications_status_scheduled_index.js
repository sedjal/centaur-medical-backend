/**
 * Composite index for the notification scheduler:
 * WHERE status = 'PENDING' AND scheduled_at <= NOW()
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('notifications');
  if (!hasTable) return;

  const existing = await knex('pg_indexes')
    .where({
      tablename: 'notifications',
      indexname: 'idx_notifications_status_scheduled',
    })
    .first();
  if (existing) return;

  await knex.schema.alterTable('notifications', (t) => {
    t.index(['status', 'scheduled_at'], 'idx_notifications_status_scheduled');
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  const hasTable = await knex.schema.hasTable('notifications');
  if (!hasTable) return;

  const existing = await knex('pg_indexes')
    .where({
      tablename: 'notifications',
      indexname: 'idx_notifications_status_scheduled',
    })
    .first();
  if (!existing) return;

  await knex.schema.alterTable('notifications', (t) => {
    t.dropIndex(['status', 'scheduled_at'], 'idx_notifications_status_scheduled');
  });
};
