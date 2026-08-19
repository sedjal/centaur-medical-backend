/**
 * Allow MEDECIN / MEDECIN_URGENCE to delete patient documents (dossier).
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  const perm = await knex('permissions').where({ code: 'documents:delete' }).first();
  if (!perm) return;

  const roles = await knex('roles').whereIn('name', ['MEDECIN', 'MEDECIN_URGENCE']).select(['id']);
  const grants = roles.map((r) => ({ role_id: r.id, permission_id: perm.id }));
  if (grants.length) {
    await knex('role_permissions').insert(grants).onConflict(['role_id', 'permission_id']).ignore();
  }
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  const perm = await knex('permissions').where({ code: 'documents:delete' }).first();
  if (!perm) return;

  const roles = await knex('roles').whereIn('name', ['MEDECIN', 'MEDECIN_URGENCE']).select(['id']);
  const ids = roles.map((r) => r.id);
  if (!ids.length) return;

  await knex('role_permissions').where({ permission_id: perm.id }).whereIn('role_id', ids).del();
};
