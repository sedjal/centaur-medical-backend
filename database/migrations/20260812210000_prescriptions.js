/**
 * Prescriptions + prescription_items + RBAC permissions.
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('prescriptions'))) {
    await knex.schema.createTable('prescriptions', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('patient_id')
        .notNullable()
        .references('id')
        .inTable('patients')
        .onDelete('RESTRICT');
      t.uuid('doctor_id').references('id').inTable('users').onDelete('SET NULL');
      t.timestamp('prescribed_at', { useTz: true }).notNullable();
      t.string('status', 20).notNullable().defaultTo('ACTIVE');
      t.text('notes').nullable();
      t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
      t.index(['patient_id']);
      t.index(['doctor_id']);
      t.index(['status']);
      t.index(['prescribed_at']);
    });
  }

  if (!(await knex.schema.hasTable('prescription_items'))) {
    await knex.schema.createTable('prescription_items', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('prescription_id')
        .notNullable()
        .references('id')
        .inTable('prescriptions')
        .onDelete('CASCADE');
      t.string('medication_name', 255).notNullable();
      t.string('dosage', 120).notNullable();
      t.string('frequency', 120).notNullable();
      t.string('duration', 120).notNullable();
      t.text('instructions').nullable();
      t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      t.index(['prescription_id']);
    });
  }

  const permRows = [
    { code: 'prescriptions:read', description: 'Read prescriptions' },
    { code: 'prescriptions:create', description: 'Create prescriptions' },
    { code: 'prescriptions:cancel', description: 'Cancel prescriptions' },
  ];

  const existingCodes = new Set(
    (await knex('permissions').whereIn('code', permRows.map((p) => p.code)).select('code')).map(
      (p) => p.code,
    ),
  );
  const missing = permRows.filter((p) => !existingCodes.has(p.code));
  if (missing.length) {
    await knex('permissions').insert(missing);
  }
  const inserted = await knex('permissions')
    .whereIn(
      'code',
      permRows.map((p) => p.code),
    )
    .select(['id', 'code']);
  const permIdByCode = Object.fromEntries(inserted.map((p) => [p.code, p.id]));

  const roles = await knex('roles').select(['id', 'name']);
  const roleIdByName = Object.fromEntries(roles.map((r) => [r.name, r.id]));

  const grants = [];
  const allRx = ['prescriptions:read', 'prescriptions:create', 'prescriptions:cancel'];

  for (const code of allRx) {
    if (roleIdByName.ADMIN) {
      grants.push({ role_id: roleIdByName.ADMIN, permission_id: permIdByCode[code] });
    }
    if (roleIdByName.MEDECIN) {
      grants.push({ role_id: roleIdByName.MEDECIN, permission_id: permIdByCode[code] });
    }
    if (roleIdByName.MEDECIN_URGENCE) {
      grants.push({ role_id: roleIdByName.MEDECIN_URGENCE, permission_id: permIdByCode[code] });
    }
  }

  if (roleIdByName.DIRECTION && permIdByCode['prescriptions:read']) {
    grants.push({
      role_id: roleIdByName.DIRECTION,
      permission_id: permIdByCode['prescriptions:read'],
    });
  }
  if (roleIdByName.SECRETAIRE && permIdByCode['prescriptions:read']) {
    grants.push({
      role_id: roleIdByName.SECRETAIRE,
      permission_id: permIdByCode['prescriptions:read'],
    });
  }

  if (grants.length) {
    await knex('role_permissions').insert(grants).onConflict(['role_id', 'permission_id']).ignore();
  }
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('prescription_items');
  await knex.schema.dropTableIfExists('prescriptions');

  const codes = ['prescriptions:read', 'prescriptions:create', 'prescriptions:cancel'];
  const perms = await knex('permissions').whereIn('code', codes).select('id');
  const ids = perms.map((p) => p.id);
  if (ids.length) {
    await knex('role_permissions').whereIn('permission_id', ids).del();
    await knex('permissions').whereIn('id', ids).del();
  }
};
