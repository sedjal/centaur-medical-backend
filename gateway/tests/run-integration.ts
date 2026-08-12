process.env.SERVICE_TOKEN = 'gw-test-service-token-16+';
process.env.JWT_SECRET = 'test-jwt-secret-key-at-least-32-chars';
process.env.NODE_ENV = 'test';

import './integration/auth-login.test';
import './integration/auth-me.test';
import './integration/authorization.test';
