/**
 * ACCESS JWT session version — bump to revoke outstanding sessions.
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  const has = await knex.schema.hasColumn('users', 'session_version');
  if (!has) {
    await knex.schema.alterTable('users', (t) => {
      t.integer('session_version').notNullable().defaultTo(1);
    });
  }
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  const has = await knex.schema.hasColumn('users', 'session_version');
  if (has) {
    await knex.schema.alterTable('users', (t) => {
      t.dropColumn('session_version');
    });
  }
};
