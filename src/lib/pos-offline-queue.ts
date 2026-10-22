/**
 * POS offline queue (Wave 3).
 *
 * WHY THIS EXISTS: `pending-orders.ts` queues the CUSTOMER's order (service
 * worker + background sync). The POS had nothing: a network drop during a rush
 * meant the cashier's sale was never recorded, and the only signal was a toast.
 *
 * DESIGN RULES (each one is a bug this file refuses to reintroduce):
 *  1. The clientRequestId is generated BEFORE the first attempt and reused on
 *     every retry. `create_order_transactional` is idempotent on it, so a lost
 *     response cannot create a second order. A fresh sale always gets a fresh
 *     id — a deliberate double tap is still two orders.
 *  2. Nothing is removed from the queue until the server answers. A 2xx OR a
 *     4xx removes it (a 409 «الصنف نفد» will never succeed — it is surfaced to
 *     the cashier, not retried forever); a network error / 5xx keeps it.
 *  3. The queue stores product ids + option ids only, never a price. The server
 *     prices every order; a stale client price must not survive a reconnect.
 *  4. No stock is reserved locally. If the item sold out while offline the
 *     server's 409 is the truth.
 */
const DB_NAME = 'dokan-pos-queue';
const STORE = 'orders';
const VERSION = 1;

export type PosQueuePayload = {
  projectId: string;
  type: 'walkin' | 'drivethru' | 'dinein';
  notes?: string;
  items: Array<{ productId: string; quantity: number; optionIds: string[] }>;
};

export type PosQueueItem = {
  /** == clientRequestId; the keyPath, so a retry cannot fork the order. */
  id: string;
  payload: PosQueuePayload;
  createdAt: number;
  attempts: number;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('pos queue database is blocked'));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = run(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function enqueuePosOrder(item: PosQueueItem): Promise<void> {
  await withStore('readwrite', (store) => store.put(item));
}

export async function listPosQueue(): Promise<PosQueueItem[]> {
  const all = await withStore<PosQueueItem[]>('readonly', (store) => store.getAll());
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

export async function removePosOrder(id: string): Promise<void> {
  await withStore('readwrite', (store) => store.delete(id));
}

export async function pendingPosCount(): Promise<number> {
  return withStore<number>('readonly', (store) => store.count());
}

/**
 * What to do with a failed send. Pure on purpose: the decision is the part that
 * must not drift, and it is the part a test can drive without a browser.
 *
 *  - no status (fetch threw) → retry (the request may never have left)
 *  - 5xx / 429              → retry (server or throttle, the order is still valid)
 *  - 409 / 400 / 403 / 401  → drop (the server will never accept THIS payload;
 *                             keeping it would retry a sold-out item forever)
 */
export type SubmitOutcome = 'retry' | 'drop';

export function classifyFailure(status: number | null): SubmitOutcome {
  if (status === null) return 'retry';
  if (status >= 500 || status === 429) return 'retry';
  return 'drop';
}
