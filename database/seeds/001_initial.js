const argon2 = require('argon2');

const ROLE_PERMISSIONS = {
  ADMIN: [
    'patients:read',
    'patients:create',
    'patients:update',
    'patients:delete',
    'prescriptions:read',
    'prescriptions:create',
    'prescriptions:cancel',
    'medical_history:read',
    'notifications:read',
    'notifications:create',
    'notifications:read_all',
    'notifications:cancel',
    'service:general',
    'service:urgence',
    'service:oncologie',
    'service:cardiologie',
    'users:read',
    'users:create',
    'users:update',
    'users:delete',
    'roles:manage',
    'audit:read',
    'reports:read',
  ],
  DIRECTION: [
    'patients:read',
    'prescriptions:read',
    'medical_history:read',
    'notifications:read',
    'notifications:create',
    'notifications:read_all',
    'notifications:cancel',
    'service:general',
    'service:urgence',
    'service:oncologie',
    'service:cardiologie',
    'reports:read',
    'audit:read',
  ],
  MEDECIN: [
    'patients:read',
    'patients:create',
    'patients:update',
    'prescriptions:read',
    'prescriptions:create',
    'prescriptions:cancel',
    'medical_history:read',
    'notifications:read',
    'notifications:create',
    'notifications:cancel',
    'service:general',
    'service:urgence',
    'service:oncologie',
    'service:cardiologie',
  ],
  SECRETAIRE: [
    'patients:read',
    'patients:create',
    'prescriptions:read',
    'medical_history:read',
    'notifications:read',
    'notifications:create',
    'service:general',
    'service:urgence',
    'service:oncologie',
    'service:cardiologie',
  ],
  MEDECIN_URGENCE: [
    'patients:read',
    'patients:create',
    'patients:update',
    'prescriptions:read',
    'prescriptions:create',
    'prescriptions:cancel',
    'medical_history:read',
    'notifications:read',
    'notifications:create',
    'notifications:cancel',
    'service:urgence',
  ],
};

const PERMISSIONS = [
  ['patients:read', 'Read patients'],
  ['patients:create', 'Create patients'],
  ['patients:update', 'Update patients'],
  ['patients:delete', 'Delete patients'],
  ['prescriptions:read', 'Read prescriptions'],
  ['prescriptions:create', 'Create prescriptions'],
  ['prescriptions:cancel', 'Cancel prescriptions'],
  ['medical_history:read', 'Read medical history'],
  ['notifications:read', 'Read own notifications'],
  ['notifications:create', 'Create notifications'],
  ['notifications:read_all', 'Read all notifications'],
  ['notifications:cancel', 'Cancel pending notifications'],
  ['service:general', 'Access general'],
  ['service:urgence', 'Access urgence'],
  ['service:oncologie', 'Access oncologie'],
  ['service:cardiologie', 'Access cardiologie'],
  ['users:read', 'Read users'],
  ['users:create', 'Create users'],
  ['users:update', 'Update users'],
  ['users:delete', 'Delete users'],
  ['roles:manage', 'Manage roles'],
  ['audit:read', 'Read audit'],
  ['reports:read', 'Read reports'],
];

/**
 * @param {import('knex').Knex} knex
 */
