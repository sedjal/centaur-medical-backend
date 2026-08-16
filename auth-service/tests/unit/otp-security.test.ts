/**
 * UNIT — OTP + hashing (tape)
 */
import test from 'tape';
import { generateOtpCode, hashOtp, isSmtpConfigured, logDevSecret } from '@centaur/shared';

process.env.JWT_SECRET = 'test-jwt-secret-key-at-least-32-chars';

test('generateOtpCode: 6 chiffres', (t) => {
  t.match(generateOtpCode(), /^\d{6}$/);
  t.end();
});

test('hashOtp: déterministe et non clair', (t) => {
  t.equal(hashOtp('123456'), hashOtp('123456'));
  t.notEqual(hashOtp('123456'), '123456');
  t.notEqual(hashOtp('111111'), hashOtp('222222'));
  t.end();
});

test('hashOtp: JWT_SECRET obligatoire', (t) => {
  const prev = process.env.JWT_SECRET;
  delete process.env.JWT_SECRET;
  try {
    t.throws(() => hashOtp('123456'), /JWT_SECRET/);
  } finally {
    process.env.JWT_SECRET = prev;
  }
  t.end();
});

test('isSmtpConfigured / logDevSecret', (t) => {
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  t.equal(isSmtpConfigured(), false);
  t.doesNotThrow(() => logDevSecret('demo', '000000'));
  t.end();
});
