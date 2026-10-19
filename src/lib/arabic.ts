/**
 * Arabic count agreement for the live-region announcements.
 *
 * WHY: the kitchen board announced «وصل 1 طلبات جديدة» — a singular count with a plural
 * noun. Screen-reader users hear it, and it is the only sentence the KDS speaks on its own.
 * Arabic selects the form by the number's last two digits:
 *   1 → مفرد، 2 → مثنى، 3–10 → جمع، 11+ → تمييز مفرد منصوب.
 */
export function arabicNewOrders(count: number): string {
  if (count <= 0) return '';
  if (count === 1) return 'وصل طلب جديد واحد';
  if (count === 2) return 'وصل طلبان جديدان';
  const lastTwo = count % 100;
  if (lastTwo >= 3 && lastTwo <= 10) return `وصلت ${count} طلبات جديدة`;
  return `وصل ${count} طلباً جديداً`;
}
