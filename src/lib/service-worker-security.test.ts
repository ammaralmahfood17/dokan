import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

type FetchEvent = {
  request: { url: string; method: string; mode: string };
  respondWith(response: Promise<Response>): void;
};

type SyncEvent = {
  tag: string;
  waitUntil(response: Promise<void>): void;
};

type WorkerEvent = FetchEvent | SyncEvent;

function createPendingOrderDb(initial: Array<{ id: string; payload: unknown }>) {
  const records = new Map(initial.map((record) => [record.id, record]));

  return {
    records,
    indexedDB: {
      open: vi.fn(() => {
        const request: {
          result?: unknown;
          error?: unknown;
          onsuccess?: () => void;
          onerror?: () => void;
          onblocked?: () => void;
          onupgradeneeded?: () => void;
        } = {};

        queueMicrotask(() => {
          request.result = {
            close: vi.fn(),
            objectStoreNames: { contains: () => true },
            createObjectStore: vi.fn(),
            transaction: (_name: string, mode: string) => {
              const transaction: {
                error: unknown;
                oncomplete?: () => void;
                onerror?: () => void;
                onabort?: () => void;
                objectStore: () => {
                  getAll: () => Record<string, unknown>;
                  delete: (id: string) => Record<string, unknown>;
                };
              } = {
                error: null,
                oncomplete: undefined,
                onerror: undefined,
                onabort: undefined,
                objectStore: () => ({
                  getAll: () => {
                    const read: Record<string, unknown> = {};
                    queueMicrotask(() => {
                      read.result = [...records.values()];
                      (read.onsuccess as (() => void) | undefined)?.();
                    });
                    return read;
                  },
                  delete: (id: string) => {
                    const deletion: Record<string, unknown> = {};
                    queueMicrotask(() => {
                      records.delete(id);
                      (deletion.onsuccess as (() => void) | undefined)?.();
                      if (mode === 'readwrite') transaction.oncomplete?.();
                    });
                    return deletion;
                  },
                }),
              };
              return transaction;
            },
          };
          request.onsuccess?.();
        });
        return request;
      }),
    },
  };
}

function loadServiceWorker(
  fetchMock: ReturnType<typeof vi.fn>,
  indexedDB: unknown = {},
  windowClients: Array<{ postMessage: ReturnType<typeof vi.fn> }> = []
) {
  const handlers = new Map<string, (event: WorkerEvent) => void>();
  const cacheOpen = vi.fn();
  const source = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8');

  vm.runInNewContext(source, {
    URL,
    Response,
    fetch: fetchMock,
    indexedDB,
    caches: {
      open: cacheOpen,
      keys: vi.fn(async () => []),
      match: vi.fn(async () => undefined),
      delete: vi.fn(async () => true),
    },
    self: {
      addEventListener: (name: string, handler: (event: WorkerEvent) => void) => {
        handlers.set(name, handler);
      },
      skipWaiting: vi.fn(),
      clients: {
        claim: vi.fn(),
        matchAll: vi.fn(async () => windowClients),
      },
      registration: { showNotification: vi.fn() },
      location: { host: 'localhost:3000' },
    },
  });

  return { handlers, cacheOpen };
}

function loadFetchHandler(fetchMock: ReturnType<typeof vi.fn>) {
  const { handlers, cacheOpen } = loadServiceWorker(fetchMock);
  const handler = handlers.get('fetch') as ((event: FetchEvent) => void) | undefined;
  if (!handler) throw new Error('service worker fetch handler was not registered');
  return { handler, cacheOpen };
}

async function dispatch(handler: (event: FetchEvent) => void, path: string) {
  let responsePromise: Promise<Response> | undefined;
  handler({
    request: { url: `https://dokan.test${path}`, method: 'GET', mode: 'cors' },
    respondWith(response) {
      responsePromise = response;
    },
  });
  if (!responsePromise) throw new Error('request was not handled');
  return responsePromise;
}

describe('service worker private-data policy', () => {
  it('returns JSON 503 without caching an offline API request', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('offline');
    });
    const { handler, cacheOpen } = loadFetchHandler(fetchMock);

    const response = await dispatch(handler, '/api/staff/notification-prefs');

    expect(response.status).toBe(503);
    expect(response.headers.get('content-type')).toContain('application/json');
    await expect(response.json()).resolves.toEqual({ error: 'offline' });
    expect(cacheOpen).not.toHaveBeenCalled();
  });

  it('serves dashboard requests from the network without touching cache storage', async () => {
    const fetchMock = vi.fn(async () => new Response('private dashboard'));
    const { handler, cacheOpen } = loadFetchHandler(fetchMock);

    const response = await dispatch(handler, '/dashboard/orders?_rsc=abc');

    await expect(response.text()).resolves.toBe('private dashboard');
    expect(cacheOpen).not.toHaveBeenCalled();
  });
});

describe('service worker pending-order sync', () => {
  const pending = {
    id: 'request-1',
    payload: { projectSlug: 'cafe', tableSlug: 't1', items: [] },
  };

  async function dispatchSync(
    handler: (event: SyncEvent) => void
  ): Promise<void> {
    let work: Promise<void> | undefined;
    handler({
      tag: 'submit-pending-order',
      waitUntil(response) {
        work = response;
      },
    });
    if (!work) throw new Error('sync event was not handled');
    return work;
  }

  it('deletes a successful order and informs open windows', async () => {
    const db = createPendingOrderDb([pending]);
    const client = { postMessage: vi.fn() };
    const fetchMock = vi.fn(async () =>
      Response.json({
        order: {
          id: 'order-1',
          status: 'pending',
          totalAmount: 3.25,
          orderNumber: 7,
        },
      })
    );
    const { handlers } = loadServiceWorker(fetchMock, db.indexedDB, [client]);
    const sync = handlers.get('sync') as ((event: SyncEvent) => void) | undefined;
    if (!sync) throw new Error('sync handler was not registered');

    await dispatchSync(sync);

    expect(db.records.has(pending.id)).toBe(false);
    expect(client.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'PENDING_ORDER_SUBMITTED', id: pending.id })
    );
  });

  it('keeps retryable server failures and rejects the sync event', async () => {
    const db = createPendingOrderDb([pending]);
    const fetchMock = vi.fn(async () => new Response('unavailable', { status: 503 }));
    const { handlers } = loadServiceWorker(fetchMock, db.indexedDB);
    const sync = handlers.get('sync') as ((event: SyncEvent) => void) | undefined;
    if (!sync) throw new Error('sync handler was not registered');

    await expect(dispatchSync(sync)).rejects.toThrow('require retry');
    expect(db.records.has(pending.id)).toBe(true);
  });

  it('drops permanent client failures and reports the API error', async () => {
    const db = createPendingOrderDb([pending]);
    const client = { postMessage: vi.fn() };
    const fetchMock = vi.fn(async () =>
      Response.json({ error: 'المنتج لم يعد متاحاً' }, { status: 400 })
    );
    const { handlers } = loadServiceWorker(fetchMock, db.indexedDB, [client]);
    const sync = handlers.get('sync') as ((event: SyncEvent) => void) | undefined;
    if (!sync) throw new Error('sync handler was not registered');

    await dispatchSync(sync);

    expect(db.records.has(pending.id)).toBe(false);
    expect(client.postMessage).toHaveBeenCalledWith({
      type: 'PENDING_ORDER_FAILED',
      id: pending.id,
      error: 'المنتج لم يعد متاحاً',
    });
  });
});
