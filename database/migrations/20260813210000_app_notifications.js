/**
 * In-app notifications + preserve email log as email_notifications.
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  // Rename legacy email log table (do not break auth email trails).
  if (
    (await knex.schema.hasTable('notifications')) &&
    !(await knex.schema.hasTable('email_notifications'))
  ) {
    await knex.schema.renameTable('notifications', 'email_notifications');
    // PostgreSQL keeps the old PK constraint name after renameTable.
    await knex.raw(
      'ALTER TABLE email_notifications RENAME CONSTRAINT notifications_pkey TO email_notifications_pkey'
    );
  }

  if (!(await knex.schema.hasTable('notifications'))) {
    await knex.schema.createTable('notifications', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('recipient_id')
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE');
      t.uuid('patient_id').nullable().references('id').inTable('patients').onDelete('SET NULL');
      t.string('type', 40).notNullable();
      t.string('title', 255).notNullable();
      t.text('message').notNullable();
      t.timestamp('scheduled_at', { useTz: true }).notNullable();
      t.timestamp('sent_at', { useTz: true }).nullable();
      t.timestamp('read_at', { useTz: true }).nullable();
      t.string('status', 30).notNullable().defaultTo('PENDING');
      t.uuid('created_by').nullable().references('id').inTable('users').onDelete('SET NULL');
      t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
      t.index(['recipient_id']);
      t.index(['status']);
      t.index(['scheduled_at']);
      t.index(['patient_id']);
    });
  }

  const permissionDefs = [
    ['notifications:read', 'Read own notifications'],
    ['notifications:create', 'Create notifications'],
    ['notifications:read_all', 'Read all notifications'],
    ['notifications:cancel', 'Cancel pending notifications'],
  ];

  for (const [code, description] of permissionDefs) {
    const existing = await knex('permissions').where({ code }).first();
    if (existing) continue;
    const [perm] = await knex('permissions').insert({ code, description }).returning(['id', 'code']);
    const roles = await knex('roles').select(['id', 'name']);
    const grantNames =
      code === 'notifications:read_all'
        ? ['ADMIN', 'DIRECTION']
        : code === 'notifications:cancel'
          ? ['ADMIN', 'DIRECTION', 'MEDECIN', 'MEDECIN_URGENCE']
          : code === 'notifications:create'
            ? ['ADMIN', 'DIRECTION', 'MEDECIN', 'SECRETAIRE', 'MEDECIN_URGENCE']
            : ['ADMIN', 'DIRECTION', 'MEDECIN', 'SECRETAIRE', 'MEDECIN_URGENCE'];
    const grants = roles
      .filter((r) => grantNames.includes(r.name))
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
  await knex.schema.dropTableIfExists('notifications');

  if (
    (await knex.schema.hasTable('email_notifications')) &&
    !(await knex.schema.hasTable('notifications'))
  ) {
    await knex.raw(
      'ALTER TABLE email_notifications RENAME CONSTRAINT email_notifications_pkey TO notifications_pkey'
    ).catch(async () => {
      // Constraint may already be named notifications_pkey on older DBs
    });
    await knex.schema.renameTable('email_notifications', 'notifications');
  }

  const codes = [
    'notifications:read',
    'notifications:create',
    'notifications:read_all',
    'notifications:cancel',
  ];
  for (const code of codes) {
    const perm = await knex('permissions').where({ code }).first();
    if (perm) {
      await knex('role_permissions').where({ permission_id: perm.id }).del();
      await knex('permissions').where({ id: perm.id }).del();
    }
  }
};
