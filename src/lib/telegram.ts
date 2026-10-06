import { createAdminClient } from './supabase/admin';

/**
 * Platform-wide Telegram bot for order alerts.
 * One bot serves ALL projects — each project links chats (owner/staff/group)
 * via telegram_links; order routes call sendTelegramAlert() which posts to
 * every linked chat_id. Works app-closed on iOS + Android, zero cost.
 */
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
export const TELEGRAM_BOT_USERNAME =
  process.env.TELEGRAM_BOT_USERNAME || 'dokanplatformchat_bot';

export interface TelegramOrderAlert {
  orderNumber: number;
  totalText: string;
  tableNumber?: number;
  context?: string; // e.g. POS order type (مقعد/سفري)
}

async function callTelegram(method: string, body: Record<string, unknown>) {
  if (!TOKEN) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.json() as Promise<{ ok: boolean; description?: string }>;
  } catch {
    return null;
  }
}

/**
 * Every chat linked to the project that is still allowed to hear from us.
 * Per-staff telegram pref: user-linked chats respect notify_telegram.
 * Group chats and legacy links (user_id NULL) are project-level — always on.
 * Ex-staff (no staff_members row) default to FALSE so removed members stop
 * receiving order numbers + amounts.
 */
async function telegramRecipients(projectId: string) {
  const admin = createAdminClient();
  const { data: links } = await admin
    .from('telegram_links')
    .select('chat_id, user_id')
    .eq('project_id', projectId);

  if (!links?.length) return [];

  const { data: staffPrefs } = await admin
    .from('staff_members')
    .select('user_id, notify_telegram')
    .eq('project_id', projectId);
  const telegramPref = new Map(
    (staffPrefs ?? []).map((staff) => [
      staff.user_id,
      staff.notify_telegram !== false,
    ])
  );
  return links.filter(
    (link) => !link.user_id || telegramPref.get(link.user_id) === true
  );
}

/** Fan a plain text alert out to every eligible chat of the project. */
async function broadcast(projectId: string, text: string) {
  if (!TOKEN) return { sent: 0, failed: 0 };
  const recipients = await telegramRecipients(projectId);
  if (!recipients.length) return { sent: 0, failed: 0 };

  let sent = 0;
  let failed = 0;
  for (const link of recipients) {
    const result = await callTelegram('sendMessage', {
      chat_id: link.chat_id,
      text,
      disable_web_page_preview: true,
    });
    if (result?.ok) sent++;
    else failed++;
  }
  return { sent, failed };
}

/**
 * Customer-initiated service request (call waiter / request the bill) from the
 * table menu. Same recipients and prefs as an order alert.
 * MUST be awaited (Vercel freezes the function on response return).
 */
export async function sendTelegramServiceAlert(
  projectId: string,
  alert: { kind: 'waiter' | 'bill'; tableNumber?: number; projectName?: string }
): Promise<{ sent: number; failed: number }> {
  const headline = alert.kind === 'waiter' ? '🔔 طلب موظف' : '🧾 طلب فاتورة';
  const text = [
    headline,
    ...(alert.projectName ? [alert.projectName] : []),
    ...(alert.tableNumber !== undefined ? [`الطاولة ${alert.tableNumber}`] : []),
  ].join('\n');
  return broadcast(projectId, text);
}

/**
 * Send an order alert to every chat linked to the project.
 * Silently skips when the bot token is not configured or no chats are linked.
 * MUST be awaited (Vercel freezes the function on response return).
 */
export async function sendTelegramAlert(
  projectId: string,
  alert: TelegramOrderAlert
): Promise<{ sent: number; failed: number }> {
  if (!TOKEN) return { sent: 0, failed: 0 };

  const recipients = await telegramRecipients(projectId);
  if (!recipients.length) return { sent: 0, failed: 0 };

  const text = [
    '🔔 طلب جديد',
    `الطلب #${alert.orderNumber}`,
    `المبلغ: ${alert.totalText}`,
    ...(alert.tableNumber !== undefined ? [`الطاولة ${alert.tableNumber}`] : []),
    ...(alert.context ? [alert.context] : []),
  ].join('\n');

  let sent = 0;
  let failed = 0;
  for (const link of recipients) {
    const result = await callTelegram('sendMessage', {
      chat_id: link.chat_id,
      text,
      disable_web_page_preview: true,
    });
    if (result?.ok) sent++;
    else failed++;
  }
  return { sent, failed };
}

/** Reply to a chat (used by the webhook to confirm/cancel a link). */
export async function replyToChat(chatId: string, text: string) {
  return callTelegram('sendMessage', { chat_id: chatId, text });
}
