import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireSuperAdmin } from '@/lib/super-admin';
import { ImpersonateButton } from '@/components/impersonate-button';
import { CreateProjectForm, ProjectRowActions, RecordPaymentButton } from '@/components/project-admin-actions';
import type { Json } from '@/lib/database.types';

/**
 * Super-admin — subscriptions list (Phase A).
 * Read-only view + renew/deactivate actions (POSTed to API routes which
 * re-check super-admin membership at mutation time).
 */
export const dynamic = 'force-dynamic';

type ProjectRow = {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  subscription_expires_at: string | null;
  deleted_at: string | null;
  created_at: string;
};

function daysLeft(expiry: string | null): number | null {
  if (!expiry) return null;
  return Math.ceil((new Date(expiry).getTime() - Date.now()) / 86400e3);
}

function statusBadge(p: ProjectRow): { label: string; cls: string } {
  const d = daysLeft(p.subscription_expires_at);
  if (!p.is_active) return { label: 'موقوف', cls: 'bg-[var(--color-danger-tint)] text-[var(--color-danger)]' };
  if (d === null) return { label: 'نشط', cls: 'bg-[var(--color-success)]/10 text-[var(--color-success)]' };
  if (d < 0) return { label: 'منتهي', cls: 'bg-[var(--color-danger-tint)] text-[var(--color-danger)]' };
  // FIX-D-002: ألوان tokens بدل hex يدوي (warn-tint/warn = نفس الدرجة اللونية)
  if (d <= 7) return { label: `ينتهي قريبًا (${d}d)`, cls: 'bg-[var(--color-warn-tint)] text-[var(--color-warn)]' };
  return { label: 'نشط', cls: 'bg-[var(--color-success)]/10 text-[var(--color-success)]' };
}

