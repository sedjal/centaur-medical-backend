import {
  AppError,
  ROLE_PERMISSIONS,
  SERVICE_PERMISSION_MAP,
  getDb,
  type Permission,
  type ServiceType,
} from '@centaur/shared';
import {
  createInternalNotification,
  type NotificationDto,
  type NotificationType,
} from './notification.service';

export const BUSINESS_EVENT_KINDS = [
  'PRESCRIPTION_CREATED',
  'PRESCRIPTION_CANCELLED',
  'PATIENT_CREATED',
  'PATIENT_UPDATED',
  'MEDICAL_HISTORY_RECORDED',
] as const;

export type BusinessEventKind = (typeof BUSINESS_EVENT_KINDS)[number];

export interface BusinessNotificationEvent {
  kind: BusinessEventKind;
  actorId: string;
  patientId: string;
  patientCode?: string;
  patientName?: string;
  service: ServiceType;
  ip?: string;
}

export interface DispatchBusinessResult {
  created: number;
  skipped: number;
  failed: number;
  recipientIds: string[];
}

const SERVICE_LABEL: Record<ServiceType, string> = {
  GENERAL: 'chirurgie générale',
  URGENCE: 'urgences',
  ONCOLOGIE: 'oncologie',
  CARDIOLOGIE: 'cardiologie',
};

const MAX_RECIPIENTS = 80;

export function isBusinessEventKind(value: string): value is BusinessEventKind {
  return (BUSINESS_EVENT_KINDS as readonly string[]).includes(value);
}

export function requiredDomainPermission(kind: BusinessEventKind): Permission {
  if (kind === 'PRESCRIPTION_CREATED' || kind === 'PRESCRIPTION_CANCELLED') {
    return 'prescriptions:read';
  }
  if (kind === 'MEDICAL_HISTORY_RECORDED') {
    return 'medical_history:read';
  }
  return 'patients:read';
}

export function notificationTypeForEvent(kind: BusinessEventKind): NotificationType {
  if (kind === 'PRESCRIPTION_CREATED' || kind === 'PRESCRIPTION_CANCELLED') {
    return 'PRESCRIPTION';
  }
  if (kind === 'MEDICAL_HISTORY_RECORDED') {
    return 'MEDICAL_HISTORY';
  }
  return 'PATIENT';
}

function patientDisplay(event: BusinessNotificationEvent): string {
  const name = String(event.patientName || '').trim();
  const code = String(event.patientCode || '').trim();
  if (name && code) return `${name} (${code})`;
  if (name) return name;
  if (code) return code;
  return 'un patient';
}

export function businessNotificationContent(event: BusinessNotificationEvent): {
  type: NotificationType;
  title: string;
  message: string;
} {
  const who = patientDisplay(event);
  const service = SERVICE_LABEL[event.service] || event.service;
  switch (event.kind) {
    case 'PRESCRIPTION_CREATED':
      return {
        type: 'PRESCRIPTION',
        title: 'Nouvelle ordonnance créée',
        message: `Une nouvelle ordonnance a été créée pour ${who}.`,
      };
    case 'PRESCRIPTION_CANCELLED':
      return {
        type: 'PRESCRIPTION',
        title: 'Ordonnance annulée',
        message: `Une ordonnance a été annulée pour ${who}.`,
      };
    case 'PATIENT_CREATED':
      return {
        type: 'PATIENT',
        title: 'Nouveau patient admis',
        message: `Le patient ${who} a été admis en ${service}.`,
      };
    case 'PATIENT_UPDATED':
      return {
        type: 'PATIENT',
        title: 'Dossier patient modifié',
        message: `Le dossier médical de ${who} a été modifié.`,
      };
    case 'MEDICAL_HISTORY_RECORDED':
      return {
        type: 'MEDICAL_HISTORY',
        title: 'Historique médical mis à jour',
        message: `Un événement d’historique médical a été enregistré pour ${who}.`,
      };
  }
}

/**
 * Operational staff only: can read notifications, has the patient service,
 * has the domain permission, and is not an oversight inbox (read_all).
 * Never uses role ===.
 */
export function isEligibleRecipient(
  permissions: readonly Permission[] | undefined,
  event: BusinessNotificationEvent,
  userId: string
): boolean {
  if (!permissions?.length) return false;
  if (userId === event.actorId) return false;
  if (!permissions.includes('notifications:read')) return false;
  if (permissions.includes('notifications:read_all')) return false;
  const servicePerm = SERVICE_PERMISSION_MAP[event.service];
  if (!servicePerm || !permissions.includes(servicePerm)) return false;
  return permissions.includes(requiredDomainPermission(event.kind));
}

