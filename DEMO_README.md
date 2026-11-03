# Barracks WA demo guide

This guide describes the current source behavior. Demo records and credentials depend on which seed ran and any later staff changes; historical screenshots and counts do not establish the state of a local or hosted database.

## Start a local demo

Follow [running.md](running.md) to install packages, create `.env.local`, and start PostgreSQL. From `barracks-wa/`, apply migrations and create the administrator:

```bash
node --env-file=.env.local --import tsx scripts/db-migrate.ts
node --env-file=.env.local --import tsx scripts/seed-admin.ts
```

For a **fresh disposable demo database only**, initialize the original showcase once:

```bash
node --env-file=.env.local --import tsx scripts/seed-demo.ts
```

Then start the app:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). These commands work in PowerShell, macOS, and Linux. Database npm scripts require the environment to be loaded separately; Node's `--env-file` option above loads it for each command. Existing shell variables take precedence over the file.

`db:seed-demo` attempts to remove existing non-administrator business data before rebuilding it in a transaction. Finalized sales and attendance can prevent destructive reseeding. Do not use it as an update command for a populated database.

Sign in as Administrator and open **Branches**. Assign the demo Manager and Front Desk accounts to Main Branch if they have no membership. New staff accounts created after the branch migration need explicit assignment; creating a login does not grant branch access.

## Demo accounts

The original seed uses the following public demo credentials. They are for disposable demonstrations, and do not establish a password for an existing or hosted account whose credentials have since changed.

| Account | Email | Password source/value |
| --- | --- | --- |
| Administrator | `INITIAL_ADMIN_EMAIL` in your environment | `INITIAL_ADMIN_PASSWORD` when first seeded; use the documented reset command if needed |
| Manager | `demo.manager@barracks.app` | `manager123` |
| Front Desk | `demo.frontdesk@barracks.app` | `frontdesk123` |
| Customer | `demo.customer.ana@barracks.app` | `customer123` |
| Supplier | `demo.supplier.nina@barracks.app` | `supplier123` |

The other original customers are `demo.customer.paulo@barracks.app`, `demo.customer.samira@barracks.app`, and `demo.customer.jethro@barracks.app`, with the same seeded customer password. The second supplier login is `demo.supplier.marco@barracks.app`, with the same seeded supplier password. The older `@barracks.local` addresses are not the identifiers in the current seed.

Administrator seeding does not reset an existing administrator's password. Demo refresh commands do not reset existing account passwords. New staff accounts start unverified; account verification, active/unblocked status, and branch membership are separate requirements. Deactivating a supplier company also prevents its linked accounts from signing in.

## Current role boundaries

- **Administrator:** one sidebar includes management and daily operations, including booking approval, Queue, Payments, Customers, Barber Floor, Staff, Branches, and Payroll. There is no workspace switcher. Sensitive account actions and deletions retain their server restrictions.
- **Manager:** the same sidebar for assigned branches, with daily bookings/queue/checkout plus roster, schedules, attendance history/corrections, suppliers, stock, restocks, reports, and payroll. Managers can manage Front Desk accounts within their branch authority, but cannot deactivate suppliers, delete barbers/customers, or create supplier logins. Only assigned Managers approve payroll.
- **Front Desk:** Dashboard, Queue, Bookings, Payments, Customers, and Barber Floor for assigned branches. It can record today's attendance and operational barber status, but cannot edit the roster/schedules, manage inventory/restocks/suppliers, open reports/payroll, or manage staff accounts. Loyalty-point changes and financial refunds/voids require management.
- **Customer:** their own dashboard, profile, and bookings. A booking request starts `pending`; staff must confirm or reject it. Editing an upcoming pending/confirmed booking returns it to approval.
- **Supplier:** the linked supplier profile, supplied items, restock requests, and delivery history. Supplier actions affect only their linked company; receiving stock stays with management.

Barbers and accountless walk-ins are business records, not login roles. Staff can create and edit accountless customers and serve them through Queue; appointments require a registered customer account.

## Suggested walkthrough

1. Open the public landing page, then sign in as Administrator using the configured account.
2. Open **Branches** and confirm the intended demo branch and staff assignments. Select that branch when demonstrating operational pages.
3. Show the Management dashboard and its period/branch labels. Seeded counts depend on the selected branch, current Manila date, and fixture progress.
4. Open **Staff**. Create a temporary account with an explicit branch assignment, verify it, and show block/unblock status. Managers can perform these actions only for permitted Front Desk accounts.
5. Open **Barbers** for roster and schedules. Open **Payroll → Commission settings** for effective-dated commission changes; the old bulk commission API is disabled.
6. Open **Suppliers** and the supplied-items picker. Moving or removing an item is blocked while it would strand an open restock. Supplier login creation and deactivation are Administrator-only.
7. Open **Restocks** as Administrator or Manager. Show open stages, confirm arrival for an appropriate request, and receive every line. Confirm the inventory and movement history update. An unreceived request can instead be cancelled.
8. Sign in as Front Desk. Confirm the operational sidebar and absence of inventory, reports, payroll, roster editing, and staff-account tools.
9. Open **Customers** and **Queue**. Demonstrate creating an accountless walk-in, selecting a service and optional barber, assigning a waiting visit, starting service, and completing it when the barber is operationally available. Add-to-Queue retries retain their idempotency protection.
10. Open **Payments**, select a completed unpaid visit, and record a synthetic checkout. Reopen the saved receipt. Administrator and Manager can also check out; only management can perform permitted refund/void actions.
11. Sign in as a demo Customer. Open **Book**, choose an active branch, service, specific barber, available date and time within the 90-day booking window, review, and submit. Show **Awaiting approval**, not an automatic confirmation.
12. Sign in as Front Desk, Manager, or Administrator. In **Bookings → Awaiting approval**, confirm or reject that request. At an eligible booked time, show check-in → start → complete. Started/completed bookings remain on record; eligible pending/confirmed/closed-without-service bookings can be removed by staff.
13. Sign in as a demo Supplier. Show only that supplier's profile, items, requests, and history. Advance an eligible request Pending → Accepted → Preparing → Shipped, or cancel it at a permitted supplier stage. Administrator/Manager confirm arrival and receive stock.
14. For a prepared payroll showcase, sign in as the assigned Manager, inspect period breakdowns, and demonstrate permitted draft submission/approval. Paid payslips record fictional external disbursements; Barracks does not send money.

