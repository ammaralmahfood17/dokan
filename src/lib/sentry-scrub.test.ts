import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  scrubSentryBreadcrumb,
  scrubSentryEvent,
  scrubTokenFromUrl,
} from '@/lib/sentry-scrub';

/**
 * 2026-10 audit remediation, amendment A2.
 *
 * "The table token must never appear in logs, Sentry events/breadcrumbs, analytics, or
 * Referer headers." This suite is the Sentry half of that rule; next.config.ts carries the
 * Referer half. It must fail loudly if the scrubber is ever removed from the configs.
 */

const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

describe('scrubTokenFromUrl()', () => {
  it('strips the token from the first query parameter', () => {
    expect(scrubTokenFromUrl(`https://dokanstore.xyz/estikana/menu/table-1?k=${TOKEN}`)).toBe(
      'https://dokanstore.xyz/estikana/menu/table-1?k=REDACTED'
    );
  });

  it('strips it when it is not the first parameter', () => {
    expect(scrubTokenFromUrl(`https://x/y?foo=1&k=${TOKEN}&bar=2`)).toBe(
      'https://x/y?foo=1&k=REDACTED&bar=2'
    );
  });

  it('strips it before a fragment', () => {
    expect(scrubTokenFromUrl(`https://x/y?k=${TOKEN}#top`)).toBe('https://x/y?k=REDACTED#top');
  });

  it('strips a relative URL (what a client breadcrumb usually holds)', () => {
    expect(scrubTokenFromUrl(`/estikana/menu/table-1?k=${TOKEN}`)).toBe(
      '/estikana/menu/table-1?k=REDACTED'
    );
  });

  it('strips every occurrence', () => {
    expect(scrubTokenFromUrl(`/a?k=${TOKEN}&b=1&k=${TOKEN}`)).toBe('/a?k=REDACTED&b=1&k=REDACTED');
  });

  it('leaves a URL without a token byte-identical', () => {
    for (const url of [
      'https://dokanstore.xyz/dashboard/pos',
      'https://x/y?keyword=hello&kpi=1',
      '/estikana/menu/table-1',
    ]) {
      expect(scrubTokenFromUrl(url)).toBe(url);
    }
  });

  it('never leaves any part of the token behind', () => {
    const out = scrubTokenFromUrl(`/x?k=${TOKEN}`);
    expect(out).not.toContain(TOKEN);
    expect(out).not.toContain(TOKEN.slice(0, 8));
  });

  it('is idempotent', () => {
    const once = scrubTokenFromUrl(`/x?k=${TOKEN}`);
    expect(scrubTokenFromUrl(once)).toBe(once);
  });

  it('tolerates non-strings without throwing', () => {
    expect(scrubTokenFromUrl('')).toBe('');
    expect(scrubTokenFromUrl(undefined as unknown as string)).toBe(undefined);
  });
});

describe('scrubSentryEvent()', () => {
  it('scrubs request.url', () => {
    const event = { request: { url: `/x?k=${TOKEN}` } };
    expect(scrubSentryEvent(event).request.url).toBe('/x?k=REDACTED');
  });

  it('scrubs the transaction name (it is often the request path)', () => {
    const event = { transaction: `/estikana/menu/table-1?k=${TOKEN}` };
    expect(scrubSentryEvent(event).transaction).toBe('/estikana/menu/table-1?k=REDACTED');
  });

  it('scrubs breadcrumbs: message, data.url, data.from, data.to', () => {
    const event = {
      breadcrumbs: [
        { message: `GET /x?k=${TOKEN}` },
        { data: { url: `/y?k=${TOKEN}`, from: `/a?k=${TOKEN}`, to: `/b?k=${TOKEN}` } },
      ],
    };
    const out = scrubSentryEvent(event);
    expect(JSON.stringify(out)).not.toContain(TOKEN);
  });

  it('scrubs nested extra / tags / contexts bags', () => {
    const event = {
      extra: { request: { nested: { url: `/deep?k=${TOKEN}` } } },
      tags: { url: `/tagged?k=${TOKEN}` },
      contexts: { trace: { data: { url: `/ctx?k=${TOKEN}` } } },
    };
    expect(JSON.stringify(scrubSentryEvent(event))).not.toContain(TOKEN);
  });

  it('still scrubs when the token sits in a header bag', () => {
    const event = { request: { headers: { referer: `https://x/y?k=${TOKEN}` } } };
    expect(JSON.stringify(scrubSentryEvent(event))).not.toContain(TOKEN);
  });

  it('leaves an event without a token untouched', () => {
    const event = { request: { url: '/dashboard/pos' }, transaction: '/dashboard/pos' };
    expect(scrubSentryEvent(event)).toEqual(event);
  });
});

describe('scrubSentryBreadcrumb()', () => {
  it('scrubs a fetch breadcrumb (the shape @sentry/nextjs records)', () => {
    const crumb = {
      category: 'fetch',
      data: { method: 'POST', url: `/api/public/order?k=${TOKEN}`, status_code: 200 },
    };
    expect(JSON.stringify(scrubSentryBreadcrumb(crumb))).not.toContain(TOKEN);
  });
});

describe('every Sentry runtime wires the scrubber (A2 guardrail)', () => {
  const CONFIGS = [
    'sentry.server.config.ts',
    'sentry.edge.config.ts',
    'src/instrumentation-client.ts',
  ];

  it.each(CONFIGS)('%s scrubs events AND breadcrumbs', (file) => {
    const source = readFileSync(resolve(process.cwd(), file), 'utf8');
    expect(source, `${file} must import the scrubber`).toMatch(
      /from '@\/lib\/sentry-scrub'|sentry-scrub/
    );
    expect(source, `${file} must call scrubSentryEvent in beforeSend`).toMatch(
      /beforeSend[\s\S]{0,1200}scrubSentryEvent/
    );
    expect(source, `${file} must register beforeBreadcrumb`).toMatch(
      /beforeBreadcrumb[\s\S]{0,200}scrubSentryBreadcrumb/
    );
  });
});
