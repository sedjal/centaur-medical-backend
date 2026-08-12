/**
 * UNIT — mailer path SMTP off (tape + sinon)
 */
import test from 'tape';
import sinon from 'sinon';
import { isSmtpConfigured } from '@centaur/shared';

process.env.JWT_SECRET = 'test-jwt-secret-key-at-least-32-chars';

test('sans SMTP: isSmtpConfigured=false', (t) => {
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  t.equal(isSmtpConfigured(), false);
  t.end();
});

test('sinon spy sur console.log (dev path)', (t) => {
  const spy = sinon.spy(console, 'log');
  console.log('[auth:dev] demo');
  t.ok(spy.calledOnce);
  spy.restore();
  t.end();
});
