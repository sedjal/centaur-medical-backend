/**
 * In-memory Knex-like mock for auth.service unit/integration tests.
 */
import { __setTestDb } from '@centaur/shared';

export type Row = Record<string, unknown>;

export interface AuthDbSeed {
  users?: Row[];
  roles?: Row[];
  permissions?: Row[];
  role_permissions?: Row[];
  mfa_codes?: Row[];
  password_reset_tokens?: Row[];
}

const DEFAULT_ROLES: Row[] = [
  { id: 'r-admin', name: 'ADMIN' },
  { id: 'r-med', name: 'MEDECIN' },
  { id: 'r-sec', name: 'SECRETAIRE' },
  { id: 'r-custom', name: 'INFIRMIER' },
];

const DEFAULT_PERMISSIONS: Row[] = [
  { id: 'p-read', code: 'patients:read' },
  { id: 'p-create', code: 'patients:create' },
  { id: 'p-users', code: 'users:read' },
  { id: 'p-manage', code: 'roles:manage' },
];

function cloneSeed(seed: AuthDbSeed): Required<AuthDbSeed> {
  return {
    users: JSON.parse(JSON.stringify(seed.users || [])),
    roles: JSON.parse(JSON.stringify(seed.roles || DEFAULT_ROLES)),
    permissions: JSON.parse(JSON.stringify(seed.permissions || DEFAULT_PERMISSIONS)),
    role_permissions: JSON.parse(JSON.stringify(seed.role_permissions || [])),
    mfa_codes: JSON.parse(JSON.stringify(seed.mfa_codes || [])),
    password_reset_tokens: JSON.parse(JSON.stringify(seed.password_reset_tokens || [])),
  };
}

function tableName(raw: string): string {
  return raw.split(/\s+as\s+/i)[0].trim();
}

function genId(prefix: string, state: Required<AuthDbSeed>): string {
  return `${prefix}-${state.users.length + state.roles.length + 1}`;
}

function matchWhere(row: Row, cond: Record<string, unknown>): boolean {
  return Object.entries(cond).every(([k, v]) => row[k] === v);
}