const dateFmt = new Intl.DateTimeFormat('ar', {
  numberingSystem: 'latn',
  timeZone: 'Asia/Bahrain',
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

export default async function SuperAdminSubscriptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; archived?: string }>;
}) {
  await requireSuperAdmin();
  const { q, archived } = await searchParams;
  const query = (q ?? '').trim();
  const showArchived = archived === '1';

  const admin = createAdminClient();

  let queryBuilder = admin
    .from('projects')
    .select('id, name, slug, is_active, subscription_expires_at, deleted_at, created_at')
    .order('created_at', { ascending: false })
    .limit(300);

  // Archived projects hidden by default — shown only via ?archived=1.
  if (!showArchived) {
    queryBuilder = queryBuilder.is('deleted_at', null);
  }

  if (query) {
    queryBuilder = queryBuilder.ilike('name', `%${query}%`);
  }

  const { data: projects } = await queryBuilder;
  const rows = (projects ?? []) as unknown as ProjectRow[];

  // Owner lookup: first 'owner' staff member per project (emails via auth admin).
  const ownerByProject = new Map<string, { email: string; userId: string }>();
  if (rows.length) {
    const { data: owners } = await admin
      .from('staff_members')
      .select('project_id, user_id')
      .in(
        'project_id',
        rows.map((r) => r.id)
      )
      .eq('role', 'owner');
    const userIds = [...new Set((owners ?? []).map((o) => o.user_id as string))];
    const { data: users } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const emailById = new Map(users.users.map((u) => [u.id, u.email ?? '']));
    for (const o of owners ?? []) {
      if (!ownerByProject.has(o.project_id as string)) {
        ownerByProject.set(o.project_id as string, {
          email: emailById.get(o.user_id as string) ?? '',
          userId: o.user_id as string,
        });
      }
    }
  }

  return (
    <div>
      <CreateProjectForm />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">الاشتراكات</h1>
          <p className="text-xs text-[var(--color-text-secondary)]">
            {showArchived ? 'المشاريع المؤرشفة' : 'المشاريع النشطة'} — {rows.length} مشروع
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <form method="get" className="flex gap-2">
            {showArchived && <input type="hidden" name="archived" value="1" />}
            <input
              name="q"
              defaultValue={query}
              placeholder="ابحث باسم المتجر…"
              className="input h-10 w-56"
              maxLength={80}
            />
            <button type="submit" className="btn btn-primary">
              بحث
            </button>
          </form>
          <Link
            href={showArchived ? '/super-admin/subscriptions' : '/super-admin/subscriptions?archived=1'}
            className="btn btn-ghost btn-sm"
          >
            {showArchived ? 'إخفاء المؤرشفة' : 'المؤرشفة'}
          </Link>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[640px] text-start text-sm">
          {/* FIX-T-004: رأس ثابت عند التمرير (جدول الاشتراكات طويل) */}
          <thead className="sticky top-0 z-[var(--z-sticky)] bg-[var(--color-surface)]">
            <tr className="border-b border-[var(--color-border)] text-xs text-[var(--color-text-secondary)]">
              <th className="px-3 py-2.5 font-semibold">المتجر</th>
              <th className="px-3 py-2.5 font-semibold">المالك</th>
              <th className="px-3 py-2.5 font-semibold">الحالة</th>
              <th className="px-3 py-2.5 font-semibold">ينتهي في</th>
              <th className="px-3 py-2.5 font-semibold">أُنشئ</th>
              <th className="px-3 py-2.5 font-semibold">إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const badge = statusBadge(p);
              const d = daysLeft(p.subscription_expires_at);
              return (
                <tr key={p.id} className="border-b border-[var(--color-border)]/60 last:border-0">
                  <td className="px-3 py-2.5">
                    <div className="font-bold">{p.name}</div>
                    <div className="text-[11px] text-[var(--color-text-muted)]" dir="ltr">
                      {p.slug}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-[var(--color-text-secondary)]">
                    {ownerByProject.get(p.id)?.email ?? '—'}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold ${badge.cls}`}>
                      {badge.label}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-[var(--color-text-secondary)]">
                    {p.subscription_expires_at
                      ? `${dateFmt.format(new Date(p.subscription_expires_at))}${d !== null && d < 0 ? ' (منتهي)' : ''}`
                      : 'دائم'}
                  </td>
                  <td className="px-3 py-2.5 text-[var(--color-text-secondary)]">
                    {dateFmt.format(new Date(p.created_at))}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex gap-1.5">
                      {ownerByProject.get(p.id) && (
                        <ImpersonateButton
                          ownerUserId={ownerByProject.get(p.id)!.userId}
                          ownerEmail={ownerByProject.get(p.id)!.email}
                          projectId={p.id}
                          projectName={p.name}
                        />
                      )}
                      <form
                        method="post"
                        action={`/api/super-admin/renew?projectId=${p.id}`}
                      >
                        <button type="submit" className="btn btn-ghost btn-sm">
                          +30 يوم
                        </button>
                      </form>
                      <RecordPaymentButton projectId={p.id} projectName={p.name} />
                      {p.is_active && (
                        <form
                          method="post"
                          action={`/api/super-admin/deactivate?projectId=${p.id}`}
                        >
                          <button type="submit" className="btn btn-ghost btn-sm text-[var(--color-danger)]">
                            إيقاف
                          </button>
                        </form>
                      )}
                      <ProjectRowActions
                        projectId={p.id}
                        projectName={p.name}
                        deletedAt={p.deleted_at}
                      />
                      {p.deleted_at && (
                        <span className="inline-flex items-center rounded-full bg-[var(--color-surface-sunken)] px-2 py-0.5 text-[10px] font-bold text-[var(--color-text-muted)]">
                          مؤرشف
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-sm text-[var(--color-text-secondary)]">
                  لا مشاريع مطابقة
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-[11px] text-[var(--color-text-muted)]">
        كل إجراء (تجديد/إيقاف) يُسجَّل في سجل العمليات مع هوية المنفّذ وتوقيته.
      </p>
      <Link href="/super-admin/audit" className="mt-1 inline-block text-xs font-semibold text-[var(--color-primary)]">
        ← عرض سجل العمليات
      </Link>
    </div>
  );
}
