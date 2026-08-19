/**
 * Clinical notes / comptes rendus + reports:create RBAC.
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('clinical_notes'))) {
    await knex.schema.createTable('clinical_notes', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('patient_id')
        .notNullable()
        .references('id')
        .inTable('patients')
        .onDelete('RESTRICT');
      t.string('title', 120).notNullable();
      t.text('body').notNullable();
      t.uuid('author_id').references('id').inTable('users').onDelete('SET NULL');
      t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      t.index(['patient_id']);
      t.index(['created_at']);
      t.index(['patient_id', 'created_at']);
    });
    await knex.raw(`
      ALTER TABLE clinical_notes
        ADD CONSTRAINT clinical_notes_title_len_check
        CHECK (char_length(btrim(title)) >= 1 AND char_length(title) <= 120)
    `);
    await knex.raw(`
      ALTER TABLE clinical_notes
        ADD CONSTRAINT clinical_notes_body_len_check
        CHECK (char_length(btrim(body)) >= 1 AND char_length(body) <= 10000)
    `);
  }

  const permRows = [
    { code: 'reports:read', description: 'Read clinical notes' },
    { code: 'reports:create', description: 'Write clinical notes' },
  ];
  const existingCodes = new Set(
    (await knex('permissions').whereIn('code', permRows.map((p) => p.code)).select('code')).map(
      (p) => p.code
    )
  );
  const missing = permRows.filter((p) => !existingCodes.has(p.code));
  if (missing.length) {
    await knex('permissions').insert(missing);
  }

  await knex('permissions')
    .where({ code: 'reports:read' })
    .update({ description: 'Read clinical notes' });
  await knex('permissions')
    .where({ code: 'reports:create' })
    .update({ description: 'Write clinical notes' });

  const inserted = await knex('permissions')
    .whereIn(
      'code',
      permRows.map((p) => p.code)
    )
    .select(['id', 'code']);
  const permIdByCode = Object.fromEntries(inserted.map((p) => [p.code, p.id]));

  const roles = await knex('roles').select(['id', 'name']);
  const roleIdByName = Object.fromEntries(roles.map((r) => [r.name, r.id]));

  const grants = [];
  const readers = ['ADMIN', 'DIRECTION', 'MEDECIN', 'MEDECIN_URGENCE'];
  const writers = ['ADMIN', 'MEDECIN', 'MEDECIN_URGENCE'];

  for (const name of readers) {
    if (roleIdByName[name] && permIdByCode['reports:read']) {
      grants.push({ role_id: roleIdByName[name], permission_id: permIdByCode['reports:read'] });
    }
  }
  for (const name of writers) {
    if (roleIdByName[name] && permIdByCode['reports:create']) {
      grants.push({ role_id: roleIdByName[name], permission_id: permIdByCode['reports:create'] });
    }
  }

  if (grants.length) {
    await knex('role_permissions').insert(grants).onConflict(['role_id', 'permission_id']).ignore();
  }
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('clinical_notes');

  const createPerm = await knex('permissions').where({ code: 'reports:create' }).first();
  if (createPerm) {
    await knex('role_permissions').where({ permission_id: createPerm.id }).del();
    await knex('permissions').where({ id: createPerm.id }).del();
  }
};
