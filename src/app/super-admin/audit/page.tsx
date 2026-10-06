import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireSuperAdmin } from '@/lib/super-admin';
import type { Json } from '@/lib/database.types';

/**
 * Super-admin — audit log viewer (Phase A).
 * Filterable by actor email, action, and date range. Read-only, service_role.
 */
export const dynamic = 'force-dynamic';

const ACTION_LABELS: Record<string, string> = {
  'subscription.renew': 'تجديد اشتراك',
  'project.deactivate': 'إيقاف مشروع',
  'project.create': 'إنشاء مشروع',
  'project.archive': 'أرشفة مشروع',
  'project.hard_delete': 'حذف نهائي',
  'impersonation.start': 'بدء وضع الدعم',
  'impersonation.end': 'إنهاء وضع الدعم',
};

const dateFmt = new Intl.DateTimeFormat('ar', {
  numberingSystem: 'latn',
  timeZone: 'Asia/Bahrain',
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export default async function SuperAdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ actor?: string; action?: string; from?: string; to?: string }>;
}) {
  await requireSuperAdmin();
  const sp = await searchParams;

  const admin = createAdminClient();

  // Resolve actor email → user id (filters come in as emails).
  let actorUserId: string | null = null;
  if (sp.actor) {
    const { data: users } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    actorUserId = users.users.find((u) => u.email === sp.actor)?.id ?? null;
  }

  let q = admin
    .from('super_admin_audit_log')
    .select('id, actor_user_id, action, target_project_id, target_user_id, metadata, created_at')
    .order('created_at', { ascending: false })
    .limit(300);

  if (actorUserId) q = q.eq('actor_user_id', actorUserId);
  if (sp.action) q = q.eq('action', sp.action);
  if (sp.from) q = q.gte('created_at', new Date(sp.from).toISOString());
  if (sp.to) q = q.lte('created_at', new Date(`${sp.to}T23:59:59`).toISOString());

  const { data: logs } = await q;

  // Actor emails + target project names for display.
  const { data: users } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const emailById = new Map(users.users.map((u) => [u.id, u.email ?? '']));
  const projectIds = [...new Set((logs ?? []).map((l) => l.target_project_id as string | null).filter(Boolean))];
  const { data: projects } =
    projectIds.length > 0
      ? await admin.from('projects').select('id, name').in('id', projectIds as string[])
      : { data: [] };
  const projectNameById = new Map((projects ?? []).map((p) => [p.id as string, p.name as string]));

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold">سجل العمليات</h1>
        <p className="text-xs text-[var(--color-text-secondary)]">
          كل إجراء من لوحة التحكم الرئيسية — من فعل ماذا ومتى
        </p>
      </div>

      <form method="get" className="mb-4 flex flex-wrap items-end gap-2 text-sm">
        <label className="flex flex-col gap-1 text-xs font-semibold">
          المنفّذ (إيميل)
          <input name="actor" defaultValue={sp.actor ?? ''} className="input h-9 w-52" placeholder="owner@…" maxLength={120} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold">
          الإجراء
          <select name="action" defaultValue={sp.action ?? ''} className="select h-9 w-44">
            <option value="">الكل</option>
            {Object.entries(ACTION_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold">
          من
          <input type="date" name="from" defaultValue={sp.from ?? ''} className="input h-9" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold">
          إلى
          <input type="date" name="to" defaultValue={sp.to ?? ''} className="input h-9" />
        </label>
        <button type="submit" className="btn btn-primary h-9">
          فلترة
        </button>
        <Link href="/super-admin/audit" className="btn btn-ghost h-9">
          مسح
        </Link>
      </form>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[720px] text-start text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-xs text-[var(--color-text-secondary)]">
              <th className="px-3 py-2.5 font-semibold">الوقت</th>
              <th className="px-3 py-2.5 font-semibold">المنفّذ</th>
              <th className="px-3 py-2.5 font-semibold">الإجراء</th>
              <th className="px-3 py-2.5 font-semibold">المشروع</th>
              <th className="px-3 py-2.5 font-semibold">تفاصيل</th>
            </tr>
          </thead>
          <tbody>
            {(logs ?? []).map((l) => {
              const meta = (l.metadata ?? {}) as Record<string, unknown>;
              const detail = meta.projectName ?? meta.reason ?? meta.days
                ? JSON.stringify(meta)
                : '';
              return (
                <tr key={l.id as string} className="border-b border-[var(--color-border)]/60 last:border-0">
                  <td className="px-3 py-2.5 whitespace-nowrap text-[var(--color-text-secondary)]">
                    {dateFmt.format(new Date(l.created_at as string))}
                  </td>
                  <td className="px-3 py-2.5" dir="ltr">
                    {emailById.get(l.actor_user_id as string) ?? '—'}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="font-bold">{ACTION_LABELS[l.action as string] ?? l.action}</span>
                  </td>
                  <td className="px-3 py-2.5 text-[var(--color-text-secondary)]">
                    {l.target_project_id ? projectNameById.get(l.target_project_id as string) ?? '—' : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-[11.5px] text-[var(--color-text-muted)]" dir="ltr">
                    {detail}
                  </td>
                </tr>
              );
            })}
            {(logs ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-sm text-[var(--color-text-secondary)]">
                  لا سجلات مطابقة
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
