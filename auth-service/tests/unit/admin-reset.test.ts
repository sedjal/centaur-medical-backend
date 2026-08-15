/**
 * UNIT — self-delete, dernier ADMIN, reset anti-bruteforce
 */
import test from 'tape';
import { AppError } from '@centaur/shared';
import {
  assertNotSelfDelete,
  assertNotLastActiveAdmin,
  assertResetNotLocked,
  nextResetAttempts,
  RESET_MAX_ATTEMPTS,
} from '../../src/auth.service';

process.env.JWT_SECRET = 'test-jwt-secret-key-at-least-32-chars';
process.env.SERVICE_TOKEN = 'test-service-token';

test('deleteUser: auto-suppression → 403', (t) => {
  try {
    assertNotSelfDelete('u-admin', 'u-admin');
    t.fail('aurait dû throw');
  } catch (err) {
    t.ok(err instanceof AppError);
    t.equal((err as AppError).statusCode, 403);
    t.match((err as Error).message, /propre compte/);
  }
  t.doesNotThrow(() => assertNotSelfDelete('u-admin', 'u-other'));
  t.end();
});

test('deleteUser: dernier ADMIN actif → 403', (t) => {
  try {
    assertNotLastActiveAdmin(0);
    t.fail('aurait dû throw');
  } catch (err) {
    t.ok(err instanceof AppError);
    t.equal((err as AppError).statusCode, 403);
    t.match((err as Error).message, /dernier administrateur/);
  }
  t.doesNotThrow(() => assertNotLastActiveAdmin(1));
  t.end();
});

test('reset: 5 tentatives → 429 puis invalidation', (t) => {
  t.doesNotThrow(() => assertResetNotLocked(0));
  t.doesNotThrow(() => assertResetNotLocked(4));
  try {
    assertResetNotLocked(5);
    t.fail('aurait dû throw');
  } catch (err) {
    t.equal((err as AppError).statusCode, 429);
  }

  t.deepEqual(nextResetAttempts(0), { next: 1, locked: false });
  t.deepEqual(nextResetAttempts(4), { next: 5, locked: true });
  t.equal(RESET_MAX_ATTEMPTS, 5);
  t.end();
});
