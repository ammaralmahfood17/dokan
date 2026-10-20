/**
 * One place for the support channel. WhatsApp is the Gulf default, so it is a primary CTA on
 * the landing and on the closed-signup screen — two copies of the number would drift.
 */
export const SUPPORT_WHATSAPP_NUMBER = '97336897959';

function waUrl(text: string): string {
  return `https://wa.me/${SUPPORT_WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;
}

export const SUPPORT_WHATSAPP_URL = waUrl('مرحبا، عندي سؤال عن دكان');

/** Signups are closed (SIGNUP_ENABLED=false) — this CTA replaces the signup form's dead end. */
export const SIGNUP_WHATSAPP_URL = waUrl('أبغى أفتح متجر على دكان');
