/**
 * UNIT — rate limiter (tape)
 */
import test from 'tape';
import { createRateLimiter } from '@centaur/shared';

test('rateLimiter: bloque après la limite', (t) => {
  const limiter = createRateLimiter({ limit: 3, windowMs: 60_000 });
  t.equal(limiter.allow('ip1'), true);
  t.equal(limiter.allow('ip1'), true);
  t.equal(limiter.allow('ip1'), true);
  t.equal(limiter.allow('ip1'), false);
  t.end();
});

test('rateLimiter: isole les clés', (t) => {
  const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 });
  t.equal(limiter.allow('a'), true);
  t.equal(limiter.allow('b'), true);
  t.equal(limiter.allow('a'), false);
  t.end();
});

test('rateLimiter: reset', (t) => {
  const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 });
  t.equal(limiter.allow('x'), true);
  t.equal(limiter.allow('x'), false);
  limiter.reset('x');
  t.equal(limiter.allow('x'), true);
  t.end();
});
