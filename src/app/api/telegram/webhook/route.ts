import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { createAdminClient } from '@/lib/supabase/admin';
import { replyToChat } from '@/lib/telegram';
import { rateLimit, createRateLimitResponse } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/ip';

/**
 * POST /api/telegram/webhook
 * Telegram bot webhook — receives updates when a user sends "/start <CODE>"
 * to the platform bot and links their chat to the matching project.
 *
 * Reads telegram_link_codes via the admin client (bypasses RLS — this is a
 * public endpoint; the one-time code IS the authorization).
 */
export async function POST(request: NextRequest) {
  // Shared secret guards against spoofed requests — REQUIRED in production.
  // Fail CLOSED: without the secret this public endpoint would process
  // updates through a service-role client; 503 makes Telegram retry later.
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[Telegram Webhook] TELEGRAM_WEBHOOK_SECRET not set — refusing updates');
    return NextResponse.json({ error: 'not configured' }, { status: 503 });
  }
  if (request.headers.get('x-telegram-bot-api-secret-token') !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
        // audit follow-up: a non-JSON body made request.json() throw, and this route's
    // catch answered 500 with a Sentry event. Telegram retries non-2xx, so the
    // hook still acks and ignores - the other routes reject with 400.
    const rawBody = await request.json().catch(() => null);
    if (rawBody === null || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
      return NextResponse.json({ ok: true });
    }
    const update = rawBody as {
      message?: {
        chat?: { id: number | string; type?: string; first_name?: string; title?: string };
        text?: string;
      };
    };

    const chat = update?.message?.chat;
    const text = update?.message?.text || '';

    // Only /start <CODE> is meaningful; ignore everything else
    if (!chat) return NextResponse.json({ ok: true });

    // Rate limit per chat (and IP when available) — public endpoint that
    // performs DB writes with a service-role client.
    const ip = getClientIp(request);
    const limitResult = await rateLimit(`${String(chat.id)}:${ip}`, {
      limit: 10,
      windowMs: 60 * 1000,
      keyPrefix: 'tg-webhook',
    });
    if (!limitResult.allowed) {
      const res = createRateLimitResponse(limitResult.resetIn);
      return NextResponse.json({ error: res.error }, { status: res.status });
    }

    // Expect "/start <CODE>" (Telegram may send "/start@botname <CODE>")
    // {6,32}: the code is 128 bits (32 hex chars) since audit T2 #7.
    const match = text.match(/^\/start(?:@\w+)?\s*([A-Za-z0-9]{6,32})$/);
    if (!match) {
      await replyToChat(String(chat.id), 'أرسل رمز الربط من لوحة تحكم دكان: /start <الرمز>');
      return NextResponse.json({ ok: true });
    }

    const code = match[1].toUpperCase();
    // AR-6: أزل as any — النوع الطبيعي من createAdminClient() يكفي (الخدمات
    // المستخدمة هنا معرّفة في database.types). جدول telegram_link_codes:
    // يُحمَل الحقلان + القيود عبر الأنواع — إن عجز النوع عن عمود واحد يُضاف
    // للمخطط لا للـ any.
    const admin = createAdminClient();

    const { data: linkCode, error: codeErr } = await admin
      .from('telegram_link_codes')
      .select('project_id, expires_at, created_by')
      .eq('code', code)
      .maybeSingle();

    if (codeErr || !linkCode || new Date(linkCode.expires_at).getTime() < Date.now()) {
      if (chat) {
        await replyToChat(
          String(chat.id),
          '❌ الرمز غير صحيح أو انتهت صلاحيته (15 دقيقة). افتح لوحة التحكم → الإعدادات → «ربط تيليجرام» وجرّب من جديد.'
        );
      }
      return NextResponse.json({ ok: true });
    }

    // Consume the code, then link the chat to the project
    await admin.from('telegram_link_codes').delete().eq('code', code);

    const chatId = String(chat.id);
    const kind = chat.type === 'group' || chat.type === 'supergroup' ? 'group' : 'user';
    const label = chat.title || chat.first_name || null;

    const { data: project } = await admin
      .from('projects')
      .select('name')
      .eq('id', linkCode.project_id)
      .single();

    const { error: insertErr } = await admin
      .from('telegram_links')
      .upsert(
        {
          project_id: linkCode.project_id,
          chat_id: chatId,
          kind,
          label,
          // Who initiated the link (from the one-time code). Group chats and
          // legacy links keep NULL → treated as project-level alerts.
          user_id: kind === 'group' ? null : (linkCode.created_by ?? null),
        },
        { onConflict: 'project_id,chat_id' }
      );

    if (insertErr) {
      console.error('[Telegram Webhook]', insertErr);
      await replyToChat(chatId, '❌ صار خطأ بالربط — حاول مرة ثانية.');
      return NextResponse.json({ ok: true });
    }

    await replyToChat(
      chatId,
      `✅ تم الربط! بتوصلك تنبيهات الطلبات الجديدة لـ «${project?.name || 'متجرك'}» — حتى لو التطبيق مقفول.`
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[Telegram Webhook]', err);
    Sentry.captureException(err);
    // Always 200 — Telegram retries non-2xx and duplicates the update
    return NextResponse.json({ ok: true });
  }
}
