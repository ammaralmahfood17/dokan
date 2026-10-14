import { describe, expect, it, vi } from 'vitest';

/**
 * `getPublicProject` carries the HARD availability veto for the public
 * storefront and menu: anon cannot read `projects.subscription_expires_at`
 * (column-scoped grants, 0006), so a SECURITY DEFINER RPC decides, and its
 * answer wins even when the project row itself is `is_active`.
 *
 * The two reads now happen in ONE barrier (they are independent), which makes
 * the veto slightly easier to lose in a refactor — so it is pinned here: the
 * row must be discarded when the RPC says no. There is no inactive project in
 * production to test this against, which is exactly why it is a unit test.
 */

const rpc = vi.fn();
const maybeSingle = vi.fn();
const eq = vi.fn(() => ({ eq, maybeSingle }));
const select = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ select }));

vi.mock('@/lib/supabase/anon', () => ({
  createAnonClient: () => ({ rpc, from }),
}));

const { getPublicProject } = await import('./public-project');

const projectRow = {
  id: 'p1',
  name: 'استكانة',
  slug: 'estikana',
  currency: 'BHD',
  primary_color: '#7047EB',
  logo_url: null,
  is_active: true,
};

function respondWith(isAvailable: boolean | null, project: unknown) {
  rpc.mockResolvedValue({ data: isAvailable });
  maybeSingle.mockResolvedValue({ data: project });
}

describe('getPublicProject', () => {
  it('returns the project when the RPC says it is available', async () => {
    respondWith(true, projectRow);
    await expect(getPublicProject('estikana')).resolves.toEqual(projectRow);
  });

  it('discards the row when the RPC says NO — the veto (expired subscription)', async () => {
    respondWith(false, projectRow);
    await expect(getPublicProject('estikana')).resolves.toBeNull();
  });

  it('returns null when there is no such project', async () => {
    respondWith(true, null);
    await expect(getPublicProject('nope')).resolves.toBeNull();
  });

  it('returns null when the RPC itself returns nothing (unknown slug)', async () => {
    respondWith(null, projectRow);
    await expect(getPublicProject('nope')).resolves.toBeNull();
  });

  it('asks for both things in one barrier, with the availability RPC called once', async () => {
    respondWith(true, projectRow);
    await getPublicProject('estikana');
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('is_project_publicly_available', { p_slug: 'estikana' });
    expect(from).toHaveBeenCalledWith('projects');
  });
});
