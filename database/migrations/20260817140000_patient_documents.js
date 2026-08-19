/**
 * Patient dossier documents (BYTEA) + documents:* RBAC.
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('patient_documents'))) {
    await knex.schema.createTable('patient_documents', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('patient_id')
        .notNullable()
        .references('id')
        .inTable('patients')
        .onDelete('RESTRICT');
      t.string('doc_type', 20).notNullable();
      t.string('filename', 255).notNullable();
      t.string('mime_type', 120).notNullable();
      t.integer('byte_size').notNullable();
      t.binary('content').notNullable();
      t.uuid('uploaded_by').references('id').inTable('users').onDelete('SET NULL');
      t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      t.index(['patient_id']);
      t.index(['created_at']);
      t.index(['doc_type']);
      t.index(['patient_id', 'created_at']);
    });
    await knex.raw(`
      ALTER TABLE patient_documents
        ADD CONSTRAINT patient_documents_doc_type_check
        CHECK (doc_type IN ('ECG', 'CARTE_GROUPE', 'ORDONNANCE', 'AUTRE'))
    `);
    await knex.raw(`
      ALTER TABLE patient_documents
        ADD CONSTRAINT patient_documents_byte_size_check
        CHECK (byte_size > 0 AND byte_size <= 5242880)
    `);
  }

  const permRows = [
    { code: 'documents:read', description: 'Read patient documents' },
    { code: 'documents:create', description: 'Upload patient documents' },
    { code: 'documents:delete', description: 'Delete patient documents' },
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
  const readers = ['ADMIN', 'DIRECTION', 'MEDECIN', 'SECRETAIRE', 'MEDECIN_URGENCE'];
  const creators = ['ADMIN', 'MEDECIN', 'SECRETAIRE', 'MEDECIN_URGENCE'];

  for (const name of readers) {
    if (roleIdByName[name] && permIdByCode['documents:read']) {
      grants.push({ role_id: roleIdByName[name], permission_id: permIdByCode['documents:read'] });
    }
  }
  for (const name of creators) {
    if (roleIdByName[name] && permIdByCode['documents:create']) {
      grants.push({ role_id: roleIdByName[name], permission_id: permIdByCode['documents:create'] });
    }
  }
  if (roleIdByName.ADMIN && permIdByCode['documents:delete']) {
    grants.push({
      role_id: roleIdByName.ADMIN,
      permission_id: permIdByCode['documents:delete'],
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
  await knex.schema.dropTableIfExists('patient_documents');

  const codes = ['documents:read', 'documents:create', 'documents:delete'];
  const perms = await knex('permissions').whereIn('code', codes).select('id');
  const ids = perms.map((p) => p.id);
  if (ids.length) {
    await knex('role_permissions').whereIn('permission_id', ids).del();
    await knex('permissions').whereIn('id', ids).del();
  }
};
