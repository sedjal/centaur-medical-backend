/**
 * Medical history is append-only: deleting a patient must not erase the timeline.
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('medical_history'))) return;
  await knex.raw(`
    ALTER TABLE medical_history
      DROP CONSTRAINT IF EXISTS medical_history_patient_id_foreign
  `);
  await knex.schema.alterTable('medical_history', (t) => {
    t.foreign('patient_id')
      .references('id')
      .inTable('patients')
      .onDelete('RESTRICT');
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable('medical_history'))) return;
  await knex.raw(`
    ALTER TABLE medical_history
      DROP CONSTRAINT IF EXISTS medical_history_patient_id_foreign
  `);
  await knex.schema.alterTable('medical_history', (t) => {
    t.foreign('patient_id')
      .references('id')
      .inTable('patients')
      .onDelete('CASCADE');
  });
};
