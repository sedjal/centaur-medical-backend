# Centaur Medical

Medical Records Management System — Hospital Patient Management**

A modern full-stack medical records management application built with Vue 3 (JSX), TypeScript, Restana, Knex and PostgreSQL.

Architecture microservices

text
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
`

Internal ports (`3001–3003`) are protected by `x-service-token`. Only the Gateway is public.

Features

- Patient management across Chirurgie Générale, Urgence, Oncologie, Cardiologie 
- JWT authentication + MFA for ADMIN / DIRECTION
- RBACpermissions (patients, prescriptions, users, audit, services)
- Prescriptions / ordonnances** (create, list, detail, cancel — soft cancel only)
- Documents patient (upload, download, suppression — ECG, Carte de groupage, Ordonnance, Autre)
- Comptes rendus cliniques (CRUD + suppression)
- Historique médical(événements métier immuables, distinct des audit logs)
- Pagination sur toutes les listes (`page`, `limit` → `{ items, total, page, limit }`)
- equêtes optimisées (batch load medications, batch load dossiers
- Isolation `service:*`** on list / get / dashboard / prescriptions / medical-history (search cannot bypass the scope)
- Audit logs (`PATIENT_*`, `PRESCRIPTION_CREATED` / `PRESCRIPTION_CANCELLED`)
- Last-ADMIN and self-delete guards; password-reset codes locked after 5 attempts 
- Email notifications** (NodeMailer)
- Unit tests (tape + sinon)
- `database.sql` bootstrap script


1. Database

Create DB then either:

```bash
createdb centaur_medical
psql -U postgres -d centaur_medical -f database.sql
```

This single script creates the full schema, RBAC (including `MEDECIN_URGENCE`), demo users, and 4 sample patients. Demo password for all accounts: **`CentaurDev1`** (see emails in `database.sql` header). Optional: `node scripts/set-local-password-from-env.js` to replace hashes from `SEED_ADMIN_PASSWORD` in `.env`.

Or with knex (tracks migrations in `knex_migrations`):

bash
cp .env.example .env
npm install
npm run build -w shared
npx knex migrate:latest --knexfile knexfile.ts
npx knex seed:run --knexfile knexfile.ts




2. Run services

```bash
npm install
npm run build -w shared
npm run dev


Gateway: http://127.0.0.1:3000

3. Frontend (separate repo)
```bash
cd ../centaur-medical-frontend
npm install
npm run serve
```

Open http://localhost:8084/

## Environment variables

Copier `.env.example` → `.env` à la racine du backend :

```bash
cp .env.example .env


| Variable | Défaut | Description |
|----------|--------|-------------|
| `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` | — | PostgreSQL |
| `JWT_SECRET` | — | Secret JWT (min 32 chars) |
| `JWT_EXPIRES_IN` | `15m` | Durée token ACCESS |
| `SERVICE_TOKEN` | — | Token inter-services (`x-service-token`) |
| `SEED_ADMIN_PASSWORD` | — | Mot de passe des comptes seed (**ne jamais committer**) |
| `GATEWAY_PORT` | `3000` | Port Gateway (public) |
| `AUTH_PORT` | `3001` | Port auth-service (interne) |
| `PATIENT_PORT` | `3002` | Port patient-service (interne) |
| `NOTIFICATION_PORT` | `3003` | Port notification-service (interne) |
| `AUTH_SERVICE_URL` | `http://127.0.0.1:3001` | URL auth (Gateway) |
| `PATIENT_SERVICE_URL` | `http://127.0.0.1:3002` | URL patient (Gateway) |
| `NOTIFICATION_SERVICE_URL` | `http://127.0.0.1:3003` | URL notification (Gateway) |
| `NOTIFICATION_WORKER_INTERVAL_MS` | `5000` | Intervalle worker PENDING → SENT |
| `NOTIFICATION_SSE_HEARTBEAT_MS` | `20000` | Heartbeat SSE |
| `SMTP_*` | — | NodeMailer (MFA, welcome, reset) |
| `FRONTEND_URL` | `http://localhost:8084` | URL frontend |
| `CORS_ORIGIN` | `http://localhost:8084` | Origine CORS autorisée |
| `LISTEN_HOST` | `127.0.0.1` | Bind services internes |
| `GATEWAY_LISTEN_HOST` | `0.0.0.0` | Bind Gateway |
| `ALLOW_DEV_SEED` | — | `1` pour autoriser seed en production |
| `TRUST_PROXY` | — | `1` derrière reverse proxy (rate limit) |


Services 

