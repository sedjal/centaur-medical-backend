/**
 * UNIT — clinical-notes.service (contenu, isolation, history, 409)
 */
process.env.JWT_SECRET = 'test-jwt-secret-key-at-least-32-chars';
process.env.SERVICE_TOKEN = 'test-service-token';
process.env.NODE_ENV = 'test';

import test from 'tape';
import { AppError, ROLE_PERMISSIONS, type InternalUser, type Permission } from '@centaur/shared';
import { deletePatient } from '../../src/patient.service';
import {
  CLINICAL_NOTE_BODY_MAX,
  assertClinicalNoteContent,
  createPatientClinicalNote,
  deletePatientClinicalNote,
  getPatientClinicalNote,
  listPatientClinicalNotes,
} from '../../src/clinical-notes.service';
import { getPatientMedicalHistory } from '../../src/medical-history.service';
import { defaultPatientSeed, installPatientDbMock, restorePatientDbMock } from '../helpers/patient-db-mock';

function mkUser(permissions: Permission[], id = 'u-urg'): InternalUser {
  return {
    id,
    email: 'doc@test.com',
    role: 'MEDECIN',
    permissions,
    firstName: 'Léa',
    lastName: 'Urg',
  };
}

const notePerms: Permission[] = [
  'reports:read',
  'reports:create',
  'medical_history:read',
  'patients:delete',
  'service:urgence',
];

test('clinical-notes: titre / corps vides ou trop longs', (t) => {
  t.throws(() => assertClinicalNoteContent('  ', 'ok'), /titre/i);
  t.throws(() => assertClinicalNoteContent('Titre', '   '), /vide/i);
  t.throws(() => assertClinicalNoteContent('x'.repeat(121), 'corps'), /120/);
  t.throws(() => assertClinicalNoteContent('Titre', 'y'.repeat(CLINICAL_NOTE_BODY_MAX + 1)), /10000/);
  const ok = assertClinicalNoteContent('  Suivi  ', '  Patient stable.  ');
  t.equal(ok.title, 'Suivi');
  t.equal(ok.body, 'Patient stable.');
  t.end();
});

test('clinical-notes: create → list + CLINICAL_NOTE history sans body dans metadata/audit', async (t) => {
  const { state } = installPatientDbMock(defaultPatientSeed());
  try {
    const created = await createPatientClinicalNote(mkUser(notePerms), 'p-urg-1', {
      title: 'Compte rendu urgence',
      body: 'Examen clinique rassurant. Sortie prévue.',
    });
    t.equal(created.title, 'Compte rendu urgence');
    t.equal(created.body, 'Examen clinique rassurant. Sortie prévue.');
    t.equal(created.authorName, 'Léa Urg');
    t.equal(state.clinical_notes.length, 1);

    const list = await listPatientClinicalNotes(mkUser(notePerms), 'p-urg-1');
    t.equal(list.length, 1);
    t.equal(list[0].id, created.id);

    const one = await getPatientClinicalNote(mkUser(notePerms), 'p-urg-1', created.id);
    t.equal(one.body, created.body);

    const hist = await getPatientMedicalHistory(mkUser(notePerms), 'p-urg-1');
    t.equal(hist.items[0].eventType, 'CLINICAL_NOTE');
    t.equal(hist.items[0].metadata?.noteId, created.id);
    t.equal(hist.items[0].metadata?.title, 'Compte rendu urgence');
    t.equal(Object.prototype.hasOwnProperty.call(hist.items[0].metadata || {}, 'body'), false);
    t.equal(JSON.stringify(hist.items[0].metadata || {}).includes('Sortie prévue'), false);

    const audit = state.audit_logs.find((a) => a.action === 'CLINICAL_NOTE_CREATED');
    t.ok(audit);
    t.equal(JSON.stringify(audit?.details || {}).includes('Sortie prévue'), false);
  } finally {
    restorePatientDbMock();
    t.end();
  }
});

