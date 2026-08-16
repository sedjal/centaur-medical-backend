import { getServiceToken, type ServiceType } from '@centaur/shared';

export const BUSINESS_EVENT_KINDS = [
  'PRESCRIPTION_CREATED',
  'PRESCRIPTION_CANCELLED',
  'PATIENT_CREATED',
  'PATIENT_UPDATED',
] as const;

export type PatientBusinessEventKind = (typeof BUSINESS_EVENT_KINDS)[number];

export interface PatientBusinessEvent {
  kind: PatientBusinessEventKind;
  actorId: string;
  patientId: string;
  patientCode?: string;
  patientName?: string;
  service: ServiceType;
}

type Dispatcher = (event: PatientBusinessEvent) => Promise<void>;

async function httpDispatch(event: PatientBusinessEvent): Promise<void> {
  if (process.env.NODE_ENV === 'test' && process.env.BUSINESS_NOTIFICATIONS !== '1') {
    return;
  }
  const base = process.env.NOTIFICATION_SERVICE_URL || 'http://127.0.0.1:3003';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(`${base}/internal/notifications/events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-service-token': getServiceToken(),
      },
      body: JSON.stringify(event),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`notification-service ${res.status} ${text.slice(0, 180)}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

let dispatcher: Dispatcher = httpDispatch;

export function __setBusinessNotifyDispatcher(fn: Dispatcher): void {
  dispatcher = fn;
}

export function __resetBusinessNotifyDispatcher(): void {
  dispatcher = httpDispatch;
}

/**
 * Fire-and-forget. A failed notification must never roll back the clinical write.
 */
export function notifyBusinessEvent(event: PatientBusinessEvent): void {
  void dispatcher(event).catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[patient-service] business notification failed kind=${event.kind} ${msg}`);
  });
}

export function patientStaffLabel(row: {
  first_name?: unknown;
  last_name?: unknown;
  patient_code?: unknown;
}): { patientName: string; patientCode: string } {
  const patientName = `${String(row.last_name || '').toUpperCase()} ${row.first_name || ''}`.trim();
  const patientCode = String(row.patient_code || '');
  return { patientName, patientCode };
}