| Workspace | Port | Rôle |
|-----------|------|------|
| `gateway/` | 3000 | Point d'entrée public, JWT, RBAC, proxy, rate limit, CORS |
| `auth-service/` | 3001 | Login, MFA, JWT, users, roles, permissions |
| `patient-service/` | 3002 | Patients, prescriptions, documents, notes cliniques, historique, audit |
| `notification-service/` | 3003 | Notifications in-app, SSE, worker, emails (NodeMailer) |
| `shared/` | — | Types, DB, middleware, rate limit, permissions |

Commandes racine :

bash
npm run dev              # Tous les services (concurrently)
npm run build -w shared  # Build shared (requis avant dev)
npm test                 # Tests unitaires tous services
npm run test:all         # Unit + intégration tous services


Seed credentials

 accounts for demo

| Email | Role | Auth |
|-------|------|------|
| sedjalkhouloud@gmail.com | ADMIN | MFA |
| lydia.sedjal@gmail.com | DIRECTION | MFA |
| rachasl720@gmail.com | MEDECIN | JWT |
| khouloudsed2@gmail.com | SECRETAIRE | JWT |

Password: lydia2001

MFA / reset codes are emailed when SMTP is configured; otherwise they are printed in the auth-service console (dev only).

API (via Gateway)

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

- `GET|POST /api/patients` *(pagination: `page`, `limit` ; recherche: `search` ; filtre: `service`)*
- `GET|PUT|DELETE /api/patients/:id`
- `GET /api/patients/:id/prescriptions`
- `GET /api/patients/:id/medical-history`
- `GET|POST /api/patients/:id/documents`
- `GET /api/patients/:id/documents/:docId/file`
- `DELETE /api/patients/:id/documents/:docId`
- `GET|POST /api/patients/:id/clinical-notes`
- `GET /api/patients/:id/clinical-notes/:noteId`
- `DELETE /api/patients/:id/clinical-notes/:noteId`
- `GET /api/medical-history` *(pagination + filters: `patientId`, `service`, `type`, `from`, `to`)*
- `GET /api/prescriptions` *(pagination + filters: `patientId`, `service`, `status`, `from`, `to`)*
- `GET /api/prescriptions/:id`
- `POST /api/prescriptions`
- `PATCH /api/prescriptions/:id/cancel`
- `GET /api/dashboard/stats`
- `GET /api/audit-logs`
- `GET /api/notifications` *(pagination + filters: `read`, `status`, `type`, `patientId`)*
- `GET /api/notifications/stream` *(SSE)*
- `GET /api/notifications/:id`
- `POST /api/notifications`
- `PATCH /api/notifications/:id/read`
- `PATCH /api/notifications/:id/cancel`

### Pagination

Toutes les listes paginées acceptent :

| Param | Défaut | Max | Description |
|-------|--------|-----|-------------|
| `page` | `1` | — | Numéro de page (1-indexed) |
| `limit` | `50` | `100` | Nombre d'éléments par page |

Réponse :

```json
{
  "items": [ /* ... */ ],
  "total": 142,
  "page": 1,
  "limit": 50
}
```

Endpoints paginés : `GET /api/patients`, `GET /api/prescriptions`, `GET /api/notifications`, `GET /api/medical-history`.

`GET /api/patients/:id/prescriptions` retourne un **tableau** (toutes les ordonnances du patient, max 100).

Recherche patients : `GET /api/patients?search=cherif` — recherche SQL `ILIKE` sur nom, prénom, code patient (dans tout le périmètre service, pas seulement la page courante).

Documents patient

Permissions :

| Permission | Usage |
|------------|--------|
| `documents:read` | Lister / télécharger |
| `documents:create` | Upload |
| `documents:delete` | Supprimer |

Types : `ECG`, `CARTE_GROUPE` (affiché « Carte de groupage »), `ORDONNANCE`, `AUTRE`.

Upload : `POST /api/patients/:id/documents` (multipart, max 10 Mo, PDF/PNG/JPG).

### Comptes rendus cliniques

Permissions :

| Permission | Usage |
|------------|--------|
| `reports:read` | Lister / consulter |
| `reports:create` | Créer |
| `reports:create` | Supprimer (même permission que création) |

Routes : `GET|POST /api/patients/:id/clinical-notes`, `DELETE /api/patients/:id/clinical-notes/:noteId`.

Prescriptions

Permissions :

| Permission | Usage |
|------------|--------|
| `prescriptions:read` | Lister / consulter |
| `prescriptions:create` | Créer une ordonnance |
| `prescriptions:cancel` | Annuler (soft) |

Rôles seed :

- MEDECIN / ADMIN: read + create + cancel
- DIRECTION / SECRETAIRE : read uniquement

doctorId : est toujours pris depuis le JWT (`x-user-id`)  jamais depuis le body.

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


Erreurs : `400` validation, `403` permission / service, `404` patient ou ordonnance, `409` déjà annulée (ou patient avec ordonnances à la suppression).

