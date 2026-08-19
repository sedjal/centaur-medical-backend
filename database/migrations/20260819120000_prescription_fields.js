/**
 * Add columns prescription_number, patient_age, patient_gender, and doctor_name to prescriptions table.
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  if (await knex.schema.hasTable('prescriptions')) {
    await knex.schema.alterTable('prescriptions', (t) => {
      t.specificType('prescription_number', 'SERIAL');
      t.string('patient_age', 50).nullable();
      t.string('patient_gender', 50).nullable();
      t.string('doctor_name', 255).nullable();
    });
  }
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  if (await knex.schema.hasTable('prescriptions')) {
    await knex.schema.alterTable('prescriptions', (t) => {
      t.dropColumn('prescription_number');
      t.dropColumn('patient_age');
      t.dropColumn('patient_gender');
      t.dropColumn('doctor_name');
    });
  }
};
