import { describe, expect, it, vi } from 'vitest';
import { classifyFailure } from '@/lib/pos-offline-queue';
import { postPosOrder, type PosSubmitPayload } from '@/lib/pos-submit';

/**
 * Wave 3 contract: the decision that separates "retry forever" from "this will
 * never succeed" is pure, so it is tested here rather than discovered in a rush.
 */
describe('classifyFailure', () => {
  it('retries when the request may never have left the device', () => {
    expect(classifyFailure(null)).toBe('retry');
  });

  it('retries server faults and throttling', () => {
    for (const status of [429, 500, 502, 503, 504]) {
      expect(classifyFailure(status), `HTTP ${status}`).toBe('retry');
    }
  });

  it('drops payloads the server will never accept', () => {
    for (const status of [400, 401, 403, 404, 409, 422]) {
      expect(classifyFailure(status), `HTTP ${status}`).toBe('drop');
    }
  });
});

const payload: PosSubmitPayload = {
  projectId: '9520304f-6489-4301-bd97-a5fa708246b2',
  clientRequestId: '11111111-2222-4333-8444-555555555555',
  type: 'walkin',
  items: [{ productId: '22222222-3333-4444-8555-666666666666', quantity: 1, optionIds: [] }],
};

const okResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('postPosOrder', () => {
  it('sends the clientRequestId so a retry is idempotent', async () => {
    const fetchImpl = vi.fn(async () => okResponse({ ok: true, order: { id: 'o1', totalAmount: 0.5, orderNumber: 7 } }));
    const result = await postPosOrder(payload, fetchImpl as unknown as typeof fetch);
    expect(result.ok).toBe(true);
    const sent = JSON.parse(String((fetchImpl.mock.calls[0] as unknown[])[1] && ((fetchImpl.mock.calls[0] as unknown[])[1] as RequestInit).body));
    expect(sent.clientRequestId).toBe(payload.clientRequestId);
  });

  it('treats a 409 as drop and keeps the server message', async () => {
    const fetchImpl = vi.fn(async () => okResponse({ error: 'أحد الأصناف لم يعد متوفراً' }, 409));
    const result = await postPosOrder(payload, fetchImpl as unknown as typeof fetch);
    expect(result).toMatchObject({ ok: false, status: 409, outcome: 'drop' });
    if (!result.ok) expect(result.error).toContain('متوفر');
  });

  it('treats a thrown fetch as retry with a null status', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const result = await postPosOrder(payload, fetchImpl as unknown as typeof fetch);
    expect(result).toMatchObject({ ok: false, status: null, outcome: 'retry' });
  });

  it('retries a 503 even when the body is not JSON', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>down</html>', { status: 503 }));
    const result = await postPosOrder(payload, fetchImpl as unknown as typeof fetch);
    expect(result).toMatchObject({ ok: false, status: 503, outcome: 'retry' });
  });
});
