const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

/** @type {import('knex').Knex.Config} */
module.exports = {
  client: 'pg',
  connection: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'centaur_medical',
  },
  migrations: {
    directory: path.join(__dirname, 'database/migrations'),
    extension: 'js',
  },
  seeds: {
    directory: path.join(__dirname, 'database/seeds'),
    extension: 'js',
  },
};
