import { signToken, type JwtPayload, type Permission } from '@centaur/shared';
import { createPatientTestApp, listenPatientApp } from '../../../../patient-service/tests/helpers/test-app';
import { createNotifTestApp, listenNotifApp, buildInternalHeaders } from '../../helpers/test-app';
import { installNotifDbMock, restoreNotifDbMock, type NotifDbState } from '../../helpers/notif-db-mock';
import { __resetSseConnections, closeAllSseConnections } from '../../../src/notification-sse';
import { createE2eGateway, listenGateway } from './e2e-gateway';
import { USERS, notificationE2eSeed } from './notification-e2e-seed';
import { waitUntil } from './sse-read';

export { USERS, notificationE2eSeed };

type StaffUser = (typeof USERS)[keyof typeof USERS];

export function accessToken(user: {
  id: string;
  email: string;
  role: string;
  permissions: readonly Permission[];
  firstName: string;
  lastName: string;
  purpose?: JwtPayload['purpose'];
}): string {
  return signToken(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
      permissions: [...user.permissions],
      firstName: user.firstName,
      lastName: user.lastName,
      purpose: user.purpose || 'ACCESS',
    },
    '15m'
  );
}

export function staffHeaders(user: StaffUser) {
  return buildInternalHeaders({
    id: user.id,
    email: user.email,
    role: user.role,
    permissions: [...user.permissions],
    firstName: user.firstName,
    lastName: user.lastName,
  });
}

export interface NotificationE2eHarness {
  state: NotifDbState;
  patientPort: number;
  notifPort: number;
  gatewayPort: number;
  tokens: {
    a: string;
    b: string;
    c: string;
    dir: string;
    noPerm: string;
    mfa: string;
    reset: string;
  };
  close: () => Promise<void>;
}

export async function startNotificationE2e(): Promise<NotificationE2eHarness> {
  __resetSseConnections();
  const { state } = installNotifDbMock(notificationE2eSeed());

  const { port: notifPort, close: closeNotif } = await listenNotifApp(createNotifTestApp());
  process.env.BUSINESS_NOTIFICATIONS = '1';
  process.env.NOTIFICATION_SERVICE_URL = `http://127.0.0.1:${notifPort}`;
  const { port: patientPort, close: closePatient } = await listenPatientApp(createPatientTestApp());
  const gw = createE2eGateway({
    patient: `http://127.0.0.1:${patientPort}`,
    notification: `http://127.0.0.1:${notifPort}`,
  });
  const { port: gatewayPort, close: closeGw } = await listenGateway(gw);

  return {
    state,
    patientPort,
    notifPort,
    gatewayPort,
    tokens: {
      a: accessToken(USERS.a),
      b: accessToken(USERS.b),
      c: accessToken(USERS.c),
      dir: accessToken(USERS.dir),
      noPerm: accessToken(USERS.noPerm),
      mfa: accessToken({ ...USERS.a, purpose: 'MFA' }),
      reset: accessToken({ ...USERS.a, purpose: 'PASSWORD_RESET' }),
    },
    close: async () => {
      await closeAllSseConnections();
      __resetSseConnections();
      await closeGw();
      await closePatient();
      await closeNotif();
      restoreNotifDbMock();
      delete process.env.BUSINESS_NOTIFICATIONS;
      delete process.env.NOTIFICATION_SERVICE_URL;
    },
  };
}

export function notificationsFor(state: NotifDbState, recipientId: string) {
  return state.notifications.filter((n) => String(n.recipient_id) === recipientId);
}

export async function waitForRecipient(state: NotifDbState, recipientId: string, min = 1): Promise<void> {
  await waitUntil(() => notificationsFor(state, recipientId).length >= min);
}
