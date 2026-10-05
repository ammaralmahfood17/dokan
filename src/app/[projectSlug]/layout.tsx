/**
 * Customer-facing subtree (storefront root + QR menu).
 *
 * T4 (2026-10-05): the app shipped a single 14px/1.5 body baseline while AGENTS.md
 * required 15–16px / 1.6. The two surfaces genuinely need different tiers — the
 * merchant dashboard is a dense back-office, this subtree is Arabic body copy read
 * at a glance on a phone — so the tier lives on this layout rather than on each
 * page's own root element: a new customer page cannot forget it.
 *
 * The wrapper is a plain block div: it sets font-size/line-height only, so it does
 * not create a containing block and cannot break `position: fixed` children (the
 * sticky cart bar and the bottom sheets).
 */
export default function StorefrontLayout({ children }: { children: React.ReactNode }) {
  return <div className="storefront">{children}</div>;
}
