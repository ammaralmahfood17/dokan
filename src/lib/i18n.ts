/**
 * Language-of-text helpers — audit T1 #8.
 *
 * The public menu can render English content (product `name_en`) through a toggle, so parts of an
 * Arabic page are English. WCAG 3.1.2 wants those parts marked, and marking them by the TOGGLE
 * would be a guess: a store named "استكانة" is Arabic even with the toggle on EN, and a store
 * named "Estikana" is English in either mode. The script of the text itself is the honest signal.
 */

/** 'en' when the text carries no Arabic letters, else undefined (inherit the document language). */
export function langOfText(text: string): 'en' | undefined {
  return /[\u0600-\u06FF]/.test(text) ? undefined : 'en';
}
