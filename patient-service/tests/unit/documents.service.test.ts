/**
 * UNIT — documents.service (MIME, taille, isolation, history, 409)
 */
process.env.JWT_SECRET = 'test-jwt-secret-key-at-least-32-chars';
process.env.SERVICE_TOKEN = 'test-service-token';
process.env.NODE_ENV = 'test';

import test from 'tape';
import { AppError, ROLE_PERMISSIONS, type InternalUser, type Permission } from '@centaur/shared';
import { deletePatient } from '../../src/patient.service';
import {
  createPatientDocument,
  deletePatientDocument,
  getPatientDocumentFile,
  listPatientDocuments,
} from '../../src/documents.service';
import { getPatientMedicalHistory } from '../../src/medical-history.service';
import { validateDocumentFile } from '../../src/file-validation';
import {
  defaultPatientSeed,
  installPatientDbMock,
  restorePatientDbMock,
} from '../helpers/patient-db-mock';

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

const pdf = () => Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('1 0 obj\n<<>>\n')]);
const jpeg = () => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const png = () =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('IHDR'),
  ]);

const docPerms: Permission[] = [
  'documents:read',
  'documents:create',
  'documents:delete',
  'medical_history:read',
  'patients:delete',
  'service:urgence',
];

test('file-validation: PDF JPEG PNG + magic mismatch + empty + 413', (t) => {
  t.equal(validateDocumentFile({ filename: 'a.pdf', declaredMime: 'application/pdf', content: pdf() }).mimeType, 'application/pdf');
  t.equal(validateDocumentFile({ filename: 'a.jpg', declaredMime: 'image/jpeg', content: jpeg() }).mimeType, 'image/jpeg');
  t.equal(validateDocumentFile({ filename: 'a.png', declaredMime: 'image/png', content: png() }).mimeType, 'image/png');
  try {
    validateDocumentFile({ filename: 'x.pdf', declaredMime: 'application/pdf', content: jpeg() });
    t.fail('expected spoof 400');
  } catch (e) {
    t.equal((e as AppError).statusCode, 400);
  }
  try {
    validateDocumentFile({ filename: 'empty.pdf', content: Buffer.alloc(0) });
    t.fail('expected empty 400');
  } catch (e) {
    t.equal((e as AppError).statusCode, 400);
  }
  try {
    validateDocumentFile({
      filename: 'huge.pdf',
      declaredMime: 'application/pdf',
      content: Buffer.concat([pdf(), Buffer.alloc(5 * 1024 * 1024)]),
    });
    t.fail('expected 413');
  } catch (e) {
    t.equal((e as AppError).statusCode, 413);
  }
  t.end();
});

test('documents: upload PDF → metadata sans BYTEA + DOCUMENT_ADDED', async (t) => {
  const { state } = installPatientDbMock(defaultPatientSeed());
  try {
    const created = await createPatientDocument(mkUser(docPerms), 'p-urg-1', {
      type: 'ECG',
      filename: 'ecg.pdf',
      declaredMime: 'application/pdf',
      content: pdf(),
    });
    t.equal(created.docType, 'ECG');
    t.equal(created.filename, 'ecg.pdf');
    t.equal(Object.prototype.hasOwnProperty.call(created, 'content'), false);
    t.equal(state.patient_documents.length, 1);
    t.ok(Buffer.isBuffer(state.patient_documents[0].content));

    const list = await listPatientDocuments(mkUser(docPerms), 'p-urg-1');
    t.equal(list.length, 1);
    t.equal(Object.prototype.hasOwnProperty.call(list[0], 'content'), false);
    t.equal((list[0] as { content?: unknown }).content, undefined);

    const hist = await getPatientMedicalHistory(mkUser(docPerms), 'p-urg-1');
    t.equal(hist.items[0].eventType, 'DOCUMENT_ADDED');
    t.equal(hist.items[0].metadata?.documentId, created.id);
    t.equal(hist.items[0].metadata?.filename, 'ecg.pdf');
  } finally {
    restorePatientDbMock();
    t.end();
  }
});

