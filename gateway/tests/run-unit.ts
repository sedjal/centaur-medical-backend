process.env.SERVICE_TOKEN = 'gw-test-service-token-16+';
process.env.JWT_SECRET = 'test-jwt-secret-key-at-least-32-chars';

import './unit/rate-limit.test';
import './unit/gateway.test';
import './unit/auth-purpose.test';
