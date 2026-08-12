/**
 * UNIT — formes des résultats login (tape)
 */
import test from 'tape';

type LoginResult =
  | { status: 'OK'; token: string }
  | { status: 'REQUIRES_MFA'; mfaToken: string; email: string }
  | { status: 'CHANGE_PASSWORD'; tempToken: string };

function isMfa(r: LoginResult): r is Extract<LoginResult, { status: 'REQUIRES_MFA' }> {
  return r.status === 'REQUIRES_MFA';
}

test('login shape: MFA', (t) => {
  const result: LoginResult = {
    status: 'REQUIRES_MFA',
    mfaToken: 'tok',
    email: 'sedjalkhouloud@gmail.com',
  };
  t.equal(isMfa(result), true);
  t.end();
});

test('login shape: OK', (t) => {
  const result: LoginResult = { status: 'OK', token: 'jwt' };
  t.equal(result.status, 'OK');
  t.end();
});

test('login shape: CHANGE_PASSWORD', (t) => {
  const result: LoginResult = { status: 'CHANGE_PASSWORD', tempToken: 'tmp' };
  t.equal(result.status, 'CHANGE_PASSWORD');
  t.end();
});
