# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes, derived from [Andrej Karpathy's
observations](https://x.com/karpathy/status/2015883857489522876) on LLM coding pitfalls.
Upstream: `multica-ai/andrej-karpathy-skills` (MIT), merged with this project's own rules below.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require
constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to
overcomplication, and clarifying questions come before implementation rather than after mistakes.

## Project-Specific Guidelines — دكان v3 (dokanstore.xyz)

Stack: Next.js App Router · React · TypeScript strict · Tailwind v4 · Supabase (Auth/Realtime) ·
Sentry · Vercel. Multi-tenant restaurant/café SaaS, Arabic/RTL-first for the Gulf.

**Every change must leave the gates green** (all of them, not a subset):

```bash
npx tsc --noEmit
npm run lint            # --max-warnings 0
npm test                # vitest, tests are CO-LOCATED: src/lib/x.test.ts — never __tests__/
npm run build
npm run env:check       # every env var used in the code is documented in .env.example
node scripts/check-public-write-gates.mjs   # + the other scripts/check-*.mjs guardrails
npm run test:db         # pgTAP — needs Docker; CI job "Fresh database · Security assertions" runs it
```

Rules that are not negotiable here:

- **NEVER edit an existing migration**, including `0000_init.sql`. Add a new timestamped migration
  and give it a `-- ROLLBACK:` header.
- **Keep the product's surface in Arabic and RTL**: Arabic UI strings, logical properties
  (`ms-/me-/ps-/pe-`) instead of `left/right`, Latin digits, the warm palette. No dark mode.
- **The table token (`tables.qrcode`) must never appear** in logs, Sentry events or breadcrumbs,
  analytics, or Referer headers. It is the proof-of-scan for public writes; a slug never
  authorizes anything.
- **A new guardrail must be seen FAILING on the bad input before it counts.** A check that has
  never been red is not evidence.
- **One commit per finding**, and the commit body references the finding id. A diff that touches a
  file the finding did not require is a bug in the diff.
- **Read a file before editing it.** Line numbers in a plan or report are hints; re-locate by
  content. If a premise in the report is false in the current code, say so and fix the real
  problem rather than the described one.
- Long installs/builds run in the background with output tee'd to a log file. Never `pkill -f`.
  `npm start` leaves a `next-server` CHILD holding the port — kill that PID, not the wrapper.

Trackers for the 2026-10 audit remediation: `docs/audit-2026-10/REMEDIATION.md` (status per
finding) and `docs/audit-2026-10/OPS-VERIFICATION.md` (human-only steps, with exact commands).
