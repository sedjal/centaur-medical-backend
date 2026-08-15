# Centaur Medical

**Medical Records Management System — Hospital Patient Management**

A modern full-stack medical records management application built with Vue 3 (JSX), TypeScript, Restana, Knex and PostgreSQL.

## Architecture

```text
Vue 3 + JSX + Axios
        ↓
   API Gateway :3000  (JWT · RBAC · Zod · Rate limit · Security Headers · CORS)
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
- **RBAC** permissions (patients, prescriptions, users, audit, services)
- **Prescriptions / ordonnances** (create, list, detail, cancel — soft cancel only)
- **Historique médical** (événements métier immuables, distinct des audit logs)
- **Isolation `service:*`** on list / get / dashboard / prescriptions / medical-history (search cannot bypass the scope)
- **Audit logs** (`PATIENT_*`, `PRESCRIPTION_CREATED` / `PRESCRIPTION_CANCELLED`)
- Last-ADMIN and self-delete guards; password-reset codes locked after **5 attempts**
- **Email notifications** (NodeMailer)
- Unit tests (tape + sinon)
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

> ⚠️ These credentials are for **local / demo use only**. Never reuse this password or these accounts in production.

| Email | Role | Auth |
|-------|------|------|
| sedjalkhouloud@gmail.com | ADMIN | MFA |
| lydia.sedjal@gmail.com | DIRECTION | MFA |
| rachasl720@gmail.com | MEDECIN | JWT |
| khouloudsed2@gmail.com | SECRETAIRE | JWT |

Password: **`Admin123!`** (demo seed only)

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
- `GET /api/patients/:id/prescriptions`
- `GET /api/patients/:id/medical-history`
- `GET /api/medical-history` *(filters: `patientId`, `service`, `type`, `from`, `to`)*
- `GET /api/prescriptions` *(filters: `patientId`, `service`, `status`, `from`, `to`)*
- `GET /api/prescriptions/:id`
- `POST /api/prescriptions`
- `PATCH /api/prescriptions/:id/cancel`
- `GET /api/dashboard/stats`
- `GET /api/audit-logs`
- `GET /api/notifications` *(filters: `read`, `status`, `type`, `patientId`)*
- `GET /api/notifications/:id`
- `POST /api/notifications`
- `PATCH /api/notifications/:id/read`
- `PATCH /api/notifications/:id/cancel`

### Prescriptions

Permissions :

| Permission | Usage |
|------------|--------|
| `prescriptions:read` | Lister / consulter |
| `prescriptions:create` | Créer une ordonnance |
| `prescriptions:cancel` | Annuler (soft) |

Rôles seed :

- **MEDECIN** / **ADMIN** : read + create + cancel
- **DIRECTION** / **SECRETAIRE** : read uniquement

`doctorId` est **toujours** pris depuis le JWT (`x-user-id`) — jamais depuis le body.

Payload `POST /api/prescriptions` :

```json
{
  "patientId": "uuid",
  "prescribedAt": "2026-08-12T14:30:00.000Z",
  "notes": "optionnel",
  "medications": [
    {
      "name": "Paracétamol",
      "dosage": "1g",
      "frequency": "3x/jour",
      "duration": "5 jours",
      "instructions": "optionnel"
    }
  ]
}
```

Erreurs : `400` validation, `403` permission / service, `404` patient ou ordonnance, `409` déjà annulée (ou patient avec ordonnances à la suppression).

Pas de `DELETE` physique sur les ordonnances.

### Medical history

Permission : `medical_history:read` (ADMIN, DIRECTION, MEDECIN, SECRETAIRE).

Distinct des **audit logs** : l’historique est une chronologie médicale immuable (append-only). Pas de POST / PUT / PATCH / DELETE public.

Types : `HOSPITALIZATION`, `CONSULTATION`, `DIAGNOSIS`, `PRESCRIPTION`, `RECORD_UPDATE`.

Événements réellement écrits aujourd’hui :

- `POST /prescriptions` → `PRESCRIPTION` (`Nouvelle ordonnance créée`)
- `PATCH /prescriptions/:id/cancel` → `PRESCRIPTION` (`Ordonnance annulée`) — n’efface pas l’événement de création
- `PUT /patients/:id` → `RECORD_UPDATE` (`Modification du dossier médical`)

La création d’un patient n’émet **pas** `HOSPITALIZATION` (`hospitalization_date` est un champ administratif, pas un séjour).

### Notifications (in-app)

Permissions :

| Permission | Usage |
|------------|--------|
| `notifications:read` | Lire ses propres notifications |
| `notifications:create` | Créer une notification planifiable |
| `notifications:read_all` | Lister toutes les notifications (ADMIN / DIRECTION) |
| `notifications:cancel` | Annuler une notification `PENDING` |

Les emails MFA / welcome / reset restent dans `email_notifications` (anciennement `notifications`).  
La table `notifications` est l’inbox applicative (statuts `PENDING` \| `SENT` \| `READ` \| `CANCELLED`).

Planification : si `scheduledAt <= now` → statut `SENT` immédiat. Sinon `PENDING`.  
**Aucun worker/cron** n’existe encore : les `PENDING` futurs ne basculent pas automatiquement en `SENT`.

Pas de `PUT` sur le message après création. Audit : `NOTIFICATION_CREATED` / `READ` / `CANCELLED` (sans contenu médical).

Users:

- `GET    /api/users`
- `POST   /api/users`
- `PATCH  /api/users/:id`
- `DELETE /api/users/:id`

Roles:

- `GET    /api/roles`
- `POST   /api/roles`
- `PUT    /api/roles/:id/permissions`
- `DELETE /api/roles/:id`

### JWT `purpose`

Les JWT sont typés par un champ `purpose`. Les routes protégées du gateway exigent strictement `purpose === ACCESS`. Les tokens `MFA`, `PASSWORD_RESET` et `CHANGE_PASSWORD` sont limités à leur endpoint respectif et **ne peuvent pas** être utilisés comme tokens d’accès (`/auth/me`, `/patients`, etc.).

## Tests

```bash
npm test -w auth-service
npm run test:integration -w auth-service
npm run test:all -w auth-service
npm run test:coverage -w auth-service   # auth.service.ts ≥ 70 % (unit + intégration)
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
├── unit/           # password, OTP, JWT, RBAC, MFA purpose, last-admin, reset attempts
└── integration/    # service-token : requireServiceToken sur routes publiques auth

