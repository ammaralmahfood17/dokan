import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { Project, StaffMember, StaffRole } from '@/lib/types';
import type { ChecklistItem } from '@/lib/types';

export type ProjectContext = {
  project: Project;
  membership: StaffMember;
  userId: string;
  /** Whole days until subscription expiry, or null for perpetual. Computed
   *  here (a plain function) so server components never call Date.now()
   *  during render (react-hooks/purity). */
  subscriptionDaysLeft: number | null;
};

/**
 * Resolve the current user's primary project (first membership).
 * Returns null if unauthenticated or no project yet.
 *
 * SECURITY: getUser() verifies the session with the Auth server (catches
 * revoked/expired tokens that a locally-decoded JWT would still accept).
 * getSession() alone trusts the unsigned cookie claims — fine for a fast
 * redirect in middleware, NOT for gating protected data.
 */
export async function getCurrentProject(): Promise<ProjectContext | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  // One round-trip instead of two: embed the project in the membership row.
  // This runs on EVERY protected page render, so the second sequential query
  // was pure added latency on the whole dashboard.
  const { data: membershipRow } = await supabase
    .from('staff_members')
    .select('*, projects(*)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!membershipRow) return null;

  const membership = membershipRow as unknown as StaffMember;
  const project = (membershipRow as unknown as { projects: Project | null }).projects;

  if (!project) return null;

  // Phase D: archived project (soft-deleted by super-admin) → no dashboard
  // access for its staff. Redirect to a clean "unavailable" page.
  if (project.deleted_at) {
    redirect('/store-unavailable');
  }

  // Subscription cutoff: expired subscription → no dashboard access.
  // Deliberately keyed on subscription_expires_at, NOT is_active — the
  // owner can toggle is_active manually to close the store (vacation,
  // maintenance) without being locked out of the dashboard. The cron job
  // flips is_active=false on expiry, which cuts public ordering/menu via
  // the existing RLS + route checks; this check cuts the dashboard itself.
  if (
    project.subscription_expires_at &&
    new Date(project.subscription_expires_at) < new Date()
  ) {
    redirect('/subscription-expired');
  }

  const subscriptionDaysLeft = project.subscription_expires_at
    ? Math.ceil(
        (new Date(project.subscription_expires_at).getTime() - Date.now()) / 86400e3
      )
    : null;

  return {
    project: project as Project,
    membership: membership as StaffMember,
    userId: user.id,
    subscriptionDaysLeft,
  };
}

/** Server-page authorization guard. RLS remains the data boundary; this keeps
 * restricted management screens from rendering for operational staff. */
export async function requireCurrentProjectRole(
  allowedRoles: readonly StaffRole[]
): Promise<ProjectContext> {
  const ctx = await getCurrentProject();
  if (!ctx) redirect('/onboarding');
  if (!allowedRoles.includes(ctx.membership.role)) redirect('/dashboard');
  return ctx;
}

// buildChecklist() moved 2026-10-07: the dashboard now derives its onboarding
// checklist from counts it already fetched (checklistFromRollup in
// lib/dashboard-rollup.ts). Keeping a second implementation would guarantee
// the two drift.