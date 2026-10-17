# Pending migrations — written, dry-run, NOT approved

A `.sql` file in this directory is a migration that exists, has been dry-run against production
inside a rolled-back transaction, and is **waiting for the owner's explicit approval**. Move it to
`supabase/migrations/` only when that approval is in hand.

## Why this directory exists

The Supabase GitHub App is installed on this repository and it **deploys the migrations it finds in
`supabase/migrations/` to the production project on every push to `master`**. Nothing in `ci.yml`,
`vercel.json` or `package.json` runs `supabase db push` — the app does it, and every `Supabase
Preview` check on a commit is that app reporting. So the presence of a file in
`supabase/migrations/` **is** the decision to apply it: a push is an apply.

That makes the owner's standing gate («one approval per migration, after CI is green») impossible to
satisfy by pushing the files and waiting. Keeping the file here until approval is the mechanism that
actually enforces it — this directory is invisible to the app.

## The flow

1. **Write** the file here: `supabase/pending/<YYYYMMDDHHMMSS>_<name>.sql`.
2. **Dry-run** it on production inside a transaction that ends in `ROLLBACK`, and record what you
   measured (the counts, the before/after of each effect).
3. **Let CI verify it from zero.** The `Fresh database · Security assertions` job applies everything
   in this directory to a throwaway database before running the assertion suite, so a pending
   migration is proven against a clean schema *without* touching production. Read that job's log.
4. **Ask the owner**, in plain text, naming the file, what it changes, and what it removes. One file,
   one approval — never a batch asked as one question.
5. **On approval**, move it and record the decision in the same commit:
   ```
   git mv supabase/pending/<file>.sql supabase/migrations/<file>.sql
   $EDITOR supabase/migrations/APPROVED.txt   # add the filename + date
   $EDITOR docs/audit-2026-10/MIGRATION-MANIFEST.md   # add the row, with the rollback
   ```
   `scripts/check-migration-approval.mjs` fails CI if a file reaches `supabase/migrations/` without
   its `APPROVED.txt` line, so the move above is a deliberate two-file act rather than an accident.
   The next push then applies it to production — which is the point.

## The guard is a tripwire, not a boundary

`APPROVED.txt` is a versioned list, and a determined person can edit both files in one commit. It
catches the accident — a draft dropped straight into `supabase/migrations/`, or a file copied there
instead of moved. The boundary against a deliberate bypass is the app's deploy-on-push setting,
which only the owner can change (Supabase project settings → Integrations), and a `.sql` file
committed anywhere else in the repo is inert because the app reads `supabase/migrations/` only.
