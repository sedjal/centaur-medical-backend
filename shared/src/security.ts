import crypto from 'crypto';

/** HMAC-SHA256 hash for OTP / reset codes (never store plaintext). */
export function hashOtp(code: string, secret = process.env.JWT_SECRET || 'otp-secret'): string {
  return crypto.createHmac('sha256', secret).update(code).digest('hex');
}

/** Cryptographically acceptable 6-digit OTP for demo MFA / reset. */
export function generateOtpCode(): string {
  return String(crypto.randomInt(100000, 1000000));
}

/** True when SMTP credentials are present (real emails can be sent). */
export function isSmtpConfigured(): boolean {
  return Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);
}

/**
 * Log sensitive codes only in local/dev when SMTP is not configured.
 * Never log OTPs when mail delivery is active.
 */
export function logDevSecret(label: string, value: string): void {
  if (isSmtpConfigured()) return;
  if (process.env.NODE_ENV === 'production') return;
  console.log(`[auth:dev] ${label}: ${value}`);
}