test('documents: isolation service + lecture sans create', async (t) => {
  installPatientDbMock(defaultPatientSeed());
  try {
    await createPatientDocument(mkUser(['documents:create', 'service:cardiologie']), 'p-urg-1', {
      type: 'AUTRE',
      filename: 'a.pdf',
      declaredMime: 'application/pdf',
      content: pdf(),
    });
    t.fail('expected 403 service');
  } catch (e) {
    t.equal((e as AppError).statusCode, 403);
  }

  try {
    await createPatientDocument(mkUser(['documents:read', 'service:urgence']), 'p-urg-1', {
      type: 'AUTRE',
      filename: 'a.pdf',
      declaredMime: 'application/pdf',
      content: pdf(),
    });
    t.fail('expected 403 create');
  } catch (e) {
    t.equal((e as AppError).statusCode, 403);
  } finally {
    restorePatientDbMock();
    t.end();
  }
});

test('documents: DIRECTION read sans create; delete MEDECIN+ADMIN, pas SECRETAIRE', async (t) => {
  t.equal(ROLE_PERMISSIONS.DIRECTION.includes('documents:read'), true);
  t.equal(ROLE_PERMISSIONS.DIRECTION.includes('documents:create'), false);
  t.equal(ROLE_PERMISSIONS.SECRETAIRE.includes('documents:create'), true);
  t.equal(ROLE_PERMISSIONS.SECRETAIRE.includes('documents:delete'), false);
  t.equal(ROLE_PERMISSIONS.MEDECIN.includes('documents:delete'), true);
  t.equal(ROLE_PERMISSIONS.ADMIN.includes('documents:delete'), true);

  installPatientDbMock(defaultPatientSeed());
  try {
    const created = await createPatientDocument(mkUser(docPerms), 'p-urg-1', {
      type: 'CARTE_GROUPE',
      filename: 'groupe.pdf',
      declaredMime: 'application/pdf',
      content: pdf(),
    });
    try {
      await deletePatientDocument(mkUser(['documents:read', 'documents:create', 'service:urgence']), 'p-urg-1', created.id);
      t.fail('expected 403 delete');
    } catch (e) {
      t.equal((e as AppError).statusCode, 403);
    }
  } finally {
    restorePatientDbMock();
    t.end();
  }
});

test('documents: download BYTEA + delete keeps history', async (t) => {
  const { state } = installPatientDbMock(defaultPatientSeed());
  try {
    const created = await createPatientDocument(mkUser(docPerms), 'p-urg-1', {
      type: 'ORDONNANCE',
      filename: 'rx.pdf',
      declaredMime: 'application/pdf',
      content: pdf(),
    });
    const file = await getPatientDocumentFile(mkUser(docPerms), 'p-urg-1', created.id);
    t.ok(file.content.includes(Buffer.from('%PDF')));
    t.match(file.contentDisposition, /attachment/);

    await deletePatientDocument(mkUser(docPerms), 'p-urg-1', created.id);
    t.equal(state.patient_documents.length, 0);
    const hist = await getPatientMedicalHistory(mkUser(docPerms), 'p-urg-1');
    t.equal(hist.items.some((i) => i.eventType === 'DOCUMENT_ADDED'), true);
  } finally {
    restorePatientDbMock();
    t.end();
  }
});

test('documents: rollback si historique échoue', async (t) => {
  const { state } = installPatientDbMock(defaultPatientSeed(), { failInsertOn: 'medical_history' });
  try {
    await createPatientDocument(mkUser(docPerms), 'p-urg-1', {
      type: 'AUTRE',
      filename: 'a.pdf',
      declaredMime: 'application/pdf',
      content: pdf(),
    });
    t.fail('expected rollback');
  } catch {
    t.equal(state.patient_documents.length, 0);
  } finally {
    restorePatientDbMock();
    t.end();
  }
});

test('documents: delete patient avec document → 409', async (t) => {
  installPatientDbMock(defaultPatientSeed());
  try {
    await createPatientDocument(mkUser(docPerms), 'p-urg-1', {
      type: 'AUTRE',
      filename: 'a.pdf',
      declaredMime: 'application/pdf',
      content: pdf(),
    });
    await deletePatient(mkUser(docPerms), 'p-urg-1');
    t.fail('expected 409');
  } catch (e) {
    t.equal((e as AppError).statusCode, 409);
    t.match((e as Error).message, /documents/i);
  } finally {
    restorePatientDbMock();
    t.end();
  }
});