Pas de `DELETE` physique sur les ordonnances.

 Medical history

Permission : `medical_history:read` (ADMIN, DIRECTION, MEDECIN, SECRETAIRE).

Distinct des **audit logs** : l’historique est une chronologie médicale immuable (append-only). Pas de POST / PUT / PATCH / DELETE public.

Types : `HOSPITALIZATION`, `CONSULTATION`, `DIAGNOSIS`, `PRESCRIPTION`, `RECORD_UPDATE`.

Événements réellement écrits aujourd’hui :

- `POST /prescriptions` → `PRESCRIPTION` (`Nouvelle ordonnance créée`)
- `PATCH /prescriptions/:id/cancel` → `PRESCRIPTION` (`Ordonnance annulée`) — n’efface pas l’événement de création
- `PUT /patients/:id` → `RECORD_UPDATE` (`Modification du dossier médical`)

La création d’un patient n’émet **pas** `HOSPITALIZATION` (`hospitalization_date` est un champ administratif, pas un séjour).

Notifications (in-app)

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

bash
NOTIFICATION_WORKER_INTERVAL_MS=5000


Tests worker :

bash
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

 JWT `purpose`

Les JWT sont typés par un champ `purpose`. Les routes protégées du gateway exigent strictement `purpose === ACCESS`. Les tokens `MFA`, `PASSWORD_RESET` et `CHANGE_PASSWORD` sont limités à leur endpoint respectif et **ne peuvent pas** être utilisés comme tokens d’accès (`/auth/me`, `/patients`, etc.).

Tests

bash
# Tous les services
npm test
npm run test:all

Par service
npm test -w auth-service
npm test -w patient-service
npm test -w gateway
npm test -w notification-service

Intégration
npm run test:integration -w auth-service
npm run test:integration -w patient-service
npm run test:integration -w gateway
npm run test:integration -w notification-service

Couverture
npm run test:coverage -w auth-service
npm run test:coverage -w patient-service
npm run test:coverage -w gateway
```

Stack : tape (TAP) + sinon + tsx** + c8.

Structure par service

text
auth-service/tests/
├── unit/           # password, OTP, JWT, RBAC, MFA, session, admin guards
└── integration/    # HTTP login/MFA/forgot + service-token

patient-service/tests/
├── unit/           # patient, prescription, documents, clinical-notes, medical-history
├── integration/    # HTTP flows (prescriptions, documents, notes, history)
├── patient.test.ts
└── isolation.test.ts

gateway/tests/
├── unit/           # rate-limit, auth-purpose, gateway helpers
└── integration/    # login, /auth/me, authorization, patient isolation, multipart

notification-service/tests/
├── unit/           # notification CRUD, scheduler, worker, SSE, mailer
├── integration/    # HTTP + worker + business events + SSE
└── e2e/            # isolation, security, SSE, business notifications
```

 Couverture principale

| Service | Fichiers clés |
|---------|---------------|
| **auth-service** | `password-policy`, `otp-security`, `jwt-purpose`, `permissions`, `auth.service`, `session`, `admin-reset`, `service-token.integration` |
| **patient-service** | `patient.service`, `prescription.service`, `documents.service`, `clinical-notes.service`, `medical-history.service`, `isolation.test`, `prescription.integration`, `documents.integration`, `clinical-notes.integration` |
| **gateway** | `rate-limit`, `auth-purpose`, `auth-login`, `auth-me`, `authorization`, `patient-isolation`, `documents-multipart` |
| **notification-service** | `notification.service`, `notification.scheduler`, `notification.worker`, `notification-sse`, `notifications.integration`, `notifications.worker.integration` |

Security notes

 Authentication & authorisation

1. Gateway validates JWT + RBAC + rate-limits auth routes
2. Injects `x-service-token` + identity headers on every proxied request
3. Patient/Auth/Notification services reject calls without a valid service token — including the previously-public auth routes (`/auth/login`, MFA, forgot/reset). This ensures that bypassing the gateway (e.g. direct access to port 3001) is blocked at the service layer as a second line of defence.
4. Passwords hashed with **Argon2id** + shared policy (`assertPasswordPolicy`)
5. MFA / reset OTP stored **hashed** (never plaintext in DB)
6. JWT `purpose` claim restricts token usage per flow — `MFA`, `CHANGE_PASSWORD`, `PASSWORD_RESET` tokens cannot unlock `/auth/me` or `/patients`
7. Weak `JWT_SECRET` / `SERVICE_TOKEN` rejected in production (`NODE_ENV=production`)
8. `service:*` scopes **reads** (`listPatients`, `getPatient` → 403 hors périmètre, dashboard). Search never bypasses the filter.
9. `DELETE /users/:id` refuses self-delete and the last active ADMIN (403). Reset codes lock after 5 attempts (429).



