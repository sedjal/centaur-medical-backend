-- Centaur Medical — complete database bootstrap
-- PostgreSQL 14+
-- Creates schema + seed data. Password for all users: Admin123!

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS email_notifications CASCADE;
DROP TABLE IF EXISTS password_reset_tokens CASCADE;
DROP TABLE IF EXISTS prescription_items CASCADE;
DROP TABLE IF EXISTS prescriptions CASCADE;
DROP TABLE IF EXISTS medical_history CASCADE;
DROP TABLE IF EXISTS cardiology_records CASCADE;
DROP TABLE IF EXISTS oncology_records CASCADE;
DROP TABLE IF EXISTS emergency_records CASCADE;
DROP TABLE IF EXISTS general_records CASCADE;
DROP TABLE IF EXISTS medical_records CASCADE;
DROP TABLE IF EXISTS patients CASCADE;
DROP TABLE IF EXISTS mfa_codes CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS role_permissions CASCADE;
DROP TABLE IF EXISTS permissions CASCADE;
DROP TABLE IF EXISTS roles CASCADE;
DROP TYPE IF EXISTS service_type CASCADE;

CREATE TYPE service_type AS ENUM ('GENERAL', 'URGENCE', 'ONCOLOGIE', 'CARDIOLOGIE');

CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(50) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(80) NOT NULL UNIQUE,
  description VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE role_permissions (
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  role_id UUID NOT NULL REFERENCES roles(id),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  mfa_required BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE mfa_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash VARCHAR(255) NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE patients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_code VARCHAR(20) NOT NULL UNIQUE,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  hospitalization_date DATE NOT NULL,
  service service_type NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'STABLE',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE prescriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  doctor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  prescribed_at TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  notes TEXT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_prescriptions_patient ON prescriptions(patient_id);
CREATE INDEX idx_prescriptions_doctor ON prescriptions(doctor_id);
CREATE INDEX idx_prescriptions_status ON prescriptions(status);
CREATE INDEX idx_prescriptions_prescribed_at ON prescriptions(prescribed_at);

CREATE TABLE prescription_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_id UUID NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
  medication_name VARCHAR(255) NOT NULL,
  dosage VARCHAR(120) NOT NULL,
  frequency VARCHAR(120) NOT NULL,
  duration VARCHAR(120) NOT NULL,
  instructions TEXT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_prescription_items_rx ON prescription_items(prescription_id);

CREATE TABLE medical_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  event_type VARCHAR(40) NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  service service_type NOT NULL,
  doctor_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  summary VARCHAR(255) NOT NULL,
  metadata JSONB NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID NULL REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_medical_history_patient ON medical_history(patient_id);
CREATE INDEX idx_medical_history_occurred ON medical_history(occurred_at);
CREATE INDEX idx_medical_history_service ON medical_history(service);
CREATE INDEX idx_medical_history_type ON medical_history(event_type);
CREATE INDEX idx_medical_history_patient_occurred ON medical_history(patient_id, occurred_at);

CREATE TABLE medical_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL UNIQUE REFERENCES patients(id) ON DELETE CASCADE,
  service service_type NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE general_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  medical_record_id UUID NOT NULL UNIQUE REFERENCES medical_records(id) ON DELETE CASCADE,
  notes TEXT NULL
);

CREATE TABLE emergency_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  medical_record_id UUID NOT NULL UNIQUE REFERENCES medical_records(id) ON DELETE CASCADE,
  arrival_time TIME NOT NULL,
  triage_level VARCHAR(50) NOT NULL,
  initial_severity VARCHAR(100) NOT NULL
);

CREATE TABLE oncology_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  medical_record_id UUID NOT NULL UNIQUE REFERENCES medical_records(id) ON DELETE CASCADE,
  tumor_type VARCHAR(150) NOT NULL,
  stage VARCHAR(50) NOT NULL,
  current_treatment VARCHAR(255) NOT NULL
);

CREATE TABLE cardiology_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  medical_record_id UUID NOT NULL UNIQUE REFERENCES medical_records(id) ON DELETE CASCADE,
  ecg_results VARCHAR(255) NOT NULL,
  resting_heart_rate INTEGER NOT NULL,
  blood_pressure VARCHAR(50) NOT NULL
);

