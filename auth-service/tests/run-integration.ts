/**
 * Intégrations auth-service :
 * - service-token : requireServiceToken sur les routes publiques (login/MFA/forgot/reset…)
 *
 * Les tests HTTP d'intégration gateway (login via proxy, /auth/me, /patients)
 * sont dans gateway/tests/integration/ — lance : npm run test:integration -w gateway
 */
import './integration/service-token.integration.test';