patient-service/tests/
├── patient.test.ts     # validateSpecialty
└── isolation.test.ts   # service:* list / get 403 / dashboard / search / PATIENT_READ
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
| `unit/admin-reset.test.ts` | self-delete, dernier ADMIN, reset 5 tentatives |
| `unit/auth.service.test.ts` | login, MFA, reset, users, roles (DB mockée) |
| `unit/middleware.test.ts` | requireServiceToken, readInternalUser |
| `integration/auth-flow.integration.test.ts` | HTTP login / MFA / forgot + auth.service |
| `gateway/tests/unit/rate-limit.test.ts` | rate limiter |
| `gateway/tests/unit/auth-purpose.test.ts` | ACCESS only (unit) |
| `gateway/tests/integration/auth-login.test.ts` | POST /api/auth/login |
| `gateway/tests/integration/auth-me.test.ts` | GET /api/auth/me + purposes |
| `gateway/tests/integration/authorization.test.ts` | 401 vs 403 sur /patients |
| `auth-service/tests/integration/service-token.integration.test.ts` | requireServiceToken login/MFA/forgot/reset |
| `patient.test.ts` | validateSpecialty |
| `isolation.test.ts` | URGENCE vs CARDIOLOGIE + PATIENT_READ |

## Security notes

### Authentication & authorisation

1. Gateway validates JWT + RBAC + rate-limits auth routes
2. Injects `x-service-token` + identity headers on every proxied request
3. Patient/Auth/Notification services reject calls without a valid service token — including the previously-public auth routes (`/auth/login`, MFA, forgot/reset). This ensures that bypassing the gateway (e.g. direct access to port 3001) is blocked at the service layer as a second line of defence.
4. Passwords hashed with **Argon2id** + shared policy (`assertPasswordPolicy`)
5. MFA / reset OTP stored **hashed** (never plaintext in DB)
6. JWT `purpose` claim restricts token usage per flow — `MFA`, `CHANGE_PASSWORD`, `PASSWORD_RESET` tokens cannot unlock `/auth/me` or `/patients`
7. Weak `JWT_SECRET` / `SERVICE_TOKEN` rejected in production (`NODE_ENV=production`)
8. `service:*` scopes **reads** (`listPatients`, `getPatient` → 403 hors périmètre, dashboard). Search never bypasses the filter.
9. `DELETE /users/:id` refuses self-delete and the last active ADMIN (403). Reset codes lock after 5 attempts (429).

### Security headers (gateway)

Restana is not Express, so the gateway does **not** use the `helmet` package. It sets baseline headers manually on every response (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `X-DNS-Prefetch-Control`, `Cross-Origin-Resource-Policy`).

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

In Docker Compose, do **not** publish ports 3001–3003 to the host (`ports`). Use `expose` so they stay on the internal network. Only publish 3000:

```yaml
services:
  gateway:
    ports:
      - "3000:3000"   # public
  auth-service:
    expose: ["3001"]  # internal only — do not use `ports`
  patient-service:
    expose: ["3002"]
  notification-service:
    expose: ["3003"]
```

### Token storage (frontend)

The frontend currently stores JWTs in **`localStorage`** (`centaur_token`, `centaur_mfa_token`, `centaur_temp_token`).

**Risk**: any XSS vulnerability in the SPA can exfiltrate the Bearer token.

**Current state (prototype)**:
- Access token TTL defaults to **`8h`** via `JWT_EXPIRES_IN`. That is convenient for local dev but **not** a short TTL for production.
- Tokens are purged from `localStorage` on any 401 response and on logout.
- JWT is never logged server-side.

**Production (not implemented here)**: reduce access token to ~**15 min**, add a **refresh token** in an **HttpOnly** / `Secure` / `SameSite=Strict` cookie set by the gateway. `localStorage` JWTs remain an XSS risk.

### Rate limiting

The gateway rate limiter is **in-memory** (`shared/src/rateLimit.ts`). That is correct for a **single Node process**.

**Production**: use **Redis** (or an equivalent shared store) so limits survive restarts and apply across multiple gateway instances.

### Out of scope (oral)

FHIR, HL7, NIR/INS, HDS, PACS, Kubernetes — not part of this junior full-stack exercise.