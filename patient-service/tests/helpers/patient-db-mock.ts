/**
 * In-memory Knex-like mock for patient.service unit/integration tests.
 * Reuses shared __setTestDb() — same hook as auth-service tests.
 */
import { __setTestDb } from '@centaur/shared';

export type Row = Record<string, unknown>;

export interface PatientDbSeed {
  patients?: Row[];
  medical_records?: Row[];
  emergency_records?: Row[];
  oncology_records?: Row[];
  cardiology_records?: Row[];
  general_records?: Row[];
  prescriptions?: Row[];
  prescription_items?: Row[];
  medical_history?: Row[];
  audit_logs?: Row[];
  users?: Row[];
}

type PatientDbState = Required<PatientDbSeed>;

const TABLE_KEYS: (keyof PatientDbState)[] = [
  'patients',
  'medical_records',
  'emergency_records',
  'oncology_records',
  'cardiology_records',
  'general_records',
  'prescriptions',
  'prescription_items',
  'medical_history',
  'audit_logs',
  'users',
];

function cloneSeed(seed: PatientDbSeed): PatientDbState {
  const out = {} as PatientDbState;
  for (const key of TABLE_KEYS) {
    out[key] = JSON.parse(JSON.stringify(seed[key] || []));
  }
  return out;
}

/** Seed aligned with database/seeds/001_initial.js (+ Ahmed CARDIO for future search tests). */
export function defaultPatientSeed(): PatientDbSeed {
  return {
    patients: [
      {
        id: 'p-urg-1',
        patient_code: 'PT-000124',
        first_name: 'Ahmed',
        last_name: 'Benali',
        hospitalization_date: '2026-08-11',
        service: 'URGENCE',
        status: 'CRITICAL',
        created_at: '2026-08-11T10:00:00Z',
      },
      {
        id: 'p-onco-1',
        patient_code: 'PT-000125',
        first_name: 'Sarah',
        last_name: 'Amara',
        hospitalization_date: '2026-08-10',
        service: 'ONCOLOGIE',
        status: 'STABLE',
        created_at: '2026-08-10T10:00:00Z',
      },
      {
        id: 'p-cardio-1',
        patient_code: 'PT-000126',
        first_name: 'Karim',
        last_name: 'Haddad',
        hospitalization_date: '2026-08-09',
        service: 'CARDIOLOGIE',
        status: 'STABLE',
        created_at: '2026-08-09T10:00:00Z',
      },
      {
        id: 'p-gen-1',
        patient_code: 'PT-000127',
        first_name: 'Nadia',
        last_name: 'Cherif',
        hospitalization_date: '2026-08-08',
        service: 'GENERAL',
        status: 'STABLE',
        created_at: '2026-08-08T10:00:00Z',
      },
      {
        id: 'p-cardio-2',
        patient_code: 'PT-000199',
        first_name: 'Ahmed',
        last_name: 'Kaci',
        hospitalization_date: '2026-08-10',
        service: 'CARDIOLOGIE',
        status: 'STABLE',
        created_at: '2026-08-10T10:00:00Z',
      },
    ],
    medical_records: [
      { id: 'mr-1', patient_id: 'p-urg-1', service: 'URGENCE' },
      { id: 'mr-2', patient_id: 'p-onco-1', service: 'ONCOLOGIE' },
      { id: 'mr-3', patient_id: 'p-cardio-1', service: 'CARDIOLOGIE' },
      { id: 'mr-4', patient_id: 'p-gen-1', service: 'GENERAL' },
      { id: 'mr-5', patient_id: 'p-cardio-2', service: 'CARDIOLOGIE' },
    ],
    emergency_records: [
      {
        id: 'er-1',
        medical_record_id: 'mr-1',
        arrival_time: '14:30:00',
        triage_level: '1',
        initial_severity: 'Critical',
      },
    ],
    oncology_records: [
      {
        id: 'or-1',
        medical_record_id: 'mr-2',
        tumor_type: 'Breast carcinoma',
        stage: 'II',
        current_treatment: 'Chemotherapy',
      },
    ],
    cardiology_records: [
      {
        id: 'cr-1',
        medical_record_id: 'mr-3',
        ecg_results: 'Sinus rhythm',
        resting_heart_rate: 72,
        blood_pressure: '120/80',
      },
      {
        id: 'cr-2',
        medical_record_id: 'mr-5',
        ecg_results: 'Normal',
        resting_heart_rate: 68,
        blood_pressure: '118/76',
      },
    ],
    general_records: [
      { id: 'gr-1', medical_record_id: 'mr-4', notes: 'Post-operative follow-up' },
    ],
    prescriptions: [],
    prescription_items: [],
    medical_history: [],
    audit_logs: [],
    users: [
      {
        id: 'u-urg',
        email: 'urg@test.com',
        first_name: 'Léa',
        last_name: 'Urg',
      },
      {
        id: 'u-test',
        email: 'test@test.com',
        first_name: 'Test',
        last_name: 'User',
      },
    ],
  };
}

