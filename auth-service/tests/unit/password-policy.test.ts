/**
 * UNIT — politique de mot de passe (tape)
 */
import test from 'tape';
import { AppError, assertPasswordPolicy } from '@centaur/shared';

test('assertPasswordPolicy: accepte un mot de passe conforme', (t) => {
  t.doesNotThrow(() => assertPasswordPolicy('Admin123!'));
  t.doesNotThrow(() => assertPasswordPolicy('Abcdefg1'));
  t.end();
});

test('assertPasswordPolicy: refuse trop court', (t) => {
  t.throws(() => assertPasswordPolicy('Ab1'), /8 caractères/);
  t.ok(true);
  try {
    assertPasswordPolicy('Ab1');
    t.fail('aurait dû throw');
  } catch (e) {
    t.ok(e instanceof AppError);
  }
  t.end();
});

test('assertPasswordPolicy: refuse sans chiffre / sans lettre', (t) => {
  t.throws(() => assertPasswordPolicy('Password!!'), /lettre et un chiffre/);
  t.throws(() => assertPasswordPolicy('12345678'), /lettre et un chiffre/);
  t.end();
});