type DbRow = Record<string, unknown>;

async function permissionsByRoleId(): Promise<Map<string, Permission[]>> {
  const map = new Map<string, Permission[]>();
  const rolePerms = (await getDb()('role_permissions').select('*')) as DbRow[];
  const perms = (await getDb()('permissions').select('*')) as DbRow[];
  const codeById = new Map(perms.map((p) => [String(p.id), String(p.code) as Permission]));
  for (const rp of rolePerms) {
    const roleId = String(rp.role_id);
    const code = codeById.get(String(rp.permission_id));
    if (!code) continue;
    const list = map.get(roleId) || [];
    list.push(code);
    map.set(roleId, list);
  }
  return map;
}

function fallbackPermissions(user: DbRow, roles: DbRow[]): Permission[] {
  const roleId = user.role_id == null ? '' : String(user.role_id);
  const roleRow = roles.find((r) => String(r.id) === roleId);
  const name = String(roleRow?.name || user.role_name || '');
  return (ROLE_PERMISSIONS as Record<string, Permission[]>)[name] || [];
}

export async function resolveRecipientIds(event: BusinessNotificationEvent): Promise<string[]> {
  const actorId = String(event.actorId || '').trim();
  const users = ((await getDb()('users').select('*')) as DbRow[]).filter((u) => {
    if (u.is_active === false) return false;
    return String(u.id) !== actorId;
  });
  if (!users.length) return [];

  const roles = (await getDb()('roles').select('*')) as DbRow[];
  const byRole = await permissionsByRoleId();

  const ids: string[] = [];
  for (const user of users) {
    const id = String(user.id);
    const roleId = user.role_id == null ? '' : String(user.role_id);
    const fromRole = byRole.get(roleId);
    const permissions =
      fromRole && fromRole.length ? fromRole : fallbackPermissions(user, roles);
    if (isEligibleRecipient(permissions, event, id)) {
      ids.push(id);
    }
    if (ids.length >= MAX_RECIPIENTS) break;
  }
  return ids;
}

export async function dispatchBusinessNotification(
  event: BusinessNotificationEvent
): Promise<DispatchBusinessResult> {
  if (!isBusinessEventKind(event.kind)) {
    throw new AppError('Invalid business event kind', 400);
  }
  const actorId = String(event.actorId || '').trim();
  if (!actorId) throw new AppError('actorId is required', 400);
  const patientId = String(event.patientId || '').trim();
  if (!patientId) throw new AppError('patientId is required', 400);
  if (!SERVICE_PERMISSION_MAP[event.service]) {
    throw new AppError('Invalid service', 400);
  }

  const patient = await getDb()('patients').where({ id: patientId }).first();
  if (!patient) throw new AppError('Patient not found', 404);

  const hydrated: BusinessNotificationEvent = {
    ...event,
    actorId,
    patientId,
    service: (patient.service as ServiceType) || event.service,
    patientCode: event.patientCode || String(patient.patient_code || ''),
    patientName:
      event.patientName ||
      `${String(patient.last_name || '').toUpperCase()} ${patient.first_name || ''}`.trim(),
  };

  const recipientIds = await resolveRecipientIds(hydrated);
  const content = businessNotificationContent(hydrated);
  const scheduledAt = new Date().toISOString();

  const result: DispatchBusinessResult = {
    created: 0,
    skipped: 0,
    failed: 0,
    recipientIds: [],
  };

  for (const recipientId of recipientIds) {
    try {
      const created: NotificationDto = await createInternalNotification(
        {
          recipientId,
          patientId: hydrated.patientId,
          type: content.type,
          title: content.title,
          message: content.message,
          scheduledAt,
          createdBy: actorId,
          source: 'BUSINESS_EVENT',
          kind: hydrated.kind,
        },
        hydrated.ip
      );
      result.created += 1;
      result.recipientIds.push(created.recipientId);
    } catch (err) {
      result.failed += 1;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `[business-notifications] failed kind=${hydrated.kind} recipient=${recipientId} error=${msg}`
      );
    }
  }

  result.skipped = recipientIds.length - result.created - result.failed;
  return result;
}
