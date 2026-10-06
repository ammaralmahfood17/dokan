import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * POST /api/pos/cancel
 * Server-side order cancellation with validation.
 * - Verifies user is a staff member of the project
 * - Validates order exists and belongs to the project
 * - Prevents cancelling already delivered/cancelled orders
 * - Logs to audit trail
 */
export async function POST(request: NextRequest) {
  try {
    const userClient = await createClient();
    // B1: getSession() fast local read, then force server-side JWT
    // verification via getUser() — a revoked session (fired staff) must
    // not be able to cancel orders with an unexpired-but-revoked token.
    const {
      data: { session },
    } = await userClient.auth.getSession();
    if (!session) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    }

    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser();
    if (userErr || !user) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    }

        // audit follow-up: a non-JSON body made request.json() throw and the catch-all
    // answered 500 + Sentry noise for input nobody validated. Same shape as the
    // verified public/order fix (W1).
    const rawBody = await request.json().catch(() => null);
    if (rawBody === null || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
      return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 });
    }
    const body = rawBody as { orderId?: string };
    const { orderId } = body;

    if (!orderId) {
      return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 });
    }

    // Verify staff membership. UX-report C2: multi-project staff must be
    // authorized against the ORDER's project, not an arbitrary .limit(1) row
    // (which 404'd legitimate cancels when the picked membership differed).
    const { data: memberships } = await userClient
      .from('staff_members')
      .select('project_id')
      .eq('user_id', user.id);
    const projectIds = (memberships ?? []).map((m) => m.project_id);
    if (!projectIds.length) {
      return NextResponse.json({ error: 'لا يوجد مشروع' }, { status: 403 });
    }

    const supabase = createAdminClient();

    // Get current order state — verify it belongs to one of the user's projects
    const { data: order } = await supabase
      .from('orders')
      .select('id, status')
      .eq('id', orderId)
      .in('project_id', projectIds)
      .single();

    if (!order) {
      return NextResponse.json(
        { error: 'الطلب غير موجود أو لا ينتمي لمشروعك' },
        { status: 404 }
      );
    }

    // Validate: can only cancel orders not yet delivered/cancelled
    if (order.status === 'delivered' || order.status === 'cancelled') {
      return NextResponse.json(
        { error: 'لا يمكن إلغاء طلب تم تسليمه أو إلغاؤه مسبقاً' },
        { status: 400 }
      );
    }

    // The single transition RPC locks the order, validates the state machine,
    // updates it, and inserts the audit event in the same transaction.
    const { data: updated, error: updateErr } = await supabase.rpc('advance_order_status', {
      p_order_id: orderId,
      p_expected_status: order.status,
      p_new_status: 'cancelled',
      p_caller_user_id: user.id,
    });

    if (updateErr?.message.includes('STALE_STATUS')) {
      return NextResponse.json(
        { error: 'تعذر الإلغاء — تغيرت حالة الطلب، حدّث الصفحة وحاول مجدداً' },
        { status: 409 }
      );
    }
    if (updateErr?.message.includes('INVALID_TRANSITION')) {
      return NextResponse.json({ error: 'لا يمكن إلغاء الطلب في حالته الحالية' }, { status: 400 });
    }
    if (updateErr || !updated) {
      console.error('[Cancel] transition error:', updateErr);
      return NextResponse.json({ error: 'فشل إلغاء الطلب' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[Cancel] API error:', err);
    return NextResponse.json({ error: 'خطأ داخلي' }, { status: 500 });
  }
}