CREATE TABLE email_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  type VARCHAR(50) NOT NULL,
  recipient_email VARCHAR(255) NOT NULL,
  subject VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'SENT',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  patient_id UUID NULL REFERENCES patients(id) ON DELETE SET NULL,
  type VARCHAR(40) NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ NULL,
  read_at TIMESTAMPTZ NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  created_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_notifications_recipient ON notifications(recipient_id);
CREATE INDEX idx_notifications_status ON notifications(status);
CREATE INDEX idx_notifications_scheduled ON notifications(scheduled_at);
CREATE INDEX idx_notifications_patient ON notifications(patient_id);

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(50) NOT NULL,
  resource VARCHAR(50) NOT NULL,
  resource_id VARCHAR(80) NULL,
  patient_name VARCHAR(200) NULL,
  ip_address VARCHAR(100) NULL,
  details JSONB NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Roles
INSERT INTO roles (id, name) VALUES
  ('11111111-1111-1111-1111-111111111111', 'ADMIN'),
  ('22222222-2222-2222-2222-222222222222', 'DIRECTION'),
  ('33333333-3333-3333-3333-333333333333', 'MEDECIN'),
  ('44444444-4444-4444-4444-444444444444', 'SECRETAIRE');

-- Permissions
INSERT INTO permissions (id, code, description) VALUES
  ('a0000001-0000-0000-0000-000000000001', 'patients:read', 'Read patients'),
  ('a0000001-0000-0000-0000-000000000002', 'patients:create', 'Create patients'),
  ('a0000001-0000-0000-0000-000000000003', 'patients:update', 'Update patients'),
  ('a0000001-0000-0000-0000-000000000004', 'patients:delete', 'Delete patients'),
  ('a0000001-0000-0000-0000-000000000010', 'prescriptions:read', 'Read prescriptions'),
  ('a0000001-0000-0000-0000-000000000011', 'prescriptions:create', 'Create prescriptions'),
  ('a0000001-0000-0000-0000-000000000012', 'prescriptions:cancel', 'Cancel prescriptions'),
  ('a0000001-0000-0000-0000-000000000013', 'medical_history:read', 'Read medical history'),
  ('a0000001-0000-0000-0000-000000000014', 'notifications:read', 'Read own notifications'),
  ('a0000001-0000-0000-0000-000000000015', 'notifications:create', 'Create notifications'),
  ('a0000001-0000-0000-0000-000000000016', 'notifications:read_all', 'Read all notifications'),
  ('a0000001-0000-0000-0000-000000000017', 'notifications:cancel', 'Cancel pending notifications'),
  ('a0000001-0000-0000-0000-000000000005', 'service:general', 'Access general'),
  ('a0000001-0000-0000-0000-000000000006', 'service:urgence', 'Access urgence'),
  ('a0000001-0000-0000-0000-000000000007', 'service:oncologie', 'Access oncologie'),
  ('a0000001-0000-0000-0000-000000000008', 'service:cardiologie', 'Access cardiologie'),
  ('a0000001-0000-0000-0000-000000000009', 'users:read', 'Read users'),
  ('a0000001-0000-0000-0000-00000000000a', 'users:create', 'Create users'),
  ('a0000001-0000-0000-0000-00000000000b', 'users:update', 'Update users'),
  ('a0000001-0000-0000-0000-00000000000c', 'users:delete', 'Delete users'),
  ('a0000001-0000-0000-0000-00000000000d', 'roles:manage', 'Manage roles'),
  ('a0000001-0000-0000-0000-00000000000e', 'audit:read', 'Read audit'),
  ('a0000001-0000-0000-0000-00000000000f', 'reports:read', 'Read reports');

-- ADMIN: all
INSERT INTO role_permissions (role_id, permission_id)
SELECT '11111111-1111-1111-1111-111111111111', id FROM permissions;

-- DIRECTION
INSERT INTO role_permissions (role_id, permission_id)
SELECT '22222222-2222-2222-2222-222222222222', id FROM permissions
WHERE code IN (
  'patients:read','prescriptions:read','medical_history:read',
  'notifications:read','notifications:create','notifications:read_all','notifications:cancel',
  'service:general','service:urgence','service:oncologie','service:cardiologie',
  'reports:read','audit:read'
);

-- MEDECIN
INSERT INTO role_permissions (role_id, permission_id)
SELECT '33333333-3333-3333-3333-333333333333', id FROM permissions
WHERE code IN (
  'patients:read','patients:create','patients:update',
  'prescriptions:read','prescriptions:create','prescriptions:cancel','medical_history:read',
  'notifications:read','notifications:create','notifications:cancel',
  'service:general','service:urgence','service:oncologie','service:cardiologie'
);

