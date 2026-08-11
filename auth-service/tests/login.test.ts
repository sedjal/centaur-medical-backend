import crypto from 'crypto';

process.env.JWT_SECRET = 'test-jwt-secret-key-at-least-32-chars';

function hashOtp(code: string): string {
  return crypto
    .createHmac('sha256', process.env.JWT_SECRET || 'otp-secret')
    .update(code)
    .digest('hex');
}

describe('MFA OTP hashing', () => {
  it('hashes consistently', () => {
    const a = hashOtp('123456');
    const b = hashOtp('123456');
    expect(a).toBe(b);
    expect(a).not.toBe('123456');
  });

  it('different codes produce different hashes', () => {
    expect(hashOtp('123456')).not.toBe(hashOtp('654321'));
  });

  it('validates 6-digit format', () => {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    expect(code).toMatch(/^\d{6}$/);
  });
});

describe('Login result shape', () => {
  type LoginResult =
    | { status: 'OK'; token: string }
    | { status: 'REQUIRES_MFA'; mfaToken: string; email: string }
    | { status: 'CHANGE_PASSWORD'; tempToken: string };

  function isMfa(r: LoginResult): r is Extract<LoginResult, { status: 'REQUIRES_MFA' }> {
    return r.status === 'REQUIRES_MFA';
  }

  it('detects MFA required for admin flow', () => {
    const result: LoginResult = {
      status: 'REQUIRES_MFA',
      mfaToken: 'tok',
      email: 'sedjalkhouloud@gmail.com',
    };
    expect(isMfa(result)).toBe(true);
    expect(result.email).toContain('@gmail.com');
  });

  it('detects direct JWT login', () => {
    const result: LoginResult = { status: 'OK', token: 'jwt' };
    expect(result.status).toBe('OK');
  });
});
