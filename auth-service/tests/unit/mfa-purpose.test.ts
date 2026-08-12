/**
 * UNIT — MFA purpose strict (tape)
 * Simule la règle auth-service: purpose doit être exactement MFA.
 */
import test from 'tape';

function assertMfaPurpose(purpose: string | undefined): void {
  if (purpose !== 'MFA') {
    throw new Error('Invalid MFA token');
  }
}

test('MFA: purpose MFA accepté', (t) => {
  t.doesNotThrow(() => assertMfaPurpose('MFA'));
  t.end();
});

test('MFA: purpose undefined rejeté', (t) => {
  t.throws(() => assertMfaPurpose(undefined), /Invalid MFA token/);
  t.end();
});

test('MFA: purpose ACCESS rejeté', (t) => {
  t.throws(() => assertMfaPurpose('ACCESS'), /Invalid MFA token/);
  t.end();
});
