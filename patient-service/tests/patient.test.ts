/**
 * UNIT — validateSpecialty (tape) — vrai code patient.service
 */
import test from 'tape';
import { validateSpecialty } from '../src/patient.service';

process.env.JWT_SECRET = 'test-jwt-secret-key-at-least-32-chars';
process.env.SERVICE_TOKEN = 'test-service-token';

test('validateSpecialty URGENCE', (t) => {
  t.throws(() => validateSpecialty('URGENCE', {}), /Emergency/);
  t.doesNotThrow(() =>
    validateSpecialty('URGENCE', {
      arrivalTime: '10:00',
      triageLevel: '1',
      initialSeverity: 'Critical',
    })
  );
  t.end();
});

test('validateSpecialty ONCOLOGIE / CARDIOLOGIE / GENERAL', (t) => {
  t.throws(() => validateSpecialty('ONCOLOGIE', { tumorType: 'x' }), /Oncology/);
  t.doesNotThrow(() =>
    validateSpecialty('ONCOLOGIE', {
      tumorType: 'x',
      stage: 'II',
      currentTreatment: 'Chemo',
    })
  );
  t.throws(() => validateSpecialty('CARDIOLOGIE', { ecgResults: 'OK' }), /Cardiology/);
  t.doesNotThrow(() =>
    validateSpecialty('CARDIOLOGIE', {
      ecgResults: 'OK',
      restingHeartRate: 70,
      bloodPressure: '120/80',
    })
  );
  t.doesNotThrow(() => validateSpecialty('GENERAL', {}));
  t.end();
});
