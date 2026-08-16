/**
 * In-memory DB mock for notification-service unit/integration tests.
 */
import { __setTestDb } from '@centaur/shared';

export type Row = Record<string, unknown>;

export interface NotifDbState {
  users: Row[];
  patients: Row[];
  notifications: Row[];
  email_notifications: Row[];
  audit_logs: Row[];
  roles: Row[];
  permissions: Row[];
  role_permissions: Row[];
  prescriptions: Row[];
  prescription_items: Row[];
  medical_history: Row[];
  medical_records: Row[];
  emergency_records: Row[];
  oncology_records: Row[];
  cardiology_records: Row[];
  general_records: Row[];
}

let seq = 0;
function genId(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq}`;
}

export function defaultNotifSeed(): Partial<NotifDbState> {
  return {
    users: [
      {
        id: 'u-med',
        email: 'med@test.com',
        first_name: 'Léa',
        last_name: 'Urg',
        is_active: true,
        role_name: 'MEDECIN',
        session_version: 1,
      },
      {
        id: 'u-sec',
        email: 'sec@test.com',
        first_name: 'Sam',
        last_name: 'Sec',
        is_active: true,
        role_name: 'SECRETAIRE',
        session_version: 1,
      },
      {
        id: 'u-admin',
        email: 'admin@test.com',
        first_name: 'Ada',
        last_name: 'Min',
        is_active: true,
        role_name: 'ADMIN',
        session_version: 1,
      },
    ],
    patients: [
      {
        id: 'p-urg-1',
        patient_code: 'PT-000124',
        first_name: 'Ahmed',
        last_name: 'Benali',
        service: 'URGENCE',
        status: 'STABLE',
      },
      {
        id: 'p-cardio-1',
        patient_code: 'PT-000126',
        first_name: 'Karim',
        last_name: 'Haddad',
        service: 'CARDIOLOGIE',
        status: 'STABLE',
      },
    ],
    notifications: [],
    email_notifications: [],
    audit_logs: [],
    roles: [],
    permissions: [],
    role_permissions: [],
    prescriptions: [],
    prescription_items: [],
    medical_history: [],
    medical_records: [],
    emergency_records: [],
    oncology_records: [],
    cardiology_records: [],
    general_records: [],
  };
}

type StateKey = keyof NotifDbState;

export interface NotifDbMockOptions {
  /** Simulate a per-row UPDATE failure (worker error isolation). */
  failUpdateOn?: string;
}

function matchWhere(row: Row, cond: Record<string, unknown>): boolean {
  return Object.entries(cond).every(([k, v]) => row[k] === v);
}

function compareOp(left: unknown, op: string, val: unknown): boolean {
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
}

export function installNotifDbMock(
  seed: Partial<NotifDbState> = {},
  options: NotifDbMockOptions = {}
) {
  const fallback = defaultNotifSeed();
  const state: NotifDbState = {
    users: [...(seed.users || fallback.users || [])],
    patients: [...(seed.patients || fallback.patients || [])],
    notifications: [...(seed.notifications || [])],
    email_notifications: [...(seed.email_notifications || [])],
    audit_logs: [...(seed.audit_logs || [])],
    roles: [...(seed.roles || [])],
    permissions: [...(seed.permissions || [])],
    role_permissions: [...(seed.role_permissions || [])],
    prescriptions: [...(seed.prescriptions || [])],
    prescription_items: [...(seed.prescription_items || [])],
    medical_history: [...(seed.medical_history || [])],
    medical_records: [...(seed.medical_records || [])],
    emergency_records: [...(seed.emergency_records || [])],
    oncology_records: [...(seed.oncology_records || [])],
    cardiology_records: [...(seed.cardiology_records || [])],
    general_records: [...(seed.general_records || [])],
  };

  function table(name: string) {
    const key = name as StateKey;
    let whereConds: Record<string, unknown>[] = [];
    let whereOps: { col: string; op: string; val: unknown }[] = [];
    let whereNotNullCols: string[] = [];
    let whereInFilter: { col: string; vals: unknown[] } | null = null;
    let orderCol: string | null = null;
    let orderDir: 'asc' | 'desc' = 'asc';
    let pendingInsert: Row | Row[] | null = null;
    let pendingUpdate: Row | null = null;
    let pendingDelete = false;
    let returningCols: string[] | null = null;
    let limitFirst = false;
    let limitN: number | null = null;
    let countMode = false;
    let countAlias: string | null = null;

    const api = {
      where(cond: Record<string, unknown> | string, op?: string, val?: unknown) {
        if (typeof cond === 'string' && op !== undefined && val === undefined) {
          whereConds.push({ [cond]: op });
          return api;
        }
        if (typeof cond === 'string' && op != null && val !== undefined) {
          whereOps.push({ col: cond, op, val });
          return api;
        }
        if (typeof cond === 'object' && cond) whereConds.push(cond);
        return api;
      },
      andWhere(cond: Record<string, unknown> | string, op?: string, val?: unknown) {
        return api.where(cond, op, val);
      },
      whereNotNull(col: string) {
        whereNotNullCols.push(col);
        return api;
      },
      whereIn(col: string, vals: unknown[]) {
        whereInFilter = { col, vals };
        return api;
      },
      select(..._cols: string[]) {
        return api;
      },
      orderBy(col: string, dir?: string) {
        orderCol = col;
        orderDir = dir === 'desc' ? 'desc' : 'asc';
        return api;
      },
      limit(n: number) {
        limitN = n;
        return api;
      },
      forUpdate() {
        return api;
      },
      skipLocked() {
        return api;
      },
      insert(row: Row | Row[]) {
        pendingInsert = row;
        return api;
      },
      update(patch: Row) {
        pendingUpdate = patch;
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
        out = out.filter((r) => compareOp(r[col], op, val));
      }
      for (const col of whereNotNullCols) {
        out = out.filter((r) => r[col] != null);
      }
      if (whereInFilter) {
        out = out.filter((r) => whereInFilter!.vals.includes(r[whereInFilter!.col]));
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

    function exec(): Promise<unknown> {
      if (pendingInsert && key in state) {
        const rows = Array.isArray(pendingInsert) ? pendingInsert : [pendingInsert];
        const target = state[key];
        const inserted = rows.map((r) => {
          const now = new Date().toISOString();
          const row: Row = {
            ...r,
            id: r.id ?? genId(name.slice(0, 2)),
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
          return Promise.resolve(mapped);
        }
        return Promise.resolve(inserted.length);
      }

      if (pendingUpdate && key in state) {
        const target = state[key];
        const updatedRows: Row[] = [];
        for (const row of target) {
          const byCond = whereConds.every((c) => matchWhere(row, c));
          const byOps = whereOps.every(({ col, op, val }) => compareOp(row[col], op, val));
          if (byCond && byOps) {
            if (options.failUpdateOn && String(row.id) === options.failUpdateOn) {
              return Promise.reject(new Error('simulated update failure'));
            }
            Object.assign(row, pendingUpdate);
            updatedRows.push({ ...row });
          }
        }
        pendingUpdate = null;
        if (returningCols) {
          const mapped = updatedRows.map((r) =>
            returningCols![0] === '*'
              ? { ...r }
              : Object.fromEntries(returningCols!.map((c) => [c, r[c]]))
          );
          return Promise.resolve(mapped);
        }
        return Promise.resolve(updatedRows.length);
      }

      if (pendingDelete && key in state) {
        const target = state[key];
        const kept = target.filter((r) => !whereConds.every((c) => matchWhere(r, c)));
        const n = target.length - kept.length;
        state[key] = kept;
        pendingDelete = false;
        return Promise.resolve(n);
      }

      if (key in state) {
        const rows = filterRows(state[key]);
        if (countMode) {
          const col = countAlias?.includes(' as ')
            ? countAlias.split(/\s+as\s+/i)[1].trim()
            : 'count';
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

  const nowFn = { now: () => new Date().toISOString() };
  const bind = Object.assign((name: string) => table(name), { fn: nowFn });
  const db = Object.assign(bind, {
    transaction: async (fn: (trx: typeof bind) => Promise<unknown>) => fn(bind),
  });

  __setTestDb(db);
  return { state, db };
}

export function restoreNotifDbMock() {
  __setTestDb(null as never);
}
