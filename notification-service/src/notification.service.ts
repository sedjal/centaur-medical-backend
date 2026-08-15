import {
  AppError,
  SERVICE_PERMISSION_MAP,
  assertPermission,
  getDb,
  hasPermission,
  type InternalUser,
  type Permission,
  type ServiceType,
} from '@centaur/shared';

export const NOTIFICATION_TYPES = [
  'GENERAL',
  'PATIENT',
  'PRESCRIPTION',
  'MEDICAL_HISTORY',
  'REMINDER',
] as const;

export const NOTIFICATION_STATUSES = ['PENDING', 'SENT', 'READ', 'CANCELLED'] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export interface NotificationCreateInput {
  recipientId: string;
  patientId?: string | null;
  type: NotificationType;
  title: string;
  message: string;
  scheduledAt: string;
}

export interface NotificationListFilters {
  read?: boolean;
  status?: NotificationStatus;
  type?: NotificationType;
  patientId?: string;
}

export interface NotificationDto {
  id: string;
  recipientId: string;
  patientId: string | null;
  type: NotificationType;
  title: string;
  message: string;
  scheduledAt: string;
  sentAt: string | null;
  readAt: string | null;
  status: NotificationStatus;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

type DbRow = Record<string, unknown>;

const ALL_SERVICES: ServiceType[] = ['GENERAL', 'URGENCE', 'ONCOLOGIE', 'CARDIOLOGIE'];

function isType(value: string): value is NotificationType {
  return (NOTIFICATION_TYPES as readonly string[]).includes(value);
}

function isStatus(value: string): value is NotificationStatus {
  return (NOTIFICATION_STATUSES as readonly string[]).includes(value);
}

function toIso(value: unknown): string {
  if (!value) return new Date().toISOString();
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function toIsoOrNull(value: unknown): string | null {
  if (value == null) return null;
  return toIso(value);
}

function toDto(row: DbRow): NotificationDto {
  const type = String(row.type);
  const status = String(row.status);
  return {
    id: String(row.id),
    recipientId: String(row.recipient_id),
    patientId: row.patient_id == null ? null : String(row.patient_id),
    type: isType(type) ? type : 'GENERAL',
    title: String(row.title),
    message: String(row.message),
    scheduledAt: toIso(row.scheduled_at),
    sentAt: toIsoOrNull(row.sent_at),
    readAt: toIsoOrNull(row.read_at),
    status: isStatus(status) ? status : 'PENDING',
    createdBy: row.created_by == null ? null : String(row.created_by),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function assertServiceAccess(user: InternalUser, service: ServiceType): void {
  const perm = SERVICE_PERMISSION_MAP[service];
  assertPermission(user, perm);
}

async function writeAudit(
  user: InternalUser,
  action: 'NOTIFICATION_CREATED' | 'NOTIFICATION_READ' | 'NOTIFICATION_CANCELLED',
  resourceId: string,
  ip?: string,
  details?: Record<string, unknown> | null,
  trx?: ReturnType<typeof getDb>
) {
  const db = trx || getDb();
  await db('audit_logs').insert({
    user_id: user.id,
    action,
    resource: 'NOTIFICATION',
    resource_id: resourceId,
    patient_name: null,
    ip_address: ip || null,
    // Never store medical content (title/message) in audit
    details: details ?? null,
  });
}

function resolveInitialStatus(scheduledAt: Date): {
  status: NotificationStatus;
  sentAt: string | null;
} {
  const now = Date.now();
  if (scheduledAt.getTime() <= now) {
    return { status: 'SENT', sentAt: new Date().toISOString() };
  }
  return { status: 'PENDING', sentAt: null };
}

/**
 * No cron/worker in this codebase.
 * PENDING rows with scheduled_at in the future stay PENDING until a future worker flips them,
 * or until cancel. Immediate delivery (scheduled_at <= now) is marked SENT at create time.
 */
export async function createNotification(
  user: InternalUser,
  input: NotificationCreateInput,
  ip?: string
): Promise<NotificationDto> {
  assertPermission(user, 'notifications:create');

  const recipientId = String(input.recipientId || '').trim();
  if (!recipientId) throw new AppError('recipientId is required', 400);

  const title = String(input.title || '').trim();
  const message = String(input.message || '').trim();
  if (!title) throw new AppError('title is required', 400);
  if (!message) throw new AppError('message is required', 400);
  if (!isType(input.type)) throw new AppError('Invalid notification type', 400);

  const scheduled = new Date(input.scheduledAt);
  if (Number.isNaN(scheduled.getTime())) {
    throw new AppError('Invalid scheduledAt', 400);
  }

  const recipient = await getDb()('users').where({ id: recipientId }).first();
  if (!recipient) throw new AppError('Recipient not found', 404);

  let patientId: string | null = null;
  if (input.patientId) {
    patientId = String(input.patientId).trim();
    const patient = await getDb()('patients').where({ id: patientId }).first();
    if (!patient) throw new AppError('Patient not found', 404);
    assertServiceAccess(user, patient.service as ServiceType);
  }

  const { status, sentAt } = resolveInitialStatus(scheduled);
  const now = new Date().toISOString();

  const created = await getDb().transaction(async (trx) => {
    const [row] = await trx('notifications')
      .insert({
        recipient_id: recipientId,
        patient_id: patientId,
        type: input.type,
        title,
        message,
        scheduled_at: scheduled.toISOString(),
        sent_at: sentAt,
        read_at: null,
        status,
        created_by: user.id,
        created_at: now,
        updated_at: now,
      })
      .returning('*');

    await writeAudit(
      user,
      'NOTIFICATION_CREATED',
      String(row.id),
      ip,
      {
        type: input.type,
        status,
        recipientId,
        patientId,
      },
      trx as unknown as ReturnType<typeof getDb>
    );

    return row as DbRow;
  });

  return toDto(created);
}

export async function listNotifications(
  user: InternalUser,
  filters: NotificationListFilters = {}
): Promise<{ items: NotificationDto[]; total: number }> {
  assertPermission(user, 'notifications:read');

  if (filters.type && !isType(filters.type)) {
    throw new AppError('Invalid notification type', 400);
  }
  if (filters.status && !isStatus(filters.status)) {
    throw new AppError('Invalid notification status', 400);
  }

  let query = getDb()('notifications').select('*');

  if (hasPermission(user, 'notifications:read_all')) {
    // admin-wide list
  } else {
    query = query.where({ recipient_id: user.id });
  }

  if (filters.patientId) {
    query = query.where({ patient_id: filters.patientId });
  }
  if (filters.type) {
    query = query.where({ type: filters.type });
  }
  if (filters.status) {
    query = query.where({ status: filters.status });
  } else if (filters.read === true) {
    query = query.where({ status: 'READ' });
  } else if (filters.read === false) {
    query = query.whereIn('status', ['PENDING', 'SENT']);
  }

  const rows = (await query.orderBy('scheduled_at', 'desc')) as DbRow[];
  const items = rows.map(toDto);
  return { items, total: items.length };
}

export async function getNotification(
  user: InternalUser,
  id: string
): Promise<NotificationDto> {
  assertPermission(user, 'notifications:read');
  const row = await getDb()('notifications').where({ id }).first();
  if (!row) throw new AppError('Notification not found', 404);

  const recipientId = String(row.recipient_id);
  if (recipientId !== user.id && !hasPermission(user, 'notifications:read_all')) {
    throw new AppError('Forbidden: notifications:read_all', 403);
  }
  return toDto(row as DbRow);
}

export async function markNotificationRead(
  user: InternalUser,
  id: string,
  ip?: string
): Promise<NotificationDto> {
  assertPermission(user, 'notifications:read');
  const row = await getDb()('notifications').where({ id }).first();
  if (!row) throw new AppError('Notification not found', 404);

  if (String(row.recipient_id) !== user.id) {
    throw new AppError('Forbidden: only the recipient can mark a notification as read', 403);
  }

  const status = String(row.status);
  if (status === 'CANCELLED') {
    throw new AppError('Cannot mark a cancelled notification as read', 409);
  }
  if (status === 'PENDING') {
    throw new AppError('Notification is not yet sent', 409);
  }
  if (status === 'READ') {
    return toDto(row as DbRow);
  }

  const now = new Date().toISOString();
  await getDb().transaction(async (trx) => {
    await trx('notifications').where({ id }).update({
      status: 'READ',
      read_at: now,
      updated_at: now,
    });
    await writeAudit(user, 'NOTIFICATION_READ', id, ip, { status: 'READ' }, trx as unknown as ReturnType<typeof getDb>);
  });

  const updated = await getDb()('notifications').where({ id }).first();
  return toDto(updated as DbRow);
}

export async function cancelNotification(
  user: InternalUser,
  id: string,
  ip?: string
): Promise<NotificationDto> {
  assertPermission(user, 'notifications:cancel');
  const row = await getDb()('notifications').where({ id }).first();
  if (!row) throw new AppError('Notification not found', 404);

  const status = String(row.status);
  if (status !== 'PENDING') {
    throw new AppError('Only PENDING notifications can be cancelled', 409);
  }

  const isCreator = row.created_by != null && String(row.created_by) === user.id;
  const isRecipient = String(row.recipient_id) === user.id;
  if (!isCreator && !isRecipient && !hasPermission(user, 'notifications:read_all')) {
    throw new AppError('Forbidden: cannot cancel this notification', 403);
  }

  const now = new Date().toISOString();
  await getDb().transaction(async (trx) => {
    await trx('notifications').where({ id }).update({
      status: 'CANCELLED',
      updated_at: now,
    });
    await writeAudit(
      user,
      'NOTIFICATION_CANCELLED',
      id,
      ip,
      { status: 'CANCELLED' },
      trx as unknown as ReturnType<typeof getDb>
    );
  });

  const updated = await getDb()('notifications').where({ id }).first();
  return toDto(updated as DbRow);
}

/** Exported for tests / documentation — services available from permissions. */
export function allowedServices(user: InternalUser): ServiceType[] {
  return ALL_SERVICES.filter((s) =>
    user.permissions.includes(SERVICE_PERMISSION_MAP[s] as Permission)
  );
}
