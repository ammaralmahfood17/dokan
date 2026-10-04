/**
 * Dokan domain types — aligned with the exact product schema.
 * Money values use 3 decimal places (BHD).
 */

export type Currency = 'BHD' | 'SAR' | 'KWD' | 'AED' | 'OMR' | 'QAR';

export type OrderType = 'dinein' | 'walkin' | 'drivethru';

export type OrderStatus =
  | 'pending'
  | 'preparing'
  | 'ready'
  | 'delivered'
  | 'cancelled';

/** Per-item cooking state on the KDS (item-level kanban). */
export type OrderItemStatus = 'pending' | 'preparing' | 'ready';

export type StaffRole = 'owner' | 'manager' | 'staff';

export interface Project {
  id: string;
  name: string;
  slug: string;
  currency: string;
  primary_color: string;
  logo_url: string | null;
  is_active: boolean;
  subscription_expires_at: string | null;
  deleted_at: string | null;
  created_at: string;
}

export interface Table {
  id: string;
  project_id: string;
  branch_id: string | null;
  number: number;
  slug: string;
  qrcode: string;
  is_active: boolean;
  created_at?: string;
}

export interface Category {
  id: string;
  project_id: string;
  name: string;
  name_en: string | null;
  sort_order: number;
  is_active?: boolean;
  created_at?: string;
}

export interface Product {
  id: string;
  project_id: string;
  category_id: string | null;
  name: string;
  name_en: string | null;
  description: string | null;
  price: number;
  image_url: string | null;
  is_available: boolean;
  /** NULL = untracked (unlimited). Otherwise portions left; 0 = sold out.
   *  Never merged into is_available — that switch belongs to the merchant. */
  stock: number | null;
  sort_order: number;
  created_at?: string;
}

export interface ProductAddon {
  id: string;
  product_id: string;
  name: string;
  price: number;
  is_available: boolean;
}

/** Snapshot of an addon stored on an order line */
export interface OrderItemAddon {
  id: string;
  name: string;
  price: number;
}

export interface Order {
  id: string;
  project_id: string;
  table_id: string | null;
  type: OrderType;
  status: OrderStatus;
  total_amount: number;
  order_number: number;
  notes: string | null;
  created_at: string;
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string | null;
  product_name: string;
  quantity: number;
  unit_price: number;
  addons: OrderItemAddon[];
  notes: string | null;
  /** KDS cooking state — derived order status syncs automatically. */
  status?: OrderItemStatus;
}

export interface StaffMember {
  id: string;
  project_id: string;
  user_id: string;
  role: StaffRole;
  created_at?: string;
}

/** Public order API request body */
export interface PublicOrderItemInput {
  productId: string;
  quantity: number;
  addonIds?: string[];
  notes?: string;
}



/** Cart line used on the public menu */
export interface CartLine {
  key: string;
  productId: string;
  productName: string;
  unitPrice: number;
  quantity: number;
  addons: OrderItemAddon[];
  notes: string;
}

/** Dashboard onboarding checklist item */
export interface ChecklistItem {
  id: string;
  label: string;
  done: boolean;
  href: string;
}

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'جديد',
  preparing: 'قيد التحضير',
  ready: 'جاهز',
  delivered: 'تم التسليم',
  cancelled: 'ملغى',
};

export const ORDER_TYPE_LABELS: Record<OrderType, string> = {
  dinein: 'طاولة',
  walkin: 'سفري',
  drivethru: 'سيارة',
};

export const CURRENCIES: { value: Currency; label: string }[] = [
  { value: 'BHD', label: 'دينار بحريني (BHD)' },
  { value: 'SAR', label: 'ريال سعودي (SAR)' },
  { value: 'KWD', label: 'دينار كويتي (KWD)' },
  { value: 'AED', label: 'درهم إماراتي (AED)' },
  { value: 'OMR', label: 'ريال عُماني (OMR)' },
  { value: 'QAR', label: 'ريال قطري (QAR)' },
];

export const DEFAULT_PRIMARY_COLOR = '#4F46E5';
