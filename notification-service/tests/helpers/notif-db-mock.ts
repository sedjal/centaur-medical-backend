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
      },
      {
        id: 'u-sec',
        email: 'sec@test.com',
        first_name: 'Sam',
        last_name: 'Sec',
      },
      {
        id: 'u-admin',
        email: 'admin@test.com',
        first_name: 'Ada',
        last_name: 'Min',
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
  };
}

type StateKey = keyof NotifDbState;

function matchWhere(row: Row, cond: Record<string, unknown>): boolean {
  return Object.entries(cond).every(([k, v]) => row[k] === v);
}

export function installNotifDbMock(seed: Partial<NotifDbState> = {}) {
  const state: NotifDbState = {
    users: [],
    patients: [],
    notifications: [],
    email_notifications: [],
    audit_logs: [],
    ...seed,
    users: [...(seed.users || defaultNotifSeed().users || [])],
    patients: [...(seed.patients || defaultNotifSeed().patients || [])],
    notifications: [...(seed.notifications || [])],
    email_notifications: [...(seed.email_notifications || [])],
    audit_logs: [...(seed.audit_logs || [])],
  };

  function table(name: string) {
    const key = name as StateKey;
    let whereConds: Record<string, unknown>[] = [];
    let whereInFilter: { col: string; vals: unknown[] } | null = null;
    let orderCol: string | null = null;
    let orderDir: 'asc' | 'desc' = 'asc';
    let pendingInsert: Row | Row[] | null = null;
    let pendingUpdate: Row | null = null;
    let returningCols: string[] | null = null;
    let limitFirst = false;

    const api = {
      where(cond: Record<string, unknown> | string, op?: string, val?: unknown) {
        if (typeof cond === 'string' && op !== undefined && val === undefined) {
          whereConds.push({ [cond]: op });
          return api;
        }
        if (typeof cond === 'string' && op != null && val !== undefined) {
          // equality via 3-arg not used much
          whereConds.push({ [cond]: val });
          return api;
        }
        if (typeof cond === 'object' && cond) whereConds.push(cond);
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
      insert(row: Row | Row[]) {
        pendingInsert = row;
        return api;
      },
      update(patch: Row) {
        pendingUpdate = patch;
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

      if (key in state) {
        const rows = filterRows(state[key]);
        if (limitFirst) return Promise.resolve(rows[0] || null);
        return Promise.resolve(rows);
      }
      return Promise.resolve(limitFirst ? null : []);
    }

    return api;
  }

  const db: any = (name: string) => table(name);
  db.transaction = async (fn: (trx: any) => Promise<unknown>) => {
    const trx: any = (name: string) => table(name);
    trx.fn = { now: () => new Date().toISOString() };
    return fn(trx);
  };
  db.fn = { now: () => new Date().toISOString() };

  __setTestDb(db);
  return { state, db };
}

export function restoreNotifDbMock() {
  __setTestDb(null as never);
}
