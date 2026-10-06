'use client';

// FIX-C-001: ImageUploader — extracted VERBATIM from products-client.tsx.
// Drag & drop + click-to-upload with compression, preview and remove.
import { useRef, useState } from 'react';
import Image from 'next/image';
import { ImageIcon, X } from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { compressImage, removeProductImage } from '@/lib/products-utils';

export function ImageUploader({
  projectId,
  imageUrl,
  onImageUrlChange,
  productName,
}: {
  projectId: string;
  imageUrl: string;
  onImageUrlChange: (url: string) => void;
  /** AR-2: اسم المنتج للصورة الوصفية (صورة ${productName}) — اختياري */
  productName?: string;
}) {
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null); // Fix 6
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    if (!file.type.startsWith('image/')) {
      toast.error('الملف يجب أن يكون صورة');
      return;
    }
    // Whitelist: JPG/PNG/WebP only (SVG can carry scripts in some contexts)
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      toast.error('الصيغة غير مدعومة — JPG أو PNG أو WebP فقط');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('الحد الأقصى لحجم الصورة 5MB');
      return;
    }

    setUploading(true);
    const objectUrl = URL.createObjectURL(file); // Fix 6: instant preview from File object
    setPreviewUrl(objectUrl);
    try {
      const supabase = createClient();
      const uploadFile = await compressImage(file);
      const extMap: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
      const ext = extMap[uploadFile.type] || 'jpg';
      const path = `${projectId}/products/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

      const { data, error } = await supabase.storage
        .from('product-images')
        .upload(path, uploadFile, { upsert: false, contentType: uploadFile.type });

      if (error) {
        console.error('[Image Upload]', error);
        // Debugging lesson (2026-09-24): the bucket-missing outage surfaced
        // as a generic toast and cost an hours-long diagnosis — always echo
        // the server's actual reason.
        const reason = String(error.message || '').slice(0, 90);
        toast.error(reason ? `فشل رفع الصورة: ${reason}` : 'فشل رفع الصورة');
        return;
      }

      if (data) {
        const { data: { publicUrl } } = supabase.storage
          .from('product-images')
          .getPublicUrl(data.path);
        onImageUrlChange(publicUrl);
        toast.success('تم رفع الصورة');
      }
    } catch {
      toast.error('خطأ في رفع الصورة');
    } finally {
      URL.revokeObjectURL(objectUrl); // Fix 6: cleanup object URL
      setPreviewUrl(null); // Fix 6
      setUploading(false);
    }
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    // Reset so same file can be re-selected
    e.target.value = '';
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(true);
  }

  function onDragLeave() {
    setDragOver(false);
  }

  function removeImage() {
    removeProductImage(imageUrl);
    onImageUrlChange('');
    setPreviewUrl(null); // Fix 6
  }

  return (
    <div className="field">
      <label htmlFor="product-image" className="label">صورة المنتج</label>
      {imageUrl ? (
        <div className="relative inline-block">
          <Image
            src={imageUrl}
            alt={productName ? `صورة ${productName}` : 'صورة المنتج'}
            width={112}
            height={112}
            className="h-28 w-28 rounded-[10px] border border-[var(--color-border)] object-cover"
          />
          <button
            type="button"
            onClick={removeImage}
            aria-label="إزالة الصورة"
            className="absolute -end-3 -top-3 flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--color-danger)] text-white transition-transform hover:scale-110">
              <X className="h-3.5 w-3.5" />
            </span>
          </button>
          <p className="mt-1.5 text-[11.5px] text-[var(--color-text-muted)]">JPG أو PNG أو WebP، حد 5MB</p>
        </div>
      ) : uploading && previewUrl ? (
        // Fix 6: instant preview while uploading
        <div className="relative inline-block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt="معاينة الصورة"
            className="h-28 w-28 rounded-[10px] border border-[var(--color-border)] object-cover"
          />
          <div className="absolute inset-0 flex items-center justify-center rounded-[10px] bg-black/40">
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-white border-t-transparent" />
          </div>
          <p className="mt-1.5 text-[11.5px] text-[var(--color-text-muted)]">جاري رفع الصورة…</p>
        </div>
      ) : (
        <div
          /* audit T1 #20: this dropzone IS a control (click or drop to choose a file), so it
             gets button semantics and a keyboard path. It cannot be a real <button>: the hidden
             file input lives inside it, and interactive content must not nest in a button. */
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              fileInputRef.current?.click();
            }
          }}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onClick={() => fileInputRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-[10px] border-2 border-dashed p-6 transition-colors ${
            dragOver
              ? 'border-[var(--color-primary)] bg-[var(--color-primary-tint)]'
              : 'border-[var(--color-border)] bg-[var(--color-bg)] hover:border-[var(--color-primary)]'
          }`}
        >
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-surface)]">
            <ImageIcon className="h-6 w-6 text-[var(--color-text-secondary)]" />
          </div>
          <p className="text-sm font-semibold text-[var(--color-text-secondary)]">
            اسحب الصورة هنا أو اضغط للاختيار
          </p>
          <p className="mt-0.5 text-[11.5px] text-[var(--color-text-muted)]">
            JPG أو PNG أو WebP، حد أقصى 5MB
          </p>
          <input
            id="product-image"
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={onFileChange}
            disabled={uploading}
            className="hidden"
          />
        </div>
      )}
    </div>
  );
}
