/**
 * @param {import('knex').Knex} knex
 * @param {string} name
 * @param {(t: import('knex').Knex.CreateTableBuilder) => void} cb
 */
async function ensureTable(knex, name, cb) {
  if (!(await knex.schema.hasTable(name))) {
    await knex.schema.createTable(name, cb);
  }
}

/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS pgcrypto');

  await ensureTable(knex, 'roles', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('name', 50).notNullable().unique();
    t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
  });

  await ensureTable(knex, 'permissions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('code', 80).notNullable().unique();
    t.string('description', 255);
    t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
  });

  await ensureTable(knex, 'role_permissions', (t) => {
    t.uuid('role_id').notNullable().references('id').inTable('roles').onDelete('CASCADE');
    t.uuid('permission_id')
      .notNullable()
      .references('id')
      .inTable('permissions')
      .onDelete('CASCADE');
    t.primary(['role_id', 'permission_id']);
  });

  await ensureTable(knex, 'users', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('email', 255).notNullable().unique();
    t.string('password_hash', 255).notNullable();
    t.string('first_name', 100).notNullable();
    t.string('last_name', 100).notNullable();
    t.uuid('role_id').notNullable().references('id').inTable('roles');
    t.boolean('is_active').notNullable().defaultTo(true);
    t.boolean('must_change_password').notNullable().defaultTo(false);
    t.boolean('mfa_enabled').notNullable().defaultTo(false);
    t.boolean('mfa_required').notNullable().defaultTo(false);
    t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
  });

  await ensureTable(knex, 'mfa_codes', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('code_hash', 255).notNullable();
    t.integer('attempts').notNullable().defaultTo(0);
    t.timestamp('expires_at', { useTz: true }).notNullable();
    t.timestamp('used_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
  });

  await knex.raw(`
    DO $$ BEGIN
      CREATE TYPE service_type AS ENUM ('GENERAL', 'URGENCE', 'ONCOLOGIE', 'CARDIOLOGIE');
    EXCEPTION WHEN duplicate_object THEN null;
    END $$;
  `);

  await ensureTable(knex, 'patients', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('patient_code', 20).notNullable().unique();
    t.string('first_name', 100).notNullable();
    t.string('last_name', 100).notNullable();
    t.date('hospitalization_date').notNullable();
    t.specificType('service', 'service_type').notNullable();
    t.string('status', 50).notNullable().defaultTo('STABLE');
    t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
  });

  await ensureTable(knex, 'medical_records', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('patient_id')
      .notNullable()
      .references('id')
      .inTable('patients')
      .onDelete('CASCADE')
      .unique();
    t.specificType('service', 'service_type').notNullable();
    t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
  });

  await ensureTable(knex, 'general_records', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('medical_record_id')
      .notNullable()
      .references('id')
      .inTable('medical_records')
      .onDelete('CASCADE')
      .unique();
    t.text('notes').nullable();
  });

  await ensureTable(knex, 'emergency_records', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('medical_record_id')
      .notNullable()
      .references('id')
      .inTable('medical_records')
      .onDelete('CASCADE')
      .unique();
    t.time('arrival_time').notNullable();
    t.string('triage_level', 50).notNullable();
    t.string('initial_severity', 100).notNullable();
  });

  await ensureTable(knex, 'oncology_records', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('medical_record_id')
      .notNullable()
      .references('id')
      .inTable('medical_records')
      .onDelete('CASCADE')
      .unique();
    t.string('tumor_type', 150).notNullable();
    t.string('stage', 50).notNullable();
    t.string('current_treatment', 255).notNullable();
  });

  await ensureTable(knex, 'cardiology_records', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('medical_record_id')
      .notNullable()
      .references('id')
      .inTable('medical_records')
      .onDelete('CASCADE')
      .unique();
    t.string('ecg_results', 255).notNullable();
    t.integer('resting_heart_rate').notNullable();
    t.string('blood_pressure', 50).notNullable();
  });

  await ensureTable(knex, 'notifications', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.string('type', 50).notNullable();
    t.string('recipient_email', 255).notNullable();
    t.string('subject', 255).notNullable();
    t.text('body').notNullable();
    t.string('status', 30).notNullable().defaultTo('SENT');
    t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
  });

  await ensureTable(knex, 'audit_logs', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.string('action', 50).notNullable();
    t.string('resource', 50).notNullable();
    t.string('resource_id', 80).nullable();
    t.string('patient_name', 200).nullable();
    t.string('ip_address', 100).nullable();
    t.jsonb('details').nullable();
    t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('audit_logs');
  await knex.schema.dropTableIfExists('notifications');
  await knex.schema.dropTableIfExists('cardiology_records');
  await knex.schema.dropTableIfExists('oncology_records');
  await knex.schema.dropTableIfExists('emergency_records');
  await knex.schema.dropTableIfExists('general_records');
  await knex.schema.dropTableIfExists('medical_records');
  await knex.schema.dropTableIfExists('patients');
  await knex.schema.dropTableIfExists('mfa_codes');
  await knex.schema.dropTableIfExists('users');
  await knex.schema.dropTableIfExists('role_permissions');
  await knex.schema.dropTableIfExists('permissions');
  await knex.schema.dropTableIfExists('roles');
  await knex.raw('DROP TYPE IF EXISTS service_type');
};