function tableName(raw: string): string {
  return raw.split(/\s+as\s+/i)[0].trim();
}

function tableAlias(raw: string): string | null {
  const parts = raw.split(/\s+as\s+/i);
  return parts.length > 1 ? parts[1].trim() : null;
}

function stateKey(base: string): keyof PatientDbState | null {
  if (TABLE_KEYS.includes(base as keyof PatientDbState)) {
    return base as keyof PatientDbState;
  }
  return null;
}

function ilikeMatch(value: unknown, pattern: string): boolean {
  const needle = pattern.replace(/%/g, '').toLowerCase();
  return String(value ?? '').toLowerCase().includes(needle);
}

function matchWhere(row: Row, cond: Record<string, unknown>): boolean {
  return Object.entries(cond).every(([k, v]) => row[k] === v);
}

function genId(prefix: string, state: PatientDbState): string {
  const total = TABLE_KEYS.reduce((n, k) => n + state[k].length, 0);
  return `${prefix}-${total + 1}`;
}

export interface PatientDbMockOptions {
  /** Throw on insert into this table (for rollback tests). */
  failInsertOn?: string;
}

function snapshotState(state: PatientDbState): PatientDbState {
  return cloneSeed(state as unknown as PatientDbSeed) as PatientDbState;
}

function restoreState(state: PatientDbState, snapshot: PatientDbState): void {
  for (const key of TABLE_KEYS) {
    state[key] = snapshot[key];
  }
}

function cascadeDeletePatient(state: PatientDbState, patientIds: string[]): void {
  const hasRx = state.prescriptions.some((p) => patientIds.includes(String(p.patient_id)));
  if (hasRx) {
    throw new Error('FK RESTRICT: cannot delete patient with prescriptions');
  }
  state.medical_history = state.medical_history.filter(
    (h) => !patientIds.includes(String(h.patient_id))
  );
  const mrIds = state.medical_records
    .filter((mr) => patientIds.includes(String(mr.patient_id)))
    .map((mr) => String(mr.id));
  state.patients = state.patients.filter((p) => !patientIds.includes(String(p.id)));
  state.medical_records = state.medical_records.filter(
    (mr) => !patientIds.includes(String(mr.patient_id))
  );
  for (const table of [
    'general_records',
    'emergency_records',
    'oncology_records',
    'cardiology_records',
  ] as const) {
    state[table] = state[table].filter((r) => !mrIds.includes(String(r.medical_record_id)));
  }
}