function buildQuery(state: Required<AuthDbSeed>, rawTable: string) {
  const base = tableName(rawTable);
  let joinedRoles = false;
  let emailFilter: string | null = null;
  let idFilter: string | null = null;
  let roleNameFilter: string | null = null;
  let whereConds: Record<string, unknown>[] = [];
  let whereNullCol: string | null = null;
  let whereNot: { col: string; val: unknown } | null = null;
  let whereIn: { col: string; vals: unknown[] } | null = null;
  let orderCol: string | null = null;
  let orderDir: 'asc' | 'desc' = 'asc';
  let pendingInsert: Row | Row[] | null = null;
  let pendingUpdate: Row | null = null;
  let pendingDelete = false;
  let countMode = false;
  let groupCol: string | null = null;
  let returningCols: string[] | null = null;
  let limitFirst = false;

  const api = {
    join(_t: string, _a: string, _b: string) {
      if (base === 'users') joinedRoles = true;
      if (base === 'role_permissions') joinedRoles = true;
      return api;
    },
    whereRaw(sql: string, bindings: unknown[]) {
      if (sql.includes('LOWER(u.email)')) emailFilter = String(bindings[0]).toLowerCase();
      return api;
    },
    where(cond: Record<string, unknown> | ((this: unknown) => void)) {
      if (typeof cond === 'function') return api;
      whereConds.push(cond);
      if ('id' in cond && typeof cond.id === 'string') idFilter = cond.id;
      if ('user_id' in cond && cond.user_id) idFilter = String(cond.user_id);
      return api;
    },
    whereNull(col: string) {
      whereNullCol = col;
      return api;
    },
    whereNot(col: string, val: unknown) {
      whereNot = { col, val };
      return api;
    },
    whereIn(col: string, vals: unknown[]) {
      whereIn = { col, vals };
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
    del() {
      pendingDelete = true;
      return api;
    },
    count(_alias?: string) {
      countMode = true;
      return api;
    },
    groupBy(col: string) {
      groupCol = col;
      return api;
    },
    returning(cols: string[]) {
      returningCols = cols;
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

  function usersJoined(): Row[] {
    return state.users.map((u) => {
      const role = state.roles.find((r) => r.id === u.role_id);
      return {
        ...u,
        role_name: role?.name,
        role: role?.name,
      };
    });
  }

  function filterRows(rows: Row[]): Row[] {
    let out = [...rows];
    if (emailFilter) {
      out = out.filter((r) => String(r.email || '').toLowerCase() === emailFilter);
    }
    if (idFilter) {
      out = out.filter((r) => r.id === idFilter || r.user_id === idFilter);
    }
    if (roleNameFilter) {
      out = out.filter((r) => r.role_name === roleNameFilter || r.name === roleNameFilter);
    }
    for (const cond of whereConds) {
      out = out.filter((r) => matchWhere(r, cond));
    }
    if (whereNullCol) {
      out = out.filter((r) => r[whereNullCol!] == null);
    }
    if (whereNot) {
      out = out.filter((r) => r[whereNot!.col] !== whereNot!.val);
    }
    if (whereIn) {
      out = out.filter((r) => whereIn!.vals.includes(r[whereIn!.col]));
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
    if (pendingInsert) {
      const rows = Array.isArray(pendingInsert) ? pendingInsert : [pendingInsert];
      const target =
        base === 'users'
          ? state.users
          : base === 'roles'
            ? state.roles
            : base === 'mfa_codes'
              ? state.mfa_codes
              : base === 'password_reset_tokens'
                ? state.password_reset_tokens
                : base === 'role_permissions'
                  ? state.role_permissions
                  : state.permissions;
      const inserted = rows.map((r) => {
        const row = { id: genId(base, state), ...r };
        target.push(row);
        return row;
      });
      pendingInsert = null;
      if (returningCols) {
        return Promise.resolve(
          inserted.map((r) =>
            Object.fromEntries(returningCols!.map((c) => [c, r[c]]))
          )
        );
      }
      return Promise.resolve(inserted.length);
    }

    if (pendingUpdate) {
      const target =
        base === 'users'
          ? state.users
          : base === 'mfa_codes'
            ? state.mfa_codes
            : base === 'password_reset_tokens'
              ? state.password_reset_tokens
              : state.users;
      let n = 0;
      for (const row of target) {
        if (whereConds.every((c) => matchWhere(row, c))) {
          Object.assign(row, pendingUpdate);
          if (pendingUpdate.used_at && typeof pendingUpdate.used_at === 'object') {
            row.used_at = new Date().toISOString();
          }
          n++;
        }
      }
      pendingUpdate = null;
      return Promise.resolve(n);
    }

    if (pendingDelete) {
      if (base === 'users') {
        const before = state.users.length;
        state.users = state.users.filter((r) => !whereConds.every((c) => matchWhere(r, c)));
        pendingDelete = false;
        return Promise.resolve(before - state.users.length);
      }
      if (base === 'roles') {
        const before = state.roles.length;
        state.roles = state.roles.filter((r) => !whereConds.every((c) => matchWhere(r, c)));
        pendingDelete = false;
        return Promise.resolve(before - state.roles.length);
      }
      if (base === 'role_permissions') {
        const before = state.role_permissions.length;
        state.role_permissions = state.role_permissions.filter(
          (r) => !whereConds.every((c) => matchWhere(r, c))
        );
        pendingDelete = false;
        return Promise.resolve(before - state.role_permissions.length);
      }
    }

    if (base === 'users' && joinedRoles) {
      let rows = filterRows(usersJoined());
      if (countMode) return Promise.resolve([{ count: String(rows.length) }]);
      if (limitFirst) return Promise.resolve(rows[0] || null);
      return Promise.resolve(rows);
    }

    if (base === 'role_permissions') {
      const links = state.role_permissions.map((rp) => {
        const role = state.roles.find((r) => r.id === rp.role_id);
        const perm = state.permissions.find((p) => p.id === rp.permission_id);
        return { role_id: rp.role_id, code: perm?.code, 'r.name': role?.name };
      });
      let rows = links;
      if (roleNameFilter) rows = rows.filter((r) => r['r.name'] === roleNameFilter);
      const roleCond = whereConds.find((c) => 'r.name' in c);
      if (roleCond) {
        rows = rows.filter((r) => r['r.name'] === roleCond['r.name']);
      }
      return Promise.resolve(rows.map((r) => ({ code: r.code })));
    }

    if (base === 'users') {
      let rows = filterRows(state.users);
      if (countMode && groupCol) {
        const map = new Map<string, number>();
        for (const r of rows) {
          const k = String(r[groupCol!]);
          map.set(k, (map.get(k) || 0) + 1);
        }
        return Promise.resolve([...map.entries()].map(([role_id, count]) => ({ role_id, count: String(count) })));
      }
      if (countMode && limitFirst) return Promise.resolve({ count: String(rows.length) });
      if (countMode) return Promise.resolve([{ count: String(rows.length) }]);
      if (limitFirst) return Promise.resolve(rows[0] || null);
      return Promise.resolve(
        rows.map((u) => {
          const role = state.roles.find((r) => r.id === u.role_id);
          return { ...u, role: role?.name };
        })
      );
    }

    if (base === 'roles') {
      let rows = filterRows(state.roles);
      if (limitFirst) return Promise.resolve(rows[0] || null);
      return Promise.resolve(rows);
    }

    if (base === 'permissions') {
      let rows = filterRows(state.permissions);
      if (whereIn) {
        rows = rows.filter((r) => whereIn!.vals.includes(r.code));
      }
      return Promise.resolve(rows);
    }

    if (base === 'mfa_codes') {
      let rows = filterRows(state.mfa_codes);
      if (limitFirst) return Promise.resolve(rows[0] || null);
      return Promise.resolve(rows);
    }

    if (base === 'password_reset_tokens') {
      let rows = filterRows(state.password_reset_tokens);
      if (limitFirst) return Promise.resolve(rows[0] || null);
      return Promise.resolve(rows);
    }

    if (base === 'role_permissions' && pendingDelete) {
      /* handled above */
    }

    return Promise.resolve(limitFirst ? null : []);
  }

  // allow .where('r.name', roleName) two-arg form via patched where
  const origWhere = api.where;
  api.where = (cond: Record<string, unknown> | string, val?: unknown) => {
    if (typeof cond === 'string') {
      if (cond === 'r.name') roleNameFilter = String(val);
      if (cond === 'u.id') idFilter = String(val);
      if (cond === 'u.is_active') {
        whereConds.push({ is_active: val });
      }
      return api;
    }
    return origWhere(cond);
  };

  return api;
}

export function installAuthDbMock(seed: AuthDbSeed = {}) {
  const state = cloneSeed(seed);
  const fn = { now: () => new Date() };

  const db = Object.assign(
    (name: string) => buildQuery(state, name),
    {
      table: (name: string) => buildQuery(state, name),
      fn,
      transaction: async (cb: (trx: typeof db) => Promise<void>) => cb(db),
    }
  );

  __setTestDb(db as never);
  return { state, db };
}

export function restoreAuthDbMock(): void {
  __setTestDb(null);
}
