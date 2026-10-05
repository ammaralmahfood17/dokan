/**
 * Password policy for NEW passwords — audit 2026-10-05 (Task 2, finding #2).
 *
 * Why this exists as a module rather than a literal in each form: the signup API creates
 * users through the service-role admin API (`admin.auth.admin.createUser`), which BYPASSES
 * GoTrue's own password validation. Before this, a direct `POST /api/auth/signup` could mint
 * an account with a 1-character password. The server check is therefore the real boundary,
 * and it must be one value that the forms cannot drift away from.
 *
 * NOT applied to LOGIN: accounts created before this floor existed must still sign in.
 * Raising the bar on login would lock real merchants out of their own store.
 */

/** Minimum length for a new or reset password. */
export const MIN_PASSWORD_LENGTH = 10;

/** bcrypt-safe upper bound — mirrors the login form's maxLength. */
export const MAX_PASSWORD_LENGTH = 72;

export type PasswordRejection = { ok: false; error: string } | { ok: true };

/** Validate a candidate password for SIGNUP / RESET (never for login). */
export function validateNewPassword(password: unknown): PasswordRejection {
  if (typeof password !== 'string') {
    return { ok: false, error: 'كلمة المرور مطلوبة' };
  }
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    return {
      ok: false,
      error: `كلمة المرور يجب أن تكون ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} حرفًا`,
    };
  }
  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasDigit = /[0-9]/.test(password);
  if (!hasLower || !hasUpper || !hasDigit) {
    return { ok: false, error: 'كلمة المرور يجب أن تحتوي حروفًا كبيرة وصغيرة وأرقامًا' };
  }
  return { ok: true };
}
