const DB_NAME = 'dokan-pending-orders';
const STORE_NAME = 'orders';
const DB_VERSION = 1;

export type PendingOrderPayload = {
  projectSlug: string;
  tableSlug: string;
  clientRequestId: string;
  notes?: string;
  items: Array<{
    productId: string;
    quantity: number;
    addonIds: string[];
    notes?: string;
  }>;
};

function openPendingOrdersDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('pending order database is blocked'));
  });
}

function waitForTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function queuePendingOrder(
  id: string,
  payload: PendingOrderPayload
): Promise<void> {
  const db = await openPendingOrdersDb();
  try {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const completed = waitForTransaction(transaction);
    transaction.objectStore(STORE_NAME).put({ id, payload });
    await completed;
  } finally {
    db.close();
  }
}

export async function removePendingOrder(id: string): Promise<void> {
  const db = await openPendingOrdersDb();
  try {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const completed = waitForTransaction(transaction);
    transaction.objectStore(STORE_NAME).delete(id);
    await completed;
  } finally {
    db.close();
  }
}

export async function registerPendingOrderSync(): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('SyncManager' in window)) return false;

  const registration = await navigator.serviceWorker.ready;
  const sync = (
    registration as ServiceWorkerRegistration & {
      sync?: { register: (tag: string) => Promise<void> };
    }
  ).sync;
  if (!sync) return false;

  await sync.register('submit-pending-order');
  return true;
}