test('clinical-notes: isolation service + lecture sans create', async (t) => {
  installPatientDbMock(defaultPatientSeed());
  try {
    await createPatientClinicalNote(mkUser(['reports:create', 'service:cardiologie']), 'p-urg-1', {
      title: 'X',
      body: 'Y',
    });
    t.fail('expected 403 service');
  } catch (e) {
    t.equal((e as AppError).statusCode, 403);
  }

  try {
    await createPatientClinicalNote(mkUser(['reports:read', 'service:urgence']), 'p-urg-1', {
      title: 'X',
      body: 'Y',
    });
    t.fail('expected 403 create');
  } catch (e) {
    t.equal((e as AppError).statusCode, 403);
  } finally {
    restorePatientDbMock();
    t.end();
  }
});

test('clinical-notes: RBAC rôles (DIRECTION lecture, SECRETAIRE ni l’un ni l’autre)', (t) => {
  t.equal(ROLE_PERMISSIONS.DIRECTION.includes('reports:read'), true);
  t.equal(ROLE_PERMISSIONS.DIRECTION.includes('reports:create'), false);
  t.equal(ROLE_PERMISSIONS.SECRETAIRE.includes('reports:read'), false);
  t.equal(ROLE_PERMISSIONS.SECRETAIRE.includes('reports:create'), false);
  t.equal(ROLE_PERMISSIONS.MEDECIN.includes('reports:read'), true);
  t.equal(ROLE_PERMISSIONS.MEDECIN.includes('reports:create'), true);
  t.equal(ROLE_PERMISSIONS.ADMIN.includes('reports:create'), true);
  t.end();
});

test('clinical-notes: rollback si historique échoue', async (t) => {
  const { state } = installPatientDbMock(defaultPatientSeed(), { failInsertOn: 'medical_history' });
  try {
    await createPatientClinicalNote(mkUser(notePerms), 'p-urg-1', {
      title: 'X',
      body: 'Y',
    });
    t.fail('expected rollback');
  } catch {
    t.equal(state.clinical_notes.length, 0);
  } finally {
    restorePatientDbMock();
    t.end();
  }
});

test('clinical-notes: delete patient avec note → 409', async (t) => {
  installPatientDbMock(defaultPatientSeed());
  try {
    await createPatientClinicalNote(mkUser(notePerms), 'p-urg-1', {
      title: 'X',
      body: 'Y',
    });
    await deletePatient(mkUser(notePerms), 'p-urg-1');
    t.fail('expected 409');
  } catch (e) {
    t.equal((e as AppError).statusCode, 409);
    t.match((e as Error).message, /clinical notes/i);
  } finally {
    restorePatientDbMock();
    t.end();
  }
});

test('clinical-notes: delete conserve historique et n’écrit pas le body dans l’audit', async (t) => {
  const { state } = installPatientDbMock(defaultPatientSeed());
  try {
    const created = await createPatientClinicalNote(mkUser(notePerms), 'p-urg-1', {
      title: 'Compte rendu urgence',
      body: 'Examen clinique rassurant. Sortie prévue.',
    });
    t.equal(state.clinical_notes.length, 1);

    await deletePatientClinicalNote(mkUser(notePerms), 'p-urg-1', created.id);
    t.equal(state.clinical_notes.length, 0);

    const hist = await getPatientMedicalHistory(mkUser(notePerms), 'p-urg-1');
    t.equal(hist.items[0].eventType, 'CLINICAL_NOTE');
    t.equal(hist.items[0].metadata?.noteId, created.id);

    const audit = state.audit_logs.find((a) => a.action === 'CLINICAL_NOTE_DELETED');
    t.ok(audit);
    t.equal(JSON.stringify(audit?.details || {}).includes('Sortie prévue'), false);

    try {
      await getPatientClinicalNote(mkUser(notePerms), 'p-urg-1', created.id);
      t.fail('expected 404');
    } catch (e) {
      t.equal((e as AppError).statusCode, 404);
    }
  } finally {
    restorePatientDbMock();
    t.end();
  }
});

test('clinical-notes: delete sans reports:create → 403', async (t) => {
  installPatientDbMock(defaultPatientSeed());
  try {
    const created = await createPatientClinicalNote(mkUser(notePerms), 'p-urg-1', {
      title: 'X',
      body: 'Y',
    });
    try {
      await deletePatientClinicalNote(mkUser(['reports:read', 'service:urgence']), 'p-urg-1', created.id);
      t.fail('expected 403');
    } catch (e) {
      t.equal((e as AppError).statusCode, 403);
    }
  } finally {
    restorePatientDbMock();
    t.end();
  }
});
