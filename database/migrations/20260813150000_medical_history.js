/**
 * Medical history (append-only) + medical_history:read permission.
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('medical_history'))) {
    await knex.schema.createTable('medical_history', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('patient_id')
        .notNullable()
        .references('id')
        .inTable('patients')
        .onDelete('CASCADE');
      t.string('event_type', 40).notNullable();
      t.timestamp('occurred_at', { useTz: true }).notNullable();
      t.specificType('service', 'service_type').notNullable();
      t.uuid('doctor_id').references('id').inTable('users').onDelete('SET NULL');
      t.string('summary', 255).notNullable();
      t.jsonb('metadata').nullable();
      t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      t.uuid('created_by').references('id').inTable('users').onDelete('SET NULL');
      t.index(['patient_id']);
      t.index(['occurred_at']);
      t.index(['service']);
      t.index(['event_type']);
      t.index(['patient_id', 'occurred_at']);
    });
  }

  const existing = await knex('permissions').where({ code: 'medical_history:read' }).first();
  if (!existing) {
    const [perm] = await knex('permissions')
      .insert({ code: 'medical_history:read', description: 'Read medical history' })
      .returning(['id', 'code']);
    const roles = await knex('roles').select(['id', 'name']);
    const grants = roles
      .filter((r) =>
        ['ADMIN', 'DIRECTION', 'MEDECIN', 'SECRETAIRE', 'MEDECIN_URGENCE'].includes(r.name)
      )
      .map((r) => ({ role_id: r.id, permission_id: perm.id }));
    if (grants.length) {
      await knex('role_permissions').insert(grants).onConflict(['role_id', 'permission_id']).ignore();
    }
  }
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('medical_history');
  const perm = await knex('permissions').where({ code: 'medical_history:read' }).first();
  if (perm) {
    await knex('role_permissions').where({ permission_id: perm.id }).del();
    await knex('permissions').where({ id: perm.id }).del();
  }
};
