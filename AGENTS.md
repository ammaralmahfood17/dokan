# AGENTS.md — Dokan v2 Working Contract

This file binds ANY AI agent working in this repository (Hermes, Claude Code,
Cursor, etc.). It has two parts: universal behavioral rules, and Dokan-specific
non-negotiables. Read both before touching code.

## Part 1 — Karpathy Guidelines (Behavioral Contract)

Derived from Andrej Karpathy's observations on LLM coding pitfalls. These bias
toward caution over speed; for trivial tasks (typo fixes, one-liners) use judgment.

### 1. Think Before Coding
- State assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First
- Minimum code that solves the problem. Nothing speculative.
- No features beyond what was asked. No abstractions for single-use code.
- No "flexibility"/"configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If 200 lines could be 50, rewrite it.
- Test: "Would a senior engineer call this overcomplicated?"

### 3. Surgical Changes
- Touch only what you must. Clean up only your own mess.
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken. Match existing style.
- If you notice unrelated dead code, mention it — don't delete it.
- Remove imports/variables/functions YOUR changes made unused; don't remove
  pre-existing dead code unless asked.
- Test: every changed line traces directly to the user's request.

### 4. Goal-Driven Execution
- Transform tasks into verifiable goals:
  - "Add validation" → "Write tests for invalid inputs, then make them pass"
  - "Fix the bug" → "Write a test that reproduces it, then make it pass"
  - "Refactor X" → "Ensure tests pass before and after"
- For multi-step tasks, state a brief plan: `[Step] → verify: [check]`.
- Strong success criteria let you loop independently. Weak criteria
  ("make it work") require constant clarification.

## Part 2 — Dokan Project Non-Negotiables

### Architecture & Stack
- Next.js 16 App Router + Supabase (Postgres) + Vercel. TypeScript strict.
- Server components for reads; client components only where interactivity requires.
- Server API routes: `createClient()` from `@/lib/supabase/server` is ASYNC —
  `await` it. NEVER import `@/lib/supabase/client` in a route handler.
- Service role key: NEVER in browser code. Server-only.
- Supabase migrations: one file per change, ordered. Before claiming a schema
  object is absent, `grep -rn` ALL migrations — base schema lives in 0029,
  hardening/constraints in 0030+.
- RLS: any policy keying only on `auth.uid() = user_id` on a table with
  `project_id` needs a membership EXISTS clause (`staff_members`).

### RTL & Arabic (non-negotiable)
- Arabic-first, RTL. Use logical properties (`ms-*`/`me-*`/`start-*`/`end-*`),
  never `left-*`/`right-*`/`ml-*`/`mr-*` for directional layout.
- Never negative `letter-spacing` on Arabic headings. **Two type tiers, chosen by AUDIENCE:** customer-facing surfaces (public menu, storefront root, landing, login/register/onboarding/reset, store-unavailable) read at **16px / lh 1.6** — applied via the `.storefront` class, which `src/app/[projectSlug]/layout.tsx` puts on the whole customer subtree; the **merchant dashboard** keeps **14px / lh 1.5** enterprise density. Never mix tiers within one screen.
- Status badges: map DB enums to Arabic (pending → قيد الانتظار, preparing →
  قيد التحضير, ready → جاهز, delivered → تم التسليم, cancelled → ملغي).
- Currency: use `Banknote` icon (never `DollarSign`); format via project's
  currency (BHD/KWD = 3 decimals), never hardcode.
- `inputMode="decimal"` on ALL price/number inputs (iOS keypad lacks the
  decimal key otherwise). `maxLength` on ALL text/textarea inputs.

### iOS PWA / Mobile (non-negotiable)
- NEVER use `window.confirm()`/`prompt()` — iOS Safari PWA silently returns
  false. Use the `<Modal>` component (gives scroll lock, focus trap, ESC,
  a11y) for all destructive confirmations.
- Modals/sheets: body scroll lock via `position: fixed` + preserve scrollY.
  Modals must be SIBLINGS of `PullToRefresh`, never children.
- Form modals (5+ inputs) → `items-start` + `max-h-dvh` (top-aligned,
  keyboard-safe). Simple pickers/addons → `items-end` bottom sheet.
- Touch targets ≥44px. Never hover-only controls (invisible on touch).
- `confirm()`-style destructive actions: custom `<Modal>` with warning icon.
- Light mode is the default; dark only via explicit `localStorage` choice.
  Blocking script in `<head>` prevents dark-mode flash.

### Patterns
- Bottom sheets: scroll lock + focus trap + `role="dialog" aria-modal`
  + backdrop click + ESC to close.
- Module-level mutable state (`let` counters, audio ctx, timers) is a BUG —
  use `useRef` inside the component + `useEffect` cleanup.
- Object URLs: `URL.revokeObjectURL()` in `finally`.
- Real-time refetch: debounce (trailing 500ms) — never immediate refresh on
  `event: '*'`.
- KDS audio: singleton AudioContext, WAV preload → oscillator fallback →
  queue; clear queue on failure; title flash on new order.
- Analytics query: NEVER `.limit(2000)` — paged loop (1000/page). Bucket
  times in `Asia/Bahrain` via `Intl.DateTimeFormat`, not server local time.
- Orders: `.is('service_type', null)` = real order (not waiter/bill). Never
  direct `supabase.update({status:'cancelled'})` — POST `/api/pos/cancel`.

### Workflow
- Single branch (`master`), sequential commits — no feature branches.
- `git push origin master` → GitHub → Vercel auto-deploy. Manual
  `vercel --prod` only for env vars or non-master deploys.
- Verify with `npx tsc --noEmit` + `npm run build` before committing.
- Reviews: ONE exhaustive pass covering all dimensions (data correctness,
  timezones, edge cases, React keys, a11y, mobile overflow, error handling,
  dead code, performance). Never deliver findings incrementally.
- Do NOT commit reference/design/audit files — read then delete.
- Any error noticed during work — even pre-existing or out of scope — fix
  it immediately ("the golden rule").

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