Use synthetic records for the walkthrough. Existing reservations, attendance, schedules, and branch permissions can make a service unavailable; complete those prerequisites instead of treating an empty picker as a broken screen.

## Refresh an existing demo

From `barracks-wa/`, after applying all current migrations:

```bash
node --env-file=.env.local --import tsx scripts/refresh-demo.ts
```

This is the environment-file equivalent of `npm run db:refresh-demo`. It requires the original demo roster, active services, supplier-linked disinfectant and pomade inventory, and an active administrator. With the current branch schema it also requires these existing active branches: `Barracks Bajada HQ`, `Barracks Lanang HQ`, `Barracks Bangkal HQ`, and `Barracks Maa HQ`. It does not create the branch directory.

The command adds branch stock/restock examples and working-day activity in one transaction. It preserves staff progress and financial history, and moves only eligible untouched overdue fixture appointments forward. It does not initialize an empty database or reset accounts. If prerequisites are missing, stop and prepare the intended demo rather than running the destructive seed over records you need.

## Five-branch working app and payroll fixtures

The fuller optional command is:

```bash
node --env-file=.env.local --import tsx scripts/seed-working-app.ts
```

This is `npm run db:seed-working-app` with the file loaded. It requires:

- All current migrations, including the payroll foundation in 028.
- The original demo accounts, services, roster, suppliers, and linked stock.
- Main Branch (`MAIN`) and the four named satellite branches above, all active.
- Verified, unblocked demo Manager and Front Desk accounts explicitly assigned to all five branches.

Use Administrator **Branches** to prepare missing branches and memberships. The script checks these prerequisites and rolls back on failure; it is not a blank-database installer.

It expands demo rosters (three named barbers per satellite branch) and stock, adds synthetic customers with realistic names, paid history, today's queue, upcoming reservations, attendance, and payroll examples. Existing accounts, stock, attendance, financial records, and payroll are fingerprinted and checked before commit. Existing passwords, calendars, and staff progress are retained. Missing demo payroll calendars are anchored relative to the first run; a date from an older deployment is not a universal default.

Payroll examples include Draft, Pending Approval, Approved, and Paid records plus current-period earnings. Audit notes say **DEMO ONLY** and fictional disbursement references start `DEMO-ONLY-NO-FUNDS`. No funds are transferred. The original seed's four-barber/two-supplier showcase and the October 10, 2026 hosted expansion are historical baselines; current counts must be read from the selected database.

## Before a live demonstration

Operational screens use the real Asia/Manila clock, so prepare the demo database on the day:

- **Hold the demo within working hours.** Starting a service requires the branch to be open and the barber to be on shift, present (not marked absent or clocked out) and free at that moment. Outside those hours the server correctly refuses with "Barber is not scheduled to work at this time". For a defense outside normal hours, set the demo branch's shop hours and the barbers' shifts in Barber Management to cover the session.
- **Close out earlier days.** Nothing closes visits automatically. Queue entries left `waiting`, `ready` or `in_progress` stay in the Active queue, and an old `in_progress` service keeps that barber "currently serving another customer". Past appointments stay `confirmed` until staff mark them. In Queue, complete or remove leftover visits; in Bookings, mark past appointments completed, no-show or cancelled.
- **Refresh the showcase.** Then run the additive `db:seed-working-app` (or `db:refresh-demo`) against the intended demo database to add today's queue, upcoming reservations and attendance.
- **Record today's attendance** on Barber Floor before starting services.
- Never run a full-reset SQL script against a demo you need: wiping accounts removes the demo logins, and the destructive `db:seed-demo` is only for a fresh disposable database.

## Troubleshooting

- Use `.app` demo emails and the current environment. Do not assume an old `.local` address or published seed password matches a modified account.
- **No branch assigned:** sign in as Administrator and assign the staff account through Branches. A Manager cannot grant themselves additional branch authority.
- **Missing demo fixtures/branches:** check the prerequisites above. Additive seeds preserve progress and do not create every missing dependency.
- **Database/environment errors:** follow [running.md](running.md). Restart Next.js after changing `.env.local`.
- An earlier deployed-demo report is historical evidence, not proof of the current hosted schema, account state, or browser behavior.