exports.seed = async function seed(knex) {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEV_SEED !== '1') {
    throw new Error(
      'Refusing to run development seed in production. Set ALLOW_DEV_SEED=1 only for an explicitly approved bootstrap.'
    );
  }
  const seedPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!seedPassword || seedPassword.length < 8) {
    throw new Error('SEED_ADMIN_PASSWORD must be set (>= 8 characters) to seed users.');
  }

  await knex('audit_logs').del();
  await knex('notifications').del();
  if (await knex.schema.hasTable('email_notifications')) {
    await knex('email_notifications').del();
  }
  await knex('prescription_items').del();
  await knex('prescriptions').del();
  await knex('medical_history').del();
  await knex('cardiology_records').del();
  await knex('oncology_records').del();
  await knex('emergency_records').del();
  await knex('general_records').del();
  await knex('medical_records').del();
  await knex('patients').del();
  await knex('mfa_codes').del();
  await knex('users').del();
  await knex('role_permissions').del();
  await knex('permissions').del();
  await knex('roles').del();

  const roleNames = ['ADMIN', 'DIRECTION', 'MEDECIN', 'SECRETAIRE', 'MEDECIN_URGENCE'];
  const roleRows = await knex('roles')
    .insert(roleNames.map((name) => ({ name })))
    .returning(['id', 'name']);

  const permRows = await knex('permissions')
    .insert(PERMISSIONS.map(([code, description]) => ({ code, description })))
    .returning(['id', 'code']);

  const roleIdByName = Object.fromEntries(roleRows.map((r) => [r.name, r.id]));
  const permIdByCode = Object.fromEntries(permRows.map((p) => [p.code, p.id]));

  const rolePerms = [];
  for (const role of roleNames) {
    for (const code of ROLE_PERMISSIONS[role]) {
      rolePerms.push({ role_id: roleIdByName[role], permission_id: permIdByCode[code] });
    }
  }
  await knex('role_permissions').insert(rolePerms);

  const passwordHash = await argon2.hash(seedPassword, { type: argon2.argon2id });

  await knex('users').insert([
    {
      email: 'sedjalkhouloud@gmail.com',
      password_hash: passwordHash,
      first_name: 'Khouloud',
      last_name: 'Sedjal',
      role_id: roleIdByName.ADMIN,
      mfa_enabled: true,
      mfa_required: true,
    },
    {
      email: 'lydia.sedjal@gmail.com',
      password_hash: passwordHash,
      first_name: 'Lydia',
      last_name: 'Sedjal',
      role_id: roleIdByName.DIRECTION,
      mfa_enabled: true,
      mfa_required: true,
    },
    {
      email: 'rachasl720@gmail.com',
      password_hash: passwordHash,
      first_name: 'Racha',
      last_name: 'Medecin',
      role_id: roleIdByName.MEDECIN,
      mfa_enabled: false,
      mfa_required: false,
    },
    {
      email: 'khouloudsed2@gmail.com',
      password_hash: passwordHash,
      first_name: 'Khouloud',
      last_name: 'Secretaire',
      role_id: roleIdByName.SECRETAIRE,
      mfa_enabled: false,
      mfa_required: false,
    },
  ]);

  const [p1] = await knex('patients')
    .insert({
      patient_code: 'PT-000124',
      first_name: 'Ahmed',
      last_name: 'Benali',
      hospitalization_date: '2026-08-11',
      service: 'URGENCE',
      status: 'CRITICAL',
    })
    .returning('*');
  const [p2] = await knex('patients')
    .insert({
      patient_code: 'PT-000125',
      first_name: 'Sarah',
      last_name: 'Amara',
      hospitalization_date: '2026-08-10',
      service: 'ONCOLOGIE',
      status: 'STABLE',
    })
    .returning('*');
  const [p3] = await knex('patients')
    .insert({
      patient_code: 'PT-000126',
      first_name: 'Karim',
      last_name: 'Haddad',
      hospitalization_date: '2026-08-09',
      service: 'CARDIOLOGIE',
      status: 'STABLE',
    })
    .returning('*');
  const [p4] = await knex('patients')
    .insert({
      patient_code: 'PT-000127',
      first_name: 'Nadia',
      last_name: 'Cherif',
      hospitalization_date: '2026-08-08',
      service: 'GENERAL',
      status: 'STABLE',
    })
    .returning('*');

  const [mr1] = await knex('medical_records')
    .insert({ patient_id: p1.id, service: 'URGENCE' })
    .returning('*');
  const [mr2] = await knex('medical_records')
    .insert({ patient_id: p2.id, service: 'ONCOLOGIE' })
    .returning('*');
  const [mr3] = await knex('medical_records')
    .insert({ patient_id: p3.id, service: 'CARDIOLOGIE' })
    .returning('*');
  const [mr4] = await knex('medical_records')
    .insert({ patient_id: p4.id, service: 'GENERAL' })
    .returning('*');

  await knex('emergency_records').insert({
    medical_record_id: mr1.id,
    arrival_time: '14:30:00',
    triage_level: '1',
    initial_severity: 'Critical',
  });
  await knex('oncology_records').insert({
    medical_record_id: mr2.id,
    tumor_type: 'Breast carcinoma',
    stage: 'II',
    current_treatment: 'Chemotherapy',
  });
  await knex('cardiology_records').insert({
    medical_record_id: mr3.id,
    ecg_results: 'Sinus rhythm',
    resting_heart_rate: 72,
    blood_pressure: '120/80',
  });
  await knex('general_records').insert({
    medical_record_id: mr4.id,
    notes: 'Post-operative follow-up',
  });
};
