/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  const has = await knex.schema.hasColumn('password_reset_tokens', 'attempts');
  if (!has) {
    await knex.schema.alterTable('password_reset_tokens', (t) => {
      t.integer('attempts').notNullable().defaultTo(0);
    });
  }
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  const has = await knex.schema.hasColumn('password_reset_tokens', 'attempts');
  if (has) {
    await knex.schema.alterTable('password_reset_tokens', (t) => {
      t.dropColumn('attempts');
    });
  }
};