-- SECRETAIRE
INSERT INTO role_permissions (role_id, permission_id)
SELECT '44444444-4444-4444-4444-444444444444', id FROM permissions
WHERE code IN (
  'patients:read','patients:create','prescriptions:read','medical_history:read',
  'notifications:read','notifications:create',
  'service:general','service:urgence','service:oncologie','service:cardiologie'
);

INSERT INTO users (id, email, password_hash, first_name, last_name, role_id, mfa_enabled, mfa_required) VALUES
  ('b0000001-0000-0000-0000-000000000001', 'sedjalkhouloud@gmail.com', '$argon2id$v=19$m=65536,t=3,p=4$uL17iIwWCikfiNUXiRPGeA$n+2jIEv65os37NSmy8BHjdhu9tz7VhvZVCCC1IwhNX8', 'Khouloud', 'Sedjal', '11111111-1111-1111-1111-111111111111', TRUE, TRUE),
  ('b0000001-0000-0000-0000-000000000002', 'lydia.sedjal@gmail.com', '$argon2id$v=19$m=65536,t=3,p=4$uL17iIwWCikfiNUXiRPGeA$n+2jIEv65os37NSmy8BHjdhu9tz7VhvZVCCC1IwhNX8', 'Lydia', 'Sedjal', '22222222-2222-2222-2222-222222222222', TRUE, TRUE),
  ('b0000001-0000-0000-0000-000000000003', 'rachasl720@gmail.com', '$argon2id$v=19$m=65536,t=3,p=4$uL17iIwWCikfiNUXiRPGeA$n+2jIEv65os37NSmy8BHjdhu9tz7VhvZVCCC1IwhNX8', 'Racha', 'Medecin', '33333333-3333-3333-3333-333333333333', FALSE, FALSE),
  ('b0000001-0000-0000-0000-000000000004', 'khouloudsed2@gmail.com', '$argon2id$v=19$m=65536,t=3,p=4$uL17iIwWCikfiNUXiRPGeA$n+2jIEv65os37NSmy8BHjdhu9tz7VhvZVCCC1IwhNX8', 'Khouloud', 'Secretaire', '44444444-4444-4444-4444-444444444444', FALSE, FALSE);

INSERT INTO patients (id, patient_code, first_name, last_name, hospitalization_date, service, status) VALUES
  ('c0000001-0000-0000-0000-000000000001', 'PT-000124', 'Ahmed', 'Benali', '2026-08-11', 'URGENCE', 'CRITICAL'),
  ('c0000001-0000-0000-0000-000000000002', 'PT-000125', 'Sarah', 'Amara', '2026-08-10', 'ONCOLOGIE', 'STABLE'),
  ('c0000001-0000-0000-0000-000000000003', 'PT-000126', 'Karim', 'Haddad', '2026-08-09', 'CARDIOLOGIE', 'STABLE'),
  ('c0000001-0000-0000-0000-000000000004', 'PT-000127', 'Nadia', 'Cherif', '2026-08-08', 'GENERAL', 'STABLE');

INSERT INTO medical_records (id, patient_id, service) VALUES
  ('d0000001-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000001', 'URGENCE'),
  ('d0000001-0000-0000-0000-000000000002', 'c0000001-0000-0000-0000-000000000002', 'ONCOLOGIE'),
  ('d0000001-0000-0000-0000-000000000003', 'c0000001-0000-0000-0000-000000000003', 'CARDIOLOGIE'),
  ('d0000001-0000-0000-0000-000000000004', 'c0000001-0000-0000-0000-000000000004', 'GENERAL');

INSERT INTO emergency_records (medical_record_id, arrival_time, triage_level, initial_severity)
VALUES ('d0000001-0000-0000-0000-000000000001', '14:30:00', '1', 'Critical');

INSERT INTO oncology_records (medical_record_id, tumor_type, stage, current_treatment)
VALUES ('d0000001-0000-0000-0000-000000000002', 'Breast carcinoma', 'II', 'Chemotherapy');

INSERT INTO cardiology_records (medical_record_id, ecg_results, resting_heart_rate, blood_pressure)
VALUES ('d0000001-0000-0000-0000-000000000003', 'Sinus rhythm', 72, '120/80');

INSERT INTO general_records (medical_record_id, notes)
VALUES ('d0000001-0000-0000-0000-000000000004', 'Post-operative follow-up');
