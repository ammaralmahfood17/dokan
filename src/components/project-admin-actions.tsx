'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { CreditCard } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';

/**
 * Phase D — project create / archive / hard-delete for super admins.
 * - Archive = SOFT delete (default): deleted_at set, data retained, reason required.
 * - Hard delete = deliberately separate: type the EXACT project name + reason.
 * Both post to server routes that re-check super-admin membership.
 */

export function CreateProjectForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [slug, setSlug] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/super-admin/create-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, ownerEmail, slug: slug.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'فشل الإنشاء');
        return;
      }
      toast.success(`تم إنشاء ${data.project.name}`);
      setName('');
      setOwnerEmail('');
      setSlug('');
      router.refresh();
    } catch {
      toast.error('فشل الإنشاء');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card card-body mb-6">
      <h2 className="mb-3 text-sm font-bold">إنشاء متجر لعميل</h2>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs font-semibold">
          اسم المتجر *
          <input
            className="input h-9"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={80}
            placeholder="مثال: مقهى الخليج"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold">
          إيميل المالك (مسجّل مسبقًا) *
          <input
            className="input h-9"
            dir="ltr"
            type="email"
            value={ownerEmail}
            onChange={(e) => setOwnerEmail(e.target.value)}
            required
            maxLength={120}
            placeholder="owner@example.com"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold">
          المعرّف (اختياري — يُولّد تلقائيًا)
          <input
            className="input h-9"
            dir="ltr"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            maxLength={60}
            placeholder="my-store"
          />
        </label>
      </div>
      <div className="mt-3">
        <Button type="submit" disabled={busy}>
          {busy ? 'جاري الإنشاء…' : 'إنشاء المتجر'}
        </Button>
      </div>
    </form>
  );
}

