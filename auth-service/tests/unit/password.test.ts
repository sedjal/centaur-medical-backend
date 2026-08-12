/**
 * UNIT — Argon2 (tape)
 */
import test from 'tape';
import * as argon2 from 'argon2';

test('Argon2: hash et verify', async (t) => {
  const hash = await argon2.hash('Admin123!', { type: argon2.argon2id });
  t.ok(hash.startsWith('$argon2'));
  t.notOk(hash.includes('Admin123!'));
  t.equal(await argon2.verify(hash, 'Admin123!'), true);
  t.equal(await argon2.verify(hash, 'wrong'), false);
  t.end();
});
