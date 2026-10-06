import { createAdminClient } from '@/lib/supabase/admin';
import { requireSuperAdmin } from '@/lib/super-admin';
import { ConfirmUserButton } from '@/components/project-admin-actions';

/**
 * Super-admin — accounts awaiting email confirmation (amendment A5, owner decision 3).
 *
 * Confirmations are ON, so an unconfirmed account cannot sign in. With SMTP not yet wired up
 * the confirmation mail may never arrive, which would leave those merchants with no way
 * forward — the confirm action in this list is that way.
 *
 * Read-only: it lists what needs attention and hands each row to a button that posts to
 * /api/super-admin/confirm-user (which re-checks super-admin membership at mutation time).
 */
export const dynamic = 'force-dynamic';

const dateFmt = new Intl.DateTimeFormat('ar', { dateStyle: 'medium', timeStyle: 'short' });

export default async function SuperAdminUsersPage() {
  await requireSuperAdmin();

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const users = data?.users ?? [];
  const pending = users.filter((u) => !u.email_confirmed_at);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>الحسابات</h1>
          <p>حسابات بانتظار تأكيد البريد الإلكتروني</p>
        </div>
      </div>

      {error && (
        <p className="error-text mb-4">تعذّر تحميل الحسابات: {error.message}</p>
      )}

      {pending.length === 0 ? (
        <div className="card card-body text-sm text-[var(--color-text-secondary)]">
          ما فيه حسابات بانتظار التأكيد حالياً.
        </div>
      ) : (
        <div className="space-y-2">
          {pending.map((u) => (
            <div
              key={u.id}
              className="card card-body flex flex-wrap items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <p dir="ltr" className="truncate text-sm font-semibold">
                  {u.email ?? '—'}
                </p>
                <p className="text-[11.5px] text-[var(--color-text-tertiary)]">
                  أُنشئ: {dateFmt.format(new Date(u.created_at))}
                </p>
              </div>
              <ConfirmUserButton userId={u.id} email={u.email ?? ''} />
            </div>
          ))}
        </div>
      )}

      {users.length >= 200 && (
        <p className="mt-3 text-[11.5px] text-[var(--color-text-tertiary)]">
          نعرض أول 200 حساب فقط — إذا العدد أكبر، نضيف ترقيم صفحات.
        </p>
      )}
    </div>
  );
}
