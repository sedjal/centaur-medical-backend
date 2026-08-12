import { AppError } from './http';

/** Password policy shared by auth-service (create user, change, reset). */
export function assertPasswordPolicy(password: string): void {
  if (password.length < 8) {
    throw new AppError('Le mot de passe doit contenir au moins 8 caractères', 400);
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    throw new AppError('Le mot de passe doit contenir au moins une lettre et un chiffre', 400);
  }
}

export function passwordsMatch(a: string, b: string): boolean {
  return a === b;
}
