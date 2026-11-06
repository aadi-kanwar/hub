# Admin Hub (by Livoza)

A small, private website for **master admins only**. Sign in once, then open
any of our tools (Dine/MealSync, Staff) already signed in as an admin, with
no second login. Wardens, staff and residents never use the hub; they keep
signing in to each tool exactly as before.

Built on the same stack, tooling and design system as **MealSync**:
Next.js 16, Convex (database, functions, auth) on **its own Convex
project**, Tailwind 4 with MealSync's tokens and components (copied
verbatim), Vitest + convex-test. All times are shown in India time
(Asia/Kolkata).

## What it does

- **Sign in** with mobile number (India +91 by default) and password. There
  is no sign-up. 5 wrong attempts lock that number for 15 minutes. The first
  sign-in with a temporary password must choose a new one before anything
  else. A hub login lasts at most 8 hours (2 hours without use).
- **Tools** (`/tools`): a card per tool with an **Open** button. The tools come
  from [`tools.config.ts`](tools.config.ts); adding a tool means adding one
  entry there.
- **Master admins** (`/admins`): list, add (name, number, temporary password),
  deactivate, reset password. You can't deactivate yourself, and there is
  always at least one active master admin. Adding a deactivated admin's
  number again switches them back on.
- **Activity** (`/activity`): sign-ins, failed sign-ins, tool launches (who,
  which tool, when) and every admin change. It can't be edited or deleted.

## How "Open" signs you in (single sign-on)

1. The backend checks you're an active master admin.
2. It signs a one-time **ticket** (a JWT, EdDSA/Ed25519) with: issuer = the
   hub's address, audience = the tool id, your hub id, phone and name,
   `role: "master_admin"`, a random `jti`, and an expiry 60 seconds later.
3. It writes the launch to the activity log.
4. The browser goes to `{appUrl}{ssoPath}#ticket=…`. The ticket is after `#`,
   which browsers never send to servers, so it never appears in server logs.

The signing key is only in the hub's Convex environment variable
`SSO_PRIVATE_KEY`; each tool holds only the matching public key. Deactivating
a master admin stops new tickets at once.

## Security rules in the code

- Every backend function is built from the permission wrappers in
  `convex/lib/functions.ts` (checked by ESLint and `convex/tests/enforcement.test.ts`).
- Hub pages need a master admin session three times over: the web server
  (`src/proxy.ts`) sends visitors without a login to `/signin`, the pages
  show nothing until the backend confirms an active master admin, and every
  backend function checks again.
- No keys or passwords in code, git, logs or the browser.

## Set up (owner's checklist)

These steps are done together in the phases of the build; see the final
checklist given at deployment.

1. Create a **new Convex project** for the hub (don't reuse MealSync's or Staff's).
2. Create a Vercel project for this repository; add the hub's Convex
   production **deploy key** as `CONVEX_DEPLOY_KEY`.
3. On the hub's Convex deployment set `SEED_ADMIN_NAME`, `SEED_ADMIN_PHONE`,
   `SEED_ADMIN_PASSWORD`, then deploy. The first deploy creates the first
   master admin (or run `npm run seed`). Remove `SEED_ADMIN_PASSWORD` afterwards.
4. Make the single sign-on keys once with `npm run sso:keys` (it prints the
   `npx convex env set` commands). `SSO_PRIVATE_KEY` goes on the hub's Convex
   deployment only; `HUB_SSO_PUBLIC_KEY` goes on MealSync's and Staff's. Also set
   `HUB_ORIGIN` on MealSync and Staff to the hub's address (the same value as
   the hub's `SITE_URL`). `npm run sso:keys -- --out <folder>` writes the keys to
   files outside the repository instead of printing them.

> Careful: if a terminal already has a `CONVEX_DEPLOY_KEY` for MealSync or
> Staff, Convex commands run here would go to **that** app. Always check
> which project a command will use before running it in this folder.

## For developers

```bash
npm install
npm test            # backend tests (convex-test)
npm run typecheck
npm run lint
npm run dev         # website; `npm run dev:backend` for the Convex backend
```