export function ProjectRowActions({
  projectId,
  projectName,
  deletedAt,
}: {
  projectId: string;
  projectName: string;
  deletedAt: string | null;
}) {
  const router = useRouter();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [confirmName, setConfirmName] = useState('');
  const [busy, setBusy] = useState(false);
  const [renderedAt] = useState(() => Date.now());
  const deleteEligibleAt = deletedAt
    ? new Date(new Date(deletedAt).getTime() + 30 * 86400e3)
    : null;
  const canHardDelete = Boolean(deleteEligibleAt && deleteEligibleAt.getTime() <= renderedAt);

  async function archive() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/super-admin/archive-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, reason }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'فشل الأرشفة');
        return;
      }
      toast.success('تمت الأرشفة (البيانات محفوظة)');
      setArchiveOpen(false);
      setReason('');
      router.refresh();
    } catch {
      toast.error('فشل الأرشفة');
    } finally {
      setBusy(false);
    }
  }

  async function hardDelete() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/super-admin/hard-delete-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, confirmName, reason }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'فشل الحذف');
        return;
      }
      toast.success('تم الحذف النهائي');
      setDeleteOpen(false);
      setReason('');
      setConfirmName('');
      router.refresh();
    } catch {
      toast.error('فشل الحذف');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex gap-1.5">
        {!deletedAt && (
          <button
            type="button"
            onClick={() => setArchiveOpen(true)}
            className="btn btn-ghost btn-sm text-[var(--color-text-secondary)]"
          >
            أرشفة
          </button>
        )}
        {deletedAt && (
          <button
            type="button"
            onClick={() => setDeleteOpen(true)}
            disabled={!canHardDelete}
            title={
              canHardDelete
                ? 'حذف المشروع المؤرشف نهائيًا'
                : `متاح بعد ${deleteEligibleAt?.toLocaleDateString('ar-BH-u-nu-latn')}`
            }
            className="btn btn-ghost btn-sm text-[var(--color-danger)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {canHardDelete ? 'حذف نهائي' : 'فترة الاحتفاظ 30 يومًا'}
          </button>
        )}
      </div>

      {/* Archive (soft) — reason required */}
      {archiveOpen && !deletedAt && (
        <Modal onClose={() => setArchiveOpen(false)} title="أرشفة المتجر">
          <div className="space-y-4">
            <p className="text-xs leading-relaxed text-[var(--color-text-secondary)]">
              الأرشفة تُغلق المتجر فورًا (لوحة الموظفين + المنيو العام) مع
              <span className="font-bold"> حفظ كل البيانات</span>. يمكن التراجع
              لاحقًا.
            </p>
            <label className="flex flex-col gap-1 text-xs font-semibold">
              السبب (إلزامي)
              <textarea
                className="input min-h-[80px] resize-y py-2"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
                placeholder="مثال: إيقاف الخدمة لعدم الدفع"
              />
            </label>
            <div className="flex gap-2">
              <Button variant="danger" block disabled={busy || !reason.trim()} onClick={archive}>
                {busy ? 'جاري…' : 'تأكيد الأرشفة'}
              </Button>
              <Button variant="secondary" onClick={() => setArchiveOpen(false)}>
                رجوع
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Hard delete — exact name + reason, deliberately separate */}
      {deleteOpen && deletedAt && canHardDelete && (
        <Modal onClose={() => setDeleteOpen(false)} title="حذف نهائي — لا رجعة">
          <div className="space-y-4">
            <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[var(--color-danger-tint)] p-3 text-xs leading-relaxed text-[var(--color-danger)]">
              الحذف النهائي <span className="font-bold">يمسح بيانات التشغيل</span> بعد
              انتهاء فترة الاحتفاظ. يبقى سجل الدفعات محفوظًا لأغراض التدقيق المالي.
            </div>
            <label className="flex flex-col gap-1 text-xs font-semibold">
              اكتب اسم المتجر بالضبط للتأكيد: <span dir="ltr">{projectName}</span>
              <input
                className="input h-9"
                dir="ltr"
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                maxLength={80}
                placeholder={projectName}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold">
              السبب (إلزامي)
              <textarea
                className="input min-h-[80px] resize-y py-2"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
                placeholder="اكتب سببًا واضحًا من 10 أحرف على الأقل"
              />
            </label>
            <div className="flex gap-2">
              <Button
                variant="danger"
                block
                disabled={busy || confirmName.trim() !== projectName || reason.trim().length < 10}
                onClick={hardDelete}
              >
                {busy ? 'جاري…' : 'حذف نهائي'}
              </Button>
              <Button variant="secondary" onClick={() => setDeleteOpen(false)}>
                رجوع
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

/** A3: Record manual payment (bank transfer / stc pay) + auto-renew subscription. */
export function RecordPaymentButton({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('7');
  const [method, setMethod] = useState<'bank-transfer' | 'stc-pay'>('bank-transfer');
  const [receipt, setReceipt] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  // Audit T2 #11: ONE key per payment attempt. A retry after a network hiccup reuses it, so the
  // RPC answers with the first renewal instead of extending the subscription twice.
  const [clientRequestId, setClientRequestId] = useState(() => crypto.randomUUID());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const numAmount = Number(amount);
    if (!Number.isFinite(numAmount) || numAmount <= 0) {
      toast.error('المبلغ يجب أن يكون أكبر من صفر');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/super-admin/record-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          amount: numAmount,
          method,
          receipt: receipt.trim() || undefined,
          notes: notes.trim() || undefined,
          days: 30,
          clientRequestId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'فشل تسجيل الدفع');
        return;
      }
      toast.success(data.message || 'تم التسجيل والتجديد');
      setOpen(false);
      setReceipt('');
      setNotes('');
      router.refresh();
    } catch {
      toast.error('فشل تسجيل الدفع');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setClientRequestId(crypto.randomUUID());
          setOpen(true);
        }}
        className="btn btn-ghost btn-sm text-[var(--color-success)]"
      >
        <CreditCard className="h-3.5 w-3.5" />
        تسجيل دفع
      </button>

      {open && (
        <Modal onClose={() => setOpen(false)} title={`تسجيل دفع — ${projectName}`}>
          <form onSubmit={submit} className="space-y-4">
            <label className="flex flex-col gap-1 text-xs font-semibold">
              المبلغ (د.ب)
              <input
                className="input h-9"
                type="number"
                inputMode="decimal"
                min={1}
                step="0.001"
                required
                dir="ltr"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold">
              طريقة الدفع
              <select
                className="input h-9"
                value={method}
                onChange={(e) => setMethod(e.target.value as 'bank-transfer' | 'stc-pay')}
              >
                <option value="bank-transfer">تحويل بنكي</option>
                <option value="stc-pay">stc pay</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold">
              رقم الإيصال (اختياري)
              <input
                className="input h-9"
                dir="ltr"
                value={receipt}
                onChange={(e) => setReceipt(e.target.value)}
                maxLength={100}
                placeholder="REF-12345"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold">
              ملاحظات (اختياري)
              <textarea
                className="input min-h-[60px] resize-y py-2"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={300}
                placeholder="أي ملاحظات إضافية"
              />
            </label>
            <p className="text-[11.5px] text-[var(--color-text-tertiary)]">
              التسجيل يُجدّد الاشتراك تلقائياً 30 يوم من الآن
            </p>
            <div className="flex gap-2">
              <Button type="submit" block disabled={busy}>
                {busy ? 'جاري…' : 'تأكيد الدفع والتجديد'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                إلغاء
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

/**
 * Manual email confirmation — amendment A5 (owner decision 3).
 *
 * Confirmations are ON and the confirmation mail depends on SMTP, which is not wired up yet.
 * This button is the escape hatch for a merchant who signed up but cannot sign in.
 */
export function ConfirmUserButton({ userId, email }: { userId: string; email: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/super-admin/confirm-user?userId=${encodeURIComponent(userId)}`,
        { method: 'POST' }
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error || 'فشل تأكيد الحساب');
        return;
      }
      toast.success(
        data?.alreadyConfirmed ? 'الحساب مؤكد من قبل' : `أكّدنا ${email || 'الحساب'}`
      );
      router.refresh();
    } catch {
      toast.error('فشل تأكيد الحساب');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button type="button" variant="secondary" size="sm" onClick={() => void confirm()} disabled={busy}>
      {busy ? 'جاري…' : 'تأكيد الحساب'}
    </Button>
  );
}
