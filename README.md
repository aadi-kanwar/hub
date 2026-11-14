# Livoza Hub

The one sign-in for everyone at Livoza. People sign in once, see only the
tools their profile allows, and open each one already signed in. The hub
owns **people, profile types and properties**; each tool keeps its own rules
for the role it's given.

Built on the same stack, tooling and design system as **MealSync**:
Next.js 16, Convex (database, functions, auth) on **its own Convex
project**, Tailwind 4 with MealSync's tokens and components, Vitest +
convex-test. All times are shown in India time (Asia/Kolkata).

## Profile types

Every person has exactly one type.

| Type | Who creates it | Properties | First password |
|---|---|---|---|
| Admin (master admin) | an Admin (the first one: the seed script) | all | temporary |
| Warden/Manager | an Admin | one or more (one warden per PG) | temporary |
| Staff | an Admin | one or more | temporary |
| Resident | themselves, at `/signup` with a join code | the code's property | their own |

- Only an Admin changes someone's type or properties (also: moving a
  resident to another PG). An admin can't change or deactivate themselves,
  and there's always at least one active Admin.
- Each property has a **join code** that stays the same until an Admin makes
  a new one (the old one stops working at once). A wrong code counts as a
  failed sign-in attempt.
- Hub logins: Admins 8 hours (2 idle); everyone else 30 days (7 idle).
  Convex Auth keeps every login for 30 days; `getViewer` in
  `convex/lib/functions.ts` ends Admin logins early.

## Which tools each type sees

[`tools.config.ts`](tools.config.ts): each tool's `roles` maps a profile type
to the tool's role (`null` = no access: the card is hidden and no ticket is
signed), and optional `labels` rename a card for a type.

| | Admin | Warden/Manager | Staff | Resident |
|---|---|---|---|---|
| Dine | admin | warden | - | resident |
| Staff ("My Attendance & Pay" for staff) | admin | - | staff | - |
| Crate | admin | manager | - | - |

Adding a tool = one entry there, plus the hub endpoints in the tool.

## Screens

- `/signin`, `/signup` (residents, with a join code), `/change-password`.
- `/tools`: the person's tool cards. `/open/<tool>` opens a tool with no
  click; tools send people there when their tool login ends.
- Admins only: `/people` (add, edit type/properties/room, reset password,
  deactivate), `/properties` (add, rename, join codes), `/activity`,
  `/import` (one-time import from the tools).

## How "Open" signs you in (single sign-on)

The backend checks the person is active and that the tool gives their type a
role, then signs a one-time **ticket** (EdDSA JWT, 60 seconds): issuer = the
hub's address, audience = the tool id, subject = the hub user id, with
`phone`, `name`, `profileType`, `role` (the tool's role), `roomNumber` and
`properties` (`"*"` for Admins, else `[{ id, name }]` with the hub's
property ids). The browser goes to `{appUrl}{ssoPath}#ticket=…` (after `#`,
so it never reaches server logs). The tool makes itself match the ticket and
opens a 12-hour login.

## Keeping the tools in step (sync)

The tools keep their own copy of the people they need. Every change in the
hub (new person, type, properties, deactivation, password reset, new or
renamed property) queues a **sync job** per tool that cares
(`convex/lib/syncQueue.ts`). `convex/syncNode.ts` sends it at once to the
tool's `/sso/sync` (a token signed for audience `<tool>-sync`, data inside the
token) and retries every minute with back-off until the tool confirms. The
data is read fresh when sent and never stored. Type, property and status
changes also end the person's open logins in the tools.

## Moving existing people in (import)

`/import` asks each tool's `/sso/export` (audience `<tool>-export`) for its
properties and people, matches people by phone and properties by name, and
shows the plan. The admin picks each property's target and a type for
anyone with different roles in different tools. People keep their current
password (same Scrypt hashing everywhere; the first tool in
`tools.config.ts` order with one wins); anyone without one needs a password
reset. Then every property and person is synced so the tools store the hub's
ids. Safe to run again.

Once everyone is in the hub, set `HUB_ONLY=true` on each tool's Convex
deployment: its own sign-in is switched off and sends people to the hub.

## Security rules in the code

- Every backend function is built from the permission wrappers in
  `convex/lib/functions.ts` (checked by ESLint and
  `convex/tests/enforcement.test.ts`): `memberQuery/Action` for anyone
  signed in, `adminQuery/Mutation/Action` for Admins only.
- Only `convex/lib/ssoSign.ts` reads the signing key.
- Hub pages are checked three times: the web server (`src/proxy.ts`), the
  pages (admin pages also check the type), and every backend function.
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
   deployment only; `HUB_SSO_PUBLIC_KEY` goes on Dine's, Staff's and Crate's.
   Also set `HUB_ORIGIN` on each tool to the hub's address (the same value as
   the hub's `SITE_URL`).
5. Deploy the tools first (they accept the new tickets and the old ones),
   then the hub. Add the properties (or run `/import`), then switch each
   tool to `HUB_ONLY=true` once everyone signs in through the hub. `npm run sso:keys -- --out <folder>` writes the keys to
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
