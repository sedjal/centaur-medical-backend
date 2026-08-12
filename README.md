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

Open http://localhost:8084/

## Seed credentials

| Email | Role | Auth |
|-------|------|------|
| sedjalkhouloud@gmail.com | ADMIN | MFA |
| lydia.sedjal@gmail.com | DIRECTION | MFA |
| rachasl720@gmail.com | MEDECIN | JWT |
| khouloudsed2@gmail.com | SECRETAIRE | JWT |

Password: **`Admin123!`**

MFA / reset codes are emailed when SMTP is configured; otherwise they are **printed in the auth-service console** (dev only).

## API (via Gateway)

Prefix public : **`/api/...`** (pas de `/v1`).

Auth:

- `POST /api/auth/login`
- `POST /api/auth/mfa/verify`
- `POST /api/auth/password/change` *(session ACCESS)*
- `POST /api/auth/password/change-required` *(token CHANGE_PASSWORD)*
- `POST /api/auth/password/forgot`
- `POST /api/auth/password/verify-reset-code`
- `POST /api/auth/password/reset` *(token PASSWORD_RESET)*
- `GET  /api/auth/me` *(ACCESS obligatoire)*

Domain:

- `GET|POST /api/patients`
- `GET|PUT|DELETE /api/patients/:id`
- `GET /api/dashboard/stats`
- `GET /api/audit-logs`
- `GET|POST|PATCH|DELETE /api/users`
- `GET|POST|PUT|DELETE /api/roles`

### JWT `purpose`

Les JWT sont typés par un champ `purpose`. Les routes protégées du gateway exigent strictement `purpose === ACCESS`. Les tokens `MFA`, `PASSWORD_RESET` et `CHANGE_PASSWORD` sont limités à leur endpoint respectif et **ne peuvent pas** être utilisés comme tokens d’accès (`/auth/me`, `/patients`, etc.).

## Tests

```bash
# unitaires (tape + sinon)
npm test -w auth-service
npm test -w gateway
npm test -w patient-service
npm test -w notification-service
```

Stack unitaire : **tape** (TAP) + **sinon** (stubs/spies) + **tsx** + **c8**.

Structure des tests :

```text
gateway/tests/
├── unit/           # requireAuth, rate-limit, headers
└── integration/    # HTTP réel : login, /auth/me, /patients (401 vs 403)

auth-service/tests/
├── unit/           # password, OTP, JWT, RBAC, MFA purpose
└── integration/    # service-token : requireServiceToken sur routes publiques auth
```

```bash
npm test -w gateway
npm run test:integration -w gateway
npm run test:all -w gateway
```

| Fichier | Couvre |
|---------|--------|
| `unit/password-policy.test.ts` | règles mot de passe |
| `unit/otp-security.test.ts` | OTP hash / generate |
| `unit/jwt-purpose.test.ts` | ACCESS / MFA / CHANGE_PASSWORD / PASSWORD_RESET |
| `unit/password.test.ts` | Argon2 |
| `unit/permissions.test.ts` | RBAC |
| `unit/login.test.ts` | formes des résultats login |
| `unit/mfa-purpose.test.ts` | purpose MFA strict |
| `gateway/tests/unit/rate-limit.test.ts` | rate limiter |
| `gateway/tests/unit/auth-purpose.test.ts` | ACCESS only (unit) |
| `gateway/tests/integration/auth-login.test.ts` | POST /api/auth/login |
| `gateway/tests/integration/auth-me.test.ts` | GET /api/auth/me + purposes |
| `gateway/tests/integration/authorization.test.ts` | 401 vs 403 sur /patients |
| `auth-service/tests/integration/service-token.integration.test.ts` | requireServiceToken login/MFA/forgot/reset |
| `patient.test.ts` | validateSpecialty |

## Security notes

### Authentication & authorisation

1. Gateway validates JWT + RBAC + rate-limits auth routes
2. Injects `x-service-token` + identity headers on every proxied request
3. Patient/Auth/Notification services reject calls without a valid service token — including the previously-public auth routes (`/auth/login`, MFA, forgot/reset). This ensures that bypassing the gateway (e.g. direct access to port 3001) is blocked at the service layer as a second line of defence.
4. Passwords hashed with **Argon2id** + shared policy (`assertPasswordPolicy`)
5. MFA / reset OTP stored **hashed** (never plaintext in DB)
6. JWT `purpose` claim restricts token usage per flow — `MFA`, `CHANGE_PASSWORD`, `PASSWORD_RESET` tokens cannot unlock `/auth/me` or `/patients`
7. Weak `JWT_SECRET` / `SERVICE_TOKEN` rejected in production (`NODE_ENV=production`)

### CORS

`CORS_ORIGIN` **must** be set to an explicit origin in production (e.g. `https://app.centaur-medical.com`).
The gateway refuses to start — or respond with permissive CORS — if `CORS_ORIGIN` is absent or `*` when `NODE_ENV=production`.
In development the wildcard fallback is kept for DX convenience.

`.env.example` already ships with `CORS_ORIGIN=http://localhost:8084` as a starting point.

### Network isolation

Only the **gateway (port 3000)** should be reachable from the internet (or from the load balancer / reverse proxy).
Internal services must **not** be exposed publicly:

| Service | Internal port | Should bind |
|---------|--------------|-------------|
| Auth | 3001 | `127.0.0.1` or private Docker network |
| Patient | 3002 | `127.0.0.1` or private Docker network |
| Notification | 3003 | `127.0.0.1` or private Docker network |

In Docker Compose, do **not** publish ports 3001–3003 to the host. Only publish 3000 (or route via a reverse proxy such as nginx/Caddy). Example:

```yaml
services:
  gateway:
    ports:
      - "3000:3000"   # public
  auth-service:
    # no ports: block — only reachable within the Docker network
  patient-service:
    # no ports: block
  notification-service:
    # no ports: block
```

### Token storage (frontend)

The frontend currently stores JWTs in **`localStorage`** (`centaur_token`, `centaur_mfa_token`, `centaur_temp_token`).

**Risk**: any XSS vulnerability in the SPA can exfiltrate the Bearer token.

**Current mitigations**:
- Access token TTL is short (`JWT_EXPIRES_IN`, default `8h` — reduce to `15m`–`1h` for production).
- Tokens are purged from `localStorage` on any 401 response and on logout.
- JWT is never logged server-side.

**Future hardening (P2)**: replace the `localStorage` access token with a short-lived token passed as a `HttpOnly` / `Secure` / `SameSite=Strict` cookie set by the gateway on login. This requires a coordinated frontend + gateway change and is out of scope for the current sprint.