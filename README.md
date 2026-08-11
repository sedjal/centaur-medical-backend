# Centaur Medical

**Medical Records Management System — Hospital Patient Management**

A modern full-stack medical records management application built with Vue 3 (JSX), TypeScript, Restana, Knex and PostgreSQL.

## Architecture

```text
Vue 3 + JSX + Axios
        ↓
   API Gateway :3000  (JWT · RBAC · Zod · Rate limit · Helmet/CORS)
        ↓
┌───────────────┬────────────────┬──────────────────┐
│ Auth :3001    │ Patient :3002  │ Notification :3003│
│ JWT · MFA     │ CRUD + 4 depts │ NodeMailer        │
│ Users · RBAC  │ Audit logs     │ MFA / Welcome     │
└───────┬───────┴────────┬───────┴────────┬─────────┘
        └────────────────┼────────────────┘
                         ▼
                    PostgreSQL
```

Internal ports (`3001–3003`) are protected by `x-service-token`. Only the Gateway is public.

## Features

- Patient management across **Chirurgie Générale, Urgence, Oncologie, Cardiologie**
- JWT authentication + **MFA for ADMIN / DIRECTION**
- **RBAC** permissions (patients, users, audit, services)
- **Audit logs** (who deleted Ahmed Benali, when, from which IP)
- **Email notifications** (NodeMailer)
- Unit tests (Jest)
- `database.sql` bootstrap script

## Quick start

### 1. Database

Create DB then either:

```bash
psql -U postgres -d centaur_medical -f database.sql
```

or:

```bash
cp .env.example .env
npm install
npm run build -w shared
npx knex migrate:latest --knexfile knexfile.ts
npx knex seed:run --knexfile knexfile.ts
```

> Prefer **knex seed** for Argon2 password hashes (password `Admin123!`).

### 2. Run services

```bash
npm install
npm run build -w shared
npm run dev
```

Gateway: http://127.0.0.1:3000

### 3. Frontend (separate repo)

```bash
cd ../centaur-medical-frontend
npm install
npm run serve
```

Open http://localhost:8080

## Seed credentials

| Email | Role | Auth |
|-------|------|------|
| sedjalkhouloud@gmail.com | ADMIN | MFA |
| lydia.sedjal@gmail.com | DIRECTION | MFA |
| rachasl720@gmail.com | MEDECIN | JWT |
| khouloudsed2@gmail.com | SECRETAIRE | JWT |

Password: **`Admin123!`**

MFA codes are emailed when SMTP is configured; otherwise they are **printed in the auth-service console**.

## API (via Gateway)

- `POST /api/v1/auth/login`
- `POST /api/v1/auth/mfa/verify`
- `GET  /api/v1/auth/me`
- `GET|POST /api/v1/patients`
- `GET|PUT|DELETE /api/v1/patients/:id`
- `GET /api/v1/dashboard/stats`
- `GET /api/v1/audit-logs`
- `GET|POST /api/v1/users`

## Tests

```bash
npm test
npm run test:coverage
```

## Security notes

1. Gateway validates JWT + RBAC
2. Injects `x-service-token` + identity headers
3. Patient/Auth services reject calls without service token
4. Passwords hashed with **Argon2id**
5. MFA OTP stored hashed in `mfa_codes` (never on `users`)
