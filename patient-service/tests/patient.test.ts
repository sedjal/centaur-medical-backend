import {
  hasPermission,
  ROLE_PERMISSIONS,
  SERVICE_PERMISSION_MAP,
  type InternalUser,
} from '@centaur/shared';

describe('Patient authorization', () => {
  const medecin: InternalUser = {
    id: 'm1',
    email: 'rachasl720@gmail.com',
    role: 'MEDECIN',
    permissions: ROLE_PERMISSIONS.MEDECIN,
    firstName: 'Racha',
    lastName: 'Medecin',
  };

  const secretary: InternalUser = {
    id: 's1',
    email: 'khouloudsed2@gmail.com',
    role: 'SECRETAIRE',
    permissions: ROLE_PERMISSIONS.SECRETAIRE,
    firstName: 'K',
    lastName: 'S',
  };

  it('medecin can create and update', () => {
    expect(hasPermission(medecin, 'patients:create')).toBe(true);
    expect(hasPermission(medecin, 'patients:update')).toBe(true);
  });

  it('secretary can create but not update or delete', () => {
    expect(hasPermission(secretary, 'patients:create')).toBe(true);
    expect(hasPermission(secretary, 'patients:update')).toBe(false);
    expect(hasPermission(secretary, 'patients:delete')).toBe(false);
  });

  it('maps services to permissions', () => {
    expect(SERVICE_PERMISSION_MAP.URGENCE).toBe('service:urgence');
    expect(SERVICE_PERMISSION_MAP.GENERAL).toBe('service:general');
    expect(hasPermission(medecin, SERVICE_PERMISSION_MAP.ONCOLOGIE)).toBe(true);
  });
});

describe('Specialty validation rules', () => {
  function validate(service: string, data: Record<string, unknown>): string | null {
    if (service === 'URGENCE') {
      if (!data.arrivalTime || !data.triageLevel || !data.initialSeverity) {
        return 'Emergency fields required';
      }
    }
    if (service === 'ONCOLOGIE') {
      if (!data.tumorType || !data.stage || !data.currentTreatment) {
        return 'Oncology fields required';
      }
    }
    if (service === 'CARDIOLOGIE') {
      if (!data.ecgResults || data.restingHeartRate == null || !data.bloodPressure) {
        return 'Cardiology fields required';
      }
    }
    return null;
  }

  it('requires emergency fields', () => {
    expect(validate('URGENCE', {})).toBe('Emergency fields required');
    expect(
      validate('URGENCE', {
        arrivalTime: '10:00',
        triageLevel: '2',
        initialSeverity: 'Moderate',
      })
    ).toBeNull();
  });

  it('requires oncology fields', () => {
    expect(validate('ONCOLOGIE', { tumorType: 'x' })).toBe('Oncology fields required');
  });

  it('requires cardiology fields', () => {
    expect(
      validate('CARDIOLOGIE', {
        ecgResults: 'Normal',
        restingHeartRate: 70,
        bloodPressure: '120/80',
      })
    ).toBeNull();
  });
});
