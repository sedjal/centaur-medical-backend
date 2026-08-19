/**
 * INTÉGRATION — clinical-notes HTTP JSON
 */
process.env.JWT_SECRET = 'test-jwt-secret-key-at-least-32-chars';
process.env.SERVICE_TOKEN = 'test-service-token';
process.env.NODE_ENV = 'test';

import test from 'tape';
import {
  createPatientTestApp,
  listenPatientApp,
  buildInternalHeaders,
  patientHttp,
} from '../helpers/test-app';
import { defaultPatientSeed, installPatientDbMock, restorePatientDbMock } from '../helpers/patient-db-mock';

const writeHeaders = buildInternalHeaders({
  id: 'u-urg',
  email: 'urg@test.com',
  role: 'MEDECIN',
  permissions: ['reports:read', 'reports:create', 'medical_history:read', 'service:urgence'],
  firstName: 'Léa',
  lastName: 'Urg',
});

test('intégration clinical-notes: POST + GET list + GET one + history', async (t) => {
  installPatientDbMock(defaultPatientSeed());
  const { port, close } = await listenPatientApp(createPatientTestApp());
  try {
    const created = await patientHttp(port, 'POST', '/patients/p-urg-1/clinical-notes', {
      headers: { ...writeHeaders, 'content-type': 'application/json' },
      body: { title: 'Compte rendu', body: 'Patient stable, surveillance 24h.' },
    });
    t.equal(created.status, 201);
    const note = created.data as { id: string; title: string; body: string };
    t.equal(note.title, 'Compte rendu');
    t.equal(note.body, 'Patient stable, surveillance 24h.');

    const list = await patientHttp(port, 'GET', '/patients/p-urg-1/clinical-notes', {
      headers: writeHeaders,
    });
    t.equal(list.status, 200);
    t.equal((list.data as Array<{ id: string }>).length, 1);

    const one = await patientHttp(port, 'GET', `/patients/p-urg-1/clinical-notes/${note.id}`, {
      headers: writeHeaders,
    });
    t.equal(one.status, 200);
    t.equal((one.data as { body: string }).body, note.body);

    const hist = await patientHttp(port, 'GET', '/patients/p-urg-1/medical-history', {
      headers: writeHeaders,
    });
    t.equal(hist.status, 200);
    const events = (hist.data as { items: Array<{ eventType: string; metadata?: { title?: string; body?: string } }> })
      .items;
    t.equal(events[0].eventType, 'CLINICAL_NOTE');
    t.equal(events[0].metadata?.title, 'Compte rendu');
    t.equal(events[0].metadata?.body, undefined);

    const deleted = await patientHttp(port, 'DELETE', `/patients/p-urg-1/clinical-notes/${note.id}`, {
      headers: writeHeaders,
    });
    t.equal(deleted.status, 200);
    t.equal((deleted.data as { ok: boolean }).ok, true);

    const listAfter = await patientHttp(port, 'GET', '/patients/p-urg-1/clinical-notes', {
      headers: writeHeaders,
    });
    t.equal((listAfter.data as Array<{ id: string }>).length, 0);

    const histAfter = await patientHttp(port, 'GET', '/patients/p-urg-1/medical-history', {
      headers: writeHeaders,
    });
    t.equal(
      ((histAfter.data as { items: Array<{ eventType: string }> }).items[0]).eventType,
      'CLINICAL_NOTE'
    );
  } finally {
    await close();
    restorePatientDbMock();
    t.end();
  }
});

test('intégration clinical-notes: sans reports:create → 403', async (t) => {
  installPatientDbMock(defaultPatientSeed());
  const { port, close } = await listenPatientApp(createPatientTestApp());
  try {
    const headers = buildInternalHeaders({
      id: 'u-urg',
      email: 'dir@test.com',
      role: 'DIRECTION',
      permissions: ['reports:read', 'service:urgence'],
      firstName: 'Lydia',
      lastName: 'Dir',
    });
    const res = await patientHttp(port, 'POST', '/patients/p-urg-1/clinical-notes', {
      headers: { ...headers, 'content-type': 'application/json' },
      body: { title: 'X', body: 'Y' },
    });
    t.equal(res.status, 403);
  } finally {
    await close();
    restorePatientDbMock();
    t.end();
  }
});

test('intégration clinical-notes: titre vide → 400', async (t) => {
  installPatientDbMock(defaultPatientSeed());
  const { port, close } = await listenPatientApp(createPatientTestApp());
  try {
    const res = await patientHttp(port, 'POST', '/patients/p-urg-1/clinical-notes', {
      headers: { ...writeHeaders, 'content-type': 'application/json' },
      body: { title: '  ', body: 'Texte' },
    });
    t.equal(res.status, 400);
  } finally {
    await close();
    restorePatientDbMock();
    t.end();
  }
});
