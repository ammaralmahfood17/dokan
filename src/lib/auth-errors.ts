/**
 * Auth error classification — 2026-10 audit remediation, amendment A5 (owner decision 3).
 *
 * With email confirmation ON, "my password is wrong" and "my account is not confirmed yet"
 * arrive through the SAME door: both are a failed `signInWithPassword`. GoTrue tells them
 * apart by error code, and the login form used to collapse both into "بيانات الدخول غير صحيحة"
 * — which sends a merchant hunting for a password they typed correctly, when what they
 * actually need is the confirmation link.
 *
 * Pure and dependency-free so the mapping is unit-tested rather than only exercised in a
 * browser. `canResend` is what lets the form show the resend control for exactly the errors
 * that have an action attached, and nothing else.
 */

export type AuthErrorKind =
  | 'email_not_confirmed'
  | 'invalid_credentials'
  | 'rate_limited'
  | 'weak_password'
  | 'unknown';

export type ClassifiedAuthError = {
  kind: AuthErrorKind;
  message: string;
  /** The user can do something about this from the form (resend the confirmation mail). */
  canResend: boolean;
};

type AuthErrorLike =
  | { code?: string | null; message?: string | null; status?: number | null }
  | null
  | undefined;

export function classifyAuthError(error: AuthErrorLike): ClassifiedAuthError {
  const code = (error?.code ?? '').toLowerCase();
  const message = (error?.message ?? '').toLowerCase();
  const status = error?.status ?? 0;

  if (
    code === 'email_not_confirmed' ||
    code === 'email_address_not_confirmed' ||
    message.includes('email not confirmed')
  ) {
    return {
      kind: 'email_not_confirmed',
      message: 'حسابك لتوه ما تأكّد. افتح رابط التأكيد اللي أرسلناه لبريدك، أو أعد إرساله.',
      canResend: true,
    };
  }

  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || status === 429) {
    return {
      kind: 'rate_limited',
      message: 'محاولات كثيرة. انتظر شوي ثم حاول مرة ثانية.',
      canResend: false,
    };
  }

  if (code === 'weak_password' || code === 'same_password') {
    return {
      kind: 'weak_password',
      message: 'كلمة المرور ضعيفة. استخدم 10 أحرف على الأقل مع حروف كبيرة وصغيرة وأرقام.',
      canResend: false,
    };
  }

  if (
    code === 'invalid_credentials' ||
    code === 'invalid_grant' ||
    status === 400 ||
    message.includes('invalid login credentials')
  ) {
    return { kind: 'invalid_credentials', message: 'بيانات الدخول غير صحيحة', canResend: false };
  }

  // Anything unrecognised keeps the copy merchants already know — never a raw GoTrue string,
  // which the UI must not surface (it can leak whether an address exists).
  return { kind: 'unknown', message: 'بيانات الدخول غير صحيحة', canResend: false };
}
