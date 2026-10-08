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
  /** When the merchant reprinted the table QR sheets (owner decision 1). NULL = pending. */
  qr_reprinted_at: string | null;
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

export type IngredientUnit = 'g' | 'ml' | 'each';

export interface Supplier {
  id: string;
  project_id: string;
  name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  created_at: string;
}

export interface Ingredient {
  id: string;
  project_id: string;
  name: string;
  unit: IngredientUnit;
  quantity_on_hand: number;
  reorder_point: number;
  supplier_id: string | null;
  supplier_sku: string | null;
  created_at: string;
}

export interface ProductIngredient {
  id: string;
  project_id: string;
  product_id: string;
  ingredient_id: string;
  quantity_per_product: number;
  created_at: string;
}

export type InventoryMovementType = 'receive' | 'adjustment' | 'consume' | 'restore';

export interface InventoryMovement {
  id: string;
  project_id: string;
  ingredient_id: string;
  order_id: string | null;
  movement_type: InventoryMovementType;
  quantity_delta: number;
  stock_after: number;
  unit: IngredientUnit;
  notes: string | null;
  actor_user_id: string | null;
  created_at: string;
}

/**
 * A product can carry MANY option groups («خيارات»), and each group holds its
 * own varieties («أنواع») with their own price. This replaced the flat,
 * single-level addon list on 2026-10-06 (owner decision: options only).
 *
 * min_select = 0 → optional; >= 1 → the customer must pick that many.
 * max_select = 1 → single choice (radios); higher → multi-select.
 */
export interface ProductOptionChoice {
  id: string;
  group_id: string;
  name: string;
  name_en: string | null;
  price: number;
  is_available: boolean;
  sort_order: number;
}

export interface ProductOptionGroup {
  id: string;
  product_id: string;
  name: string;
  name_en: string | null;
  min_select: number;
  max_select: number;
  sort_order: number;
  option_choices: ProductOptionChoice[];
}

/**
 * Snapshot of the chosen varieties stored on an order line. The FIELD that
 * carries it keeps the name `addons` because it mirrors the `order_items.addons`
 * column (renaming the column would ripple through the cart, the KDS, the POS
 * and the offline queue for no behavioural gain) — but the concept is options.
 */
export interface OrderItemOption {
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
  addons: OrderItemOption[];
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
  optionIds?: string[];
  notes?: string;
}



/** Cart line used on the public menu */
export interface CartLine {
  key: string;
  productId: string;
  productName: string;
  unitPrice: number;
  quantity: number;
  addons: OrderItemOption[];
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

export const DEFAULT_PRIMARY_COLOR = '#7047EB';