function buildQuery(state: PatientDbState, rawTable: string, options: PatientDbMockOptions = {}) {
  const base = tableName(rawTable);
  const alias = tableAlias(rawTable);
  const key = stateKey(base);

  let joinedUsers = false;
  let joinLeft = '';
  let joinRight = '';
  let selectCols: string[] = [];
  let whereOps: { col: string; op: string; val: unknown }[] = [];
  let whereConds: Record<string, unknown>[] = [];
  let orIlikeGroup: { col: string; pattern: string }[] = [];
  let whereInFilter: { col: string; vals: unknown[] } | null = null;
  let orderCol: string | null = null;
  let orderDir: 'asc' | 'desc' = 'asc';
  let limitN: number | null = null;
  let limitFirst = false;
  let countMode = false;
  let countAlias: string | null = null;
  let pendingInsert: Row | Row[] | null = null;
  let pendingUpdate: Row | null = null;
  let pendingDelete = false;
  let returningCols: string[] | null = null;

  const api = {
    join(_t: string, left: string, right: string) {
      joinedUsers = base === 'audit_logs' || alias === 'a';
      joinLeft = left;
      joinRight = right;
      return api;
    },
    leftJoin(_t: string, left: string, right: string) {
      joinedUsers = base === 'audit_logs' || alias === 'a';
      joinLeft = left;
      joinRight = right;
      return api;
    },
    where(cond: Record<string, unknown> | string | ((this: unknown) => void), op?: string, val?: unknown) {
      if (typeof cond === 'string' && op != null && val !== undefined) {
        whereOps.push({ col: cond, op, val });
        return api;
      }
      if (typeof cond === 'string' && op !== undefined && val === undefined) {
        whereConds.push({ [cond]: op });
        return api;
      }
      if (typeof cond === 'function') {
        const group: { col: string; pattern: string }[] = [];
        const sub = {
          whereILike(col: string, pattern: string) {
            group.push({ col, pattern });
            return sub;
          },
          orWhereILike(col: string, pattern: string) {
            group.push({ col, pattern });
            return sub;
          },
        };
        cond.call(sub);
        orIlikeGroup = group;
        return api;
      }
      if (typeof cond === 'object' && cond) {
        whereConds.push(cond);
      }
      return api;
    },
    whereIn(col: string, vals: unknown[]) {
      whereInFilter = { col, vals };
      return api;
    },
    whereILike(col: string, pattern: string) {
      orIlikeGroup = [{ col, pattern }];
      return api;
    },
    orWhereILike(col: string, pattern: string) {
      orIlikeGroup.push({ col, pattern });
      return api;
    },
    select(...cols: string[]) {
      selectCols = cols;
      return api;
    },
    orderBy(col: string, dir?: string) {
      orderCol = col.includes('.') ? col.split('.').pop()! : col;
      orderDir = dir === 'desc' ? 'desc' : 'asc';
      return api;
    },
    limit(n: number) {
      limitN = n;
      return api;
    },
    insert(row: Row | Row[]) {
      pendingInsert = row;
      return api;
    },
    update(patch: Row) {
      pendingUpdate = patch;
      if (patch.updated_at && typeof patch.updated_at === 'object') {
        pendingUpdate = { ...patch, updated_at: new Date().toISOString() };
      }
      return api;
    },
    del() {
      pendingDelete = true;
      return api;
    },
    count(alias?: string) {
      countMode = true;
      countAlias = alias || null;
      return api;
    },
    returning(cols: string[] | string) {
      returningCols = Array.isArray(cols) ? cols : [cols];
      return api;
    },
    first() {
      limitFirst = true;
      return exec();
    },
    then(resolve: (v: unknown) => void, reject?: (e: unknown) => void) {
      return exec().then(resolve, reject);
    },
  };

  function filterRows(rows: Row[]): Row[] {
    let out = [...rows];
    for (const cond of whereConds) {
      out = out.filter((r) => matchWhere(r, cond));
    }
    for (const { col, op, val } of whereOps) {
      out = out.filter((r) => {
        const left = r[col];
        const lv = Date.parse(String(left));
        const rv = Date.parse(String(val));
        const comparable = !Number.isNaN(lv) && !Number.isNaN(rv);
        const a = comparable ? lv : String(left ?? '');
        const b = comparable ? rv : String(val ?? '');
        if (op === '>=') return a >= b;
        if (op === '<=') return a <= b;
        if (op === '>') return a > b;
        if (op === '<') return a < b;
        if (op === '!=') return a !== b;
        return a === b;
      });
    }
    if (whereInFilter) {
      out = out.filter((r) => whereInFilter!.vals.includes(r[whereInFilter!.col]));
    }
    if (orIlikeGroup.length) {
      out = out.filter((r) =>
        orIlikeGroup.some(({ col, pattern }) => ilikeMatch(r[col], pattern))
      );
    }
    if (orderCol) {
      out.sort((a, b) => {
        const av = String(a[orderCol!] ?? '');
        const bv = String(b[orderCol!] ?? '');
        return orderDir === 'desc' ? bv.localeCompare(av) : av.localeCompare(bv);
      });
    }
    if (limitN != null) {
      out = out.slice(0, limitN);
    }
    return out;
  }

  function auditJoinedRows(): Row[] {
    return state.audit_logs.map((a) => {
      const userId = a.user_id;
      const user = state.users.find((u) => u.id === userId);
      return {
        id: a.id,
        action: a.action,
        resource: a.resource,
        resource_id: a.resource_id,
        patient_name: a.patient_name,
        ip_address: a.ip_address,
        created_at: a.created_at,
        user_email: user?.email,
        user_first_name: user?.first_name,
        user_last_name: user?.last_name,
      };
    });
  }

  function exec(): Promise<unknown> {
    if (pendingInsert && key) {
      if (options.failInsertOn === base) {
        pendingInsert = null;
        return Promise.reject(new Error(`Mock insert failed on ${base}`));
      }
      const rows = Array.isArray(pendingInsert) ? pendingInsert : [pendingInsert];
      const target = state[key];
      const inserted = rows.map((r) => {
        const now = new Date().toISOString();
        const row: Row = {
          ...r,
          id: r.id ?? genId(base.slice(0, 2), state),
          created_at: r.created_at ?? now,
          updated_at: r.updated_at ?? now,
        };
        target.push(row);
        return row;
      });
      pendingInsert = null;
      if (returningCols) {
        const mapped = inserted.map((r) =>
          returningCols![0] === '*'
            ? { ...r }
            : Object.fromEntries(returningCols!.map((c) => [c, r[c]]))
        );
        return Promise.resolve(returningCols.length === 1 && mapped.length === 1 ? mapped : mapped);
      }
      return Promise.resolve(inserted.length);
    }

    if (pendingUpdate && key) {
      const target = state[key];
      let n = 0;
      for (const row of target) {
        if (whereConds.every((c) => matchWhere(row, c))) {
          Object.assign(row, pendingUpdate);
          n++;
        }
      }
      pendingUpdate = null;
      return Promise.resolve(n);
    }

    if (pendingDelete && key) {
      if (key === 'patients') {
        const toDelete = state.patients.filter((r) => whereConds.every((c) => matchWhere(r, c)));
        const ids = toDelete.map((p) => String(p.id));
        cascadeDeletePatient(state, ids);
        pendingDelete = false;
        return Promise.resolve(ids.length);
      }
      const target = state[key];
      const before = target.length;
      const kept = target.filter((r) => !whereConds.every((c) => matchWhere(r, c)));
      state[key] = kept;
      pendingDelete = false;
      return Promise.resolve(before - kept.length);
    }

    if ((base === 'audit_logs' || alias === 'a') && joinedUsers) {
      let rows = filterRows(auditJoinedRows());
      if (countMode) {
        const payload = countAlias ? { [countAlias.replace(/\s+as\s+.*/i, '').trim()]: String(rows.length) } : { count: String(rows.length) };
        return Promise.resolve(limitFirst ? payload : [payload]);
      }
      if (limitFirst) return Promise.resolve(rows[0] || null);
      return Promise.resolve(rows);
    }

    if (key) {
      let rows = filterRows(state[key]);
      if (countMode) {
        const col = countAlias?.includes(' as ') ? countAlias.split(/\s+as\s+/i)[1].trim() : 'count';
        const payload = { [col]: String(rows.length) };
        return Promise.resolve(limitFirst ? payload : [payload]);
      }
      if (limitFirst) return Promise.resolve(rows[0] || null);
      return Promise.resolve(rows);
    }

    return Promise.resolve(limitFirst ? null : []);
  }

  return api;
}

export function installPatientDbMock(
  seed: PatientDbSeed = defaultPatientSeed(),
  options: PatientDbMockOptions = {}
) {
  const state = cloneSeed(seed);
  const fn = { now: () => new Date() };

  const db = Object.assign(
    (name: string) => buildQuery(state, name, options),
    {
      table: (name: string) => buildQuery(state, name, options),
      fn,
      transaction: async <T>(cb: (trx: typeof db) => Promise<T>): Promise<T> => {
        const snap = snapshotState(state);
        try {
          return await cb(db);
        } catch (err) {
          restoreState(state, snap);
          throw err;
        }
      },
    }
  );

  __setTestDb(db as never);
  return { state, db, options };
}

export function restorePatientDbMock(): void {
  __setTestDb(null);
}
