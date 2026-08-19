
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const argon2 = require('argon2');
const knexFactory = require('knex');
const knexfile = require('../knexfile');

const EMAILS = [
  'sedjalkhouloud@gmail.com',
  'lydia.sedjal@gmail.com',
  'rachasl720@gmail.com',
  'khouloudsed2@gmail.com',
];

async function main() {
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!password || password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    throw new Error(
      'Set SEED_ADMIN_PASSWORD in the environment (>= 8 chars, letter + digit). Do not put it in the repo.'
    );
  }

  const knex = knexFactory(knexfile);
  try {
    const hash = await argon2.hash(password, { type: argon2.argon2id });
    const n = await knex('users').whereIn('email', EMAILS).update({ password_hash: hash });
    console.log(`Updated password hash for ${n} user(s). Patients and documents were not touched.`);
  } finally {
    await knex.destroy();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
