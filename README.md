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

> Prefer **knex seed** so password hashes are generated from `SEED_ADMIN_PASSWORD` in the environment (never committed).

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

Password: the value of `SEED_ADMIN_PASSWORD` in your environment (not stored in the repo).

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

Planification : si `scheduledAt <= now` à la création → statut `SENT` immédiat. Sinon `PENDING`.

Un **worker interne** (`notification.scheduler.ts`) tourne dans notification-service :

- au démarrage du service : un premier traitement, puis toutes les `NOTIFICATION_WORKER_INTERVAL_MS` (défaut **5000** ms, minimum effectif 1000)
- sélection : `status = PENDING` ET `scheduled_at IS NOT NULL` ET `scheduled_at <= now`
- transition atomique `PENDING → SENT` (`UPDATE … WHERE id AND status = 'PENDING'`) + remplissage de `sent_at`
- `CANCELLED` / `READ` / `SENT` jamais retraités
- pas d’endpoint public de traitement
- SIGTERM / SIGINT : arrêt du timer, fin du tick en cours, fermeture HTTP + pool Knex

Destinataire : un **compte personnel actif** (pas un patient). Qui peut envoyer : permission `notifications:create` (ADMIN, DIRECTION, MEDECIN, SECRÉTAIRE, MEDECIN_URGENCE). L’annuaire `GET /api/users/directory` est ouvert à cette permission — `users:read` (page Utilisateurs) reste réservé à ADMIN.

Timezone : colonnes `timestamptz`. Le frontend peut envoyer `2026-08-15T22:00:00+01:00` ; à l’insert Node stocke l’équivalent UTC (`Date#toISOString()`). Le worker compare en UTC — indépendant du `TimeZone` de session PostgreSQL.

```bash
NOTIFICATION_WORKER_INTERVAL_MS=5000
```

Tests worker :

```bash
npm test -w notification-service
npm run test:all -w notification-service
```

Pas de `PUT` sur le message après création. Audit HTTP : `NOTIFICATION_CREATED` / `READ` / `CANCELLED` (sans contenu médical). Le worker journalise `found` / `processed` / `failed` (pas de titre, message, JWT ni mot de passe).

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
Internal services must **not** be exposed publicly.

| Env | Auth / Patient / Notification | Gateway |
|-----|-------------------------------|---------|
| DEV | `127.0.0.1` (default) | `0.0.0.0` |
| TEST | test apps bind ephemeral `127.0.0.1` | test apps ephemeral |
| DOCKER | `LISTEN_HOST=0.0.0.0` (do **not** publish 3001–3003) | `0.0.0.0`, publish 3000 only |
| PRODUCTION | `127.0.0.1` unless `LISTEN_HOST` is set | `0.0.0.0` (or `GATEWAY_LISTEN_HOST`) |

In Docker Compose, do **not** publish ports 3001–3003 to the host (`ports`). Use `expose` so they stay on the internal network. Only publish 3000:

```yaml
services:
  gateway:
    ports:
      - "3000:3000"   # public
    environment:
      LISTEN_HOST: "0.0.0.0"
  auth-service:
    expose: ["3001"]  # internal only — do not use `ports`
    environment:
      LISTEN_HOST: "0.0.0.0"
  patient-service:
    expose: ["3002"]
    environment:
      LISTEN_HOST: "0.0.0.0"
  notification-service:
    expose: ["3003"]
    environment:
      LISTEN_HOST: "0.0.0.0"
```

### Session / token storage (frontend)

The frontend is a **Vue plugin** (often hosted on another origin). ACCESS JWTs stay in **`localStorage`** (`centaur_token`) and are sent as **`Authorization: Bearer`**. HttpOnly cookies were evaluated in Phase 20 and **not** adopted (cross-origin plugin + SSE + CSRF + dual-auth would be a partial, breaking migration).

**Session model:**
- ACCESS JWT TTL defaults to **`15m`** (`JWT_EXPIRES_IN`).
- Claim `sv` matches `users.session_version`. Logout, password change/reset, deactivate, role change, and role-permission updates bump `sv` and invalidate outstanding ACCESS tokens immediately.
- Frontend refreshes ACCESS about every 10 minutes while logged in (`POST /api/auth/refresh`).
- SSE uses `GET /api/notifications/stream` with the same Bearer token (never `?access_token=`).
- XSS can still steal a Bearer token until TTL or `sv` bump; keep a short ACCESS TTL.

`knex seed` is **blocked in production** unless `ALLOW_DEV_SEED=1`. User passwords come from `SEED_ADMIN_PASSWORD` (never a baked-in production secret).

### Rate limiting

The gateway rate limiter is **in-memory** (`shared/src/rateLimit.ts`). That is correct for a **single Node process**.

**Production**: use **Redis** (or an equivalent shared store) so limits survive restarts and apply across multiple gateway instances.

### Out of scope (oral)

FHIR, HL7, NIR/INS, HDS, PACS, Kubernetes — not part of this junior full-stack exercise.