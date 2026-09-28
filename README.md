# دكان (Dokan)

Multi-tenant PWA SaaS for cafés, restaurants, and food trucks in the Gulf.

**Core value:** Registration → first real order in under 7 minutes.

## Stack

- Next.js (App Router) + TypeScript (strict)
- Tailwind CSS + enterprise design tokens
- Supabase (Auth, Postgres, Realtime, RLS)
- `qrcode` for table QR generation
- Cairo font, Lucide icons
- Arabic-first RTL, mobile-first

## Features (MVP)

1. Email/password auth + session (Supabase)
2. Guided onboarding (project + branding + owner staff record)
3. Multi-tenant isolation via `projects` + `staff_members`
4. Products, categories, addons
5. Branches + tables with slug + QR
6. Public menu at `/{projectSlug}/menu/{tableSlug}`
7. Secure public order API (server-side pricing)
8. Realtime Orders + Kitchen Display + POS
9. Installable PWA

## Quick start

```bash
cp .env.example .env.local
# Fill NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
# SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SITE_URL

npm ci
npm run env:check
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push   # applies every unapplied migration in order
npm run dev
```

قبل النشر شغّل `npm run env:validate`. على Vercel يعمل هذا الفحص تلقائياً
ويوقف البناء إذا كانت إعدادات Supabase ناقصة أو كانت أي ميزة اختيارية نصف مهيأة.

## Definition of Done path

1. Register → redirected to `/onboarding`
2. Create store (name, slug, currency, color) → `/dashboard` checklist
3. Add product → create branch + table → view QR
4. Open `/{slug}/menu/{tableSlug}` → place order
5. Order appears on Orders + Kitchen → move status to delivered

Public writes never hit Supabase from the browser. All go through:

- `POST /api/public/order`
- `POST /api/public/waiter`
- `POST /api/public/bill`
- `POST /api/pos/order` (authenticated staff)

## Project structure

```
src/app/
  page.tsx                 Landing
  login/  register/        Auth
  onboarding/              Create project
  dashboard/               Staff app + checklist
  [projectSlug]/menu/[tableSlug]/  Public menu
  api/public/order|waiter|bill
  api/onboarding/project
  api/pos/order
  api/auth/callback

src/lib/
  types.ts  database.types.ts  utils.ts  order-pricing.ts  project.ts
  supabase/ client | server | admin | middleware

supabase/migrations/0001_dokan_schema.sql
```

## Design tokens

| Token | Value |
|-------|-------|
| Primary | `#4F46E5` |
| Background | `#FAF9F6` |
| Surface | `#FFFFFF` |
| Text | `#1F2320` / `#6B6F68` |
| Border | `rgba(20,20,15,0.08)` |
| Radius | 10–14px |
| Font | Cairo |
## Production Status

- Live at https://www.dokanstore.xyz (Vercel auto-deploy from `master`)
- All phases done: security hardening, tenant isolation, atomic order RPCs,
  subscription enforcement (manual cash), super-admin dashboard (audit log,
  analytics, impersonation, project create/archive/delete)
- Migrations are applied in order via `npx supabase db push`; CI rebuilds a
  fresh local database and runs pgTAP security assertions on every push.
- E2E: Playwright against production — `npx playwright test` (7 specs,
  incl. money path, POS, tenant isolation, subscription, super-admin)
- Deployment: `git push origin master` → GitHub CI → Vercel. Vercel also runs
  `npm run env:validate` before its production build.
