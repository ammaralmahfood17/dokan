import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { TELEGRAM_BOT_USERNAME } from '@/lib/telegram';
import { randomBytes } from 'crypto';

const CODE_TTL_MS = 15 * 60 * 1000; // 15 minutes

async function requireMembership(projectId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: 'غير مصرح' }, { status: 401 }) };

  const { data: membership } = await supabase
    .from('staff_members')
    .select('project_id')
    .eq('user_id', user.id)
    .eq('project_id', projectId)
    .maybeSingle();

  if (!membership) return { error: NextResponse.json({ error: 'غير مصرح' }, { status: 403 }) };
  return { supabase, user };
}

/**
 * POST /api/telegram/link  { projectId }
 * Creates a one-time link code: user sends "/start <CODE>" to the bot.
 */
export async function POST(request: NextRequest) {
  try {
    // Two ways this used to end as a 500 on an anonymous caller: `request.json()` threw on
    // a non-JSON body, and a literal `null` body threw a TypeError at the destructure below.
    const body = (await request.json().catch(() => null)) as { projectId?: string };
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 });
    }
    if (!body.projectId) {
      return NextResponse.json({ error: 'بيانات ناقصة' }, { status: 400 });
    }

    const auth = await requireMembership(body.projectId);
    if ('error' in auth) return auth.error;
    const { supabase } = auth;

    // Clear expired codes for this project, then generate a fresh one
    await supabase.from('telegram_link_codes').delete().lt('expires_at', new Date().toISOString());

    const code = randomBytes(4).toString('hex').toUpperCase();
    const { error } = await supabase.from('telegram_link_codes').insert({
      project_id: body.projectId,
      code,
      created_by: auth.user.id,
      expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
    });

    if (error) {
      console.error('[Telegram Link]', error);
      return NextResponse.json({ error: 'فشل إنشاء الرمز' }, { status: 500 });
    }

    return NextResponse.json({
      code,
      bot_username: TELEGRAM_BOT_USERNAME,
      url: `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${code}`,
    });
  } catch (err) {
    console.error('[Telegram Link]', err);
    return NextResponse.json({ error: 'خطأ داخلي' }, { status: 500 });
  }
}

/**
 * DELETE /api/telegram/link  { projectId, chatId }
 * Removes a linked chat from the project.
 */
export async function DELETE(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as { projectId?: string; chatId?: string };
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 });
    }
    if (!body.projectId || !body.chatId) {
      return NextResponse.json({ error: 'بيانات ناقصة' }, { status: 400 });
    }

    const auth = await requireMembership(body.projectId);
    if ('error' in auth) return auth.error;
    const { supabase } = auth;

    const { error } = await supabase
      .from('telegram_links')
      .delete()
      .eq('project_id', body.projectId)
      .eq('chat_id', body.chatId);

    if (error) {
      console.error('[Telegram Unlink]', error);
      return NextResponse.json({ error: 'فشل الإزالة' }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[Telegram Unlink]', err);
    return NextResponse.json({ error: 'خطأ داخلي' }, { status: 500 });
  }
}
