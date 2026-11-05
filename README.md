# Barracks Barbers & Shaves

Barracks is a Next.js App Router WA prototype for barbershop operations. The active application lives in `barracks-wa/` and combines a public landing page, customer booking/account flows, staff operations, administrator management, and a PostgreSQL-backed sprint implementation.

This is the canonical project guide. It combines the product context, design direction, runtime architecture, codebase map, API contract, database notes, and current limitations in one place. The two supporting documents stay focused on their specific jobs:

- [Running Barracks locally](running.md) covers environment setup, migrations, seeding, and troubleshooting.
- [Demo guide](DEMO_README.md) covers demo accounts, seeded showcase data, and the recommended walkthrough.

## Barber payroll

The management workspace at `/admin/payroll` implements the commission-only payroll rules described in this section. Administrators can review and record payment in permitted branches; assigned Managers alone can approve payroll or confirm a missing historical rate. Front Desk, customer, and supplier accounts cannot access payroll navigation, pages, or APIs.

Migration `028_barber_payroll.sql` adds an immutable earnings ledger, effective-dated rates, service-completion snapshots, 14-day calendars, drafts, adjustments, approval events, and single full external disbursements. It does not alter existing sales or deduct attendance wages. Apply it with the existing `npm run db:migrate` workflow only in the intended environment after reviewing migration/reconciliation results. New payroll tables enable RLS and deny Supabase browser-role access; the existing server session and branch checks authorize all application access.

Supabase project `barracksbarbers` received migration 028 on October 10, 2026. Activation preserved 12 accounts, 9 barbers, 173 bookings, and 144 transactions with their 144 tenders. It recorded 9 initial rate histories and 144 historical service snapshots whose old rates require Manager confirmation. No branch calendars, payroll drafts, or disbursements were created. Live service reads succeeded for the existing Administrator and Manager across all five branches; Front Desk was denied in every branch. The combined payroll, payment, queue, and migration regression suite passed all 21 tests in disposable schemas.

Before generating payroll, open **Commission settings** for the selected branch and choose an explicit first period start date. No anchor is inferred. Every period is start-inclusive and end-exclusive in Asia/Manila, and drafts can be generated after the 14-day period closes. Configure each barber's individual rate with a required reason and optional future Manila effective time. The old bulk-rate API now returns HTTP 409 and directs users to Payroll settings. Barber profile editing retains profile/rating controls; rates belong to the audited payroll editor.

At completion, payroll snapshots the source service price, name, barber, branch, and effective rate. At successful checkout it accrues the original price times the snapped rate, with PostgreSQL NUMERIC arithmetic and half-up rounding once per service to integer centavos. The transaction and tender commit together with commission accrual. Discounts and later catalog/rate changes do not reduce earned commission; refunds retain it. The current payment UI does not offer discount entry, but payroll uses the undiscounted source snapshot rather than the paid amount. Tips and automatic deductions are excluded.

Historic completed services retain source price/completion evidence, but migration never assigns today's rate retroactively. Missing historical rates appear in Payroll settings. An assigned Manager can append a correction with the confirmed rate and supporting reason; this preserves the original snapshot and records approver/time. Already-earned commission cannot be edited; genuine corrections use itemized signed adjustments on a Draft or a separately approved supplemental payroll. Historic voided transactions are not retroactively accrued. Post-payment voids of qualifying services are blocked until the owner defines their distinct policy; refunds remain a separate operation.

Generate → Draft → Pending Approval → Approved → Paid. Returning pending payroll to Draft requires a reason. A Manager's approval locks the breakdown, including adjustments. Recording Paid requires one full disbursement in cash, bank transfer, or e-wallet, a payment time at/after approval, and an optional reference. Barracks records external payment; it does not transfer funds. Draft regeneration and checkout retries are idempotent. Late entries for Approved/Paid records generate a separate supplement linked to the original record, with its own submission, Manager approval, and payment. Pending records must first be returned to Draft before regeneration incorporates new entries.

Payroll history supports branch, period, barber, status, and name filters. Detail views preserve source transactions, service dates, original prices, snapped percentages, refund status, adjustments, and audit events. Paid records provide print/Save PDF and downloadable standalone HTML payslips with shop/barber identity, period, eligible service count, gross commission, itemized adjustments, payable/paid totals, disbursement details, and Manager approval. Barber Management displays ledger-accrued commission separately from service sales.

The payroll workspace uses content-sized table columns, right-aligned monetary values, and readable row spacing. Filters and section controls wrap on smaller screens; wide breakdown tables scroll within their panel to keep all financial details available without widening the page.

Overview shows current-period accrued earnings separately from generated payable drafts, plus confirmed services awaiting assignment. Earnings before the configured first calendar date are flagged for explicit review rather than silently moved. Deleting a source booking through the existing authorized workflow clears its live foreign key while retaining the immutable logical visit identity and financial snapshot.

Locked-record corrections can explicitly create a separate correction draft with a required reason, even when no late service arrived. Additions use a supplemental payroll linked to the original. Deductions can be recorded on a later Draft with sufficient earnings, with the original approved payroll ID as an immutable source reference. The server verifies matching barber/branch, preserves the original disbursement, and requires fresh Manager approval.

`GET /api/payroll?branchId=...` reads the overview/settings/history; add `recordId` for the full breakdown. `POST /api/payroll` accepts validated `configure`, `rate`, `correct_snapshot`, `generate`, `supplement`, `adjust`, `submit`, `return`, `approve`, and `pay` commands. Branch is explicit on every request; server totals and approval identity are never accepted from clients. Focused verification lives in `tests/payroll*.test.ts` and uses disposable database schemas, never live payroll tables.

## Quick start

Create a local PostgreSQL database and `.env.local` using [running.md](running.md), then run from `barracks-wa/`:

```bash
npm ci
node --env-file=.env.local --import tsx scripts/db-migrate.ts
node --env-file=.env.local --import tsx scripts/seed-admin.ts
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and sign in with the configured `INITIAL_ADMIN_EMAIL` and password. Node's `--env-file` loads database settings for each script on Windows, macOS, and Linux; npm database scripts require those variables to be exported separately. An existing shell variable takes precedence over the file.

Only for a fresh disposable demo database, run `node --env-file=.env.local --import tsx scripts/seed-demo.ts` before starting the app. The replacement seed is destructive to non-administrator business data and is not an update command. For an existing showcase, see the prerequisites and additive `db:refresh-demo` / `db:seed-working-app` options in [DEMO_README.md](DEMO_README.md). New Manager and Front Desk accounts require explicit branch assignments through Administrator **Branches**.

The current seeded demo emails end in `@barracks.app`; credentials and role walkthroughs are maintained in [the demo guide](DEMO_README.md#demo-accounts). Existing administrator passwords are not changed by reseeding: use `node --env-file=.env.local --import tsx scripts/reset-admin-password.ts` only when deliberately resetting the account identified by `INITIAL_ADMIN_EMAIL`.

## Product and sprint scope

Barracks connects the daily rhythm of a barbershop—bookings, barber availability, customers, inventory, and management oversight—inside one shared product. Staff need fast scanning and low-friction updates on the shop floor; administrators need a wider business view; customers need a simple account and booking path.

The active `sprint-2` experience includes:

- Public landing page with Barracks branding, service information, branches, contact details, and login/customer-account actions. Its full-bleed hero uses a landscape adaptation of the real Barracks shop photo at `barracks-wa/public/barracks/hero-barracks-landscape.png`, retaining the Barracks uniform and lightly altering the faces; it pairs with a left-aligned Barracks lockup, red establishment kicker, appointment/service actions, bottom benefits rail, responsive navigation/footer rules, smooth anchor scrolling, scroll-linked image depth, staged section reveals, fully visible responsive service numerals, and compact inline icon labels.
- The public header fades in without a transform so the mobile navigation menu fills the viewport below the header and scrolls to all links and actions without being clipped.
- Customer and supplier phone inputs are capped at 11 characters in the UI and server schemas, with the API enforcing the same limit for signup, profile, customer-management, and supplier-management payloads.
- Staff management is available to administrators and managers: administrators can view all staff accounts and create, edit, manage lifecycle, and deactivate permitted accounts, but cannot deactivate themselves or manage another administrator account; managers can view and manage front-desk accounts only.
- Customer signup, login, profile details, preferred barber, loyalty points, booking, and appointment history.
- Service management supports creating, viewing, editing, archiving/restoring, and deleting services for administrators and managers. Delete is available only for services with no bookings, queue visits, or transactions; the backend rechecks usage under a row lock and rejects deletion with HTTP 409 if history exists. Archive marks a service inactive for new visits while retaining existing records. Both archive and deletion require confirmation in the interface; no database migration is needed.
- Customer management supports editing registered and accountless walk-in profiles. Staff can update walk-in names, phone numbers, and preferred barbers; only management can change loyalty points. Walk-in edits do not require an email or create a login account. Existing Philippine mobile numbers in `+63` format are shown in the editor as equivalent 11-digit `09` numbers. Account deactivation remains available only for registered customers.
- Appointments require a registered, undeleted customer account with the customer role. Staff booking choices exclude accountless walk-ins; a selection that disappears or becomes accountless is cleared and cannot submit. Customer self-booking continues to use the signed-in account. Accountless customers can still be created, edited and served through Queue without creating an account; the booking API continues to reject accountless appointment requests.
- Front Desk workspace with a live barber overview dashboard, queue, bookings, payments, customers, and a Barber Floor view with daily status controls. The dashboard shows the active queue count and a preview from `/api/queue?view=active`.
- Management workspace with dashboard counts, staff account management, barber management, inventory, suppliers, restocks, inventory reporting, and payment-derived sales reporting. Barber management keeps section spacing above and below the roster summary cards.
- Supplier portal for a linked supplier account, its supplied items, deliveries, and restock requests.
- PostgreSQL-backed CRUD for user accounts, barber employee profiles, services, inventory, suppliers, and restock requests, plus database-backed booking creation/editing/status updates.
- Shared operational card/list/drawer modules that give customers, barbers, staff accounts, suppliers, restocks, bookings, queue, and inventory one consistent interaction language.
- Role-aware navigation: one full sidebar for Administrator/Manager and a focused operational sidebar for Front Desk.

The app uses URL-backed Next.js routes for the active surfaces. The browser restores the requested page after refresh, and protected routes rehydrate the current account from the HTTP-only session cookie before rendering the workspace.

### Scheduling foundation

Shop hours are scoped to the selected branch, with one row per branch and weekday. `/api/shop-hours?branchId=...` resolves authorized branch access; barber schedules and availability use the barber's owning branch. Repeated weekdays across different branches are expected. Apply all current migrations before using this version against an older database.

Migration `010_scheduling_availability.sql` stores seven shop operating days, recurring barber shifts and breaks, and timestamped barber unavailable periods. Hours are initially 9:00 AM–7:30 PM daily in Asia/Manila. Existing barbers receive matching shifts during migration; newly created barbers receive seven shifts based on the current shop hours in the same transaction as the new profile. Administrators and managers can edit these in Barber Management, where the scheduling panel follows the roster layout and incomplete schedules are flagged. A missing schedule day offers no appointment slots. Front Desk and customers can read shop hours but cannot change schedules.

`GET /api/shop-hours` returns the weekly hours and timezone; `PUT /api/shop-hours` updates one day for management roles. Management can use `GET/PUT/POST/DELETE /api/barbers/:id/schedule` to read or change shifts, breaks, and unavailable periods. `GET /api/bookings/availability?serviceId=...&barberId=...&date=YYYY-MM-DD` is available to customers, Front Desk, managers, and administrators. Omitting `barberId` returns the union of slots across available barbers. Slots respect shop hours, working shifts, breaks, temporary absences, active bookings, current Philippine time, and the barber's globally unavailable status. A busy barber remains schedulable for future free times. Booking creation and editing revalidate the slot on the server. Any Available Barber selects the eligible barber with the fewest active appointments on the date, then the lowest ID. Migration `011_booking_overlap.sql` adds PostgreSQL exclusion constraints for active barber and customer intervals, including concurrent writes; adjacent appointments remain valid.

Customer and Front Desk booking forms use these server-generated slots, clear a selected time whenever the service, barber, or date changes, and show an appointment review before submission. Customers must choose a specific barber when creating or editing an appointment. Available times load only after selecting a service, barber and date; the form prompts for these selections instead of reporting no available times prematurely. Customer booking writes also require a barber ID on the server. Customers receive an on-screen confirmation with their selected barber, booking ID, price, notes, and status. Front Desk retains the Any Available Barber option. Customers can edit or cancel their own pending or confirmed bookings; rescheduling returns the booking to pending approval. Checked-in and later appointments are read-only. Front Desk can check in, start service, complete, cancel eligible bookings, or mark a confirmed booking no-show after a staff-triggered 10-minute Asia/Manila grace period. The API enforces each transition. Bookings and queue entries retain their branch, while customer booking choices follow the selected branch availability.

Queue management uses `queue_entries` in PostgreSQL. From Add to Queue, front desk can select an existing customer or create a walk-in record with a name and optional phone, then continue with service and optional barber selection. Creating that customer record and its queue entry is one transaction; no login account or placeholder credentials are created. Migration 016 allows customers without a linked user and stores their name, while registered customer accounts keep working as before. Queue submissions require an idempotency key so retries cannot create duplicate customer or queue rows. A walk-in without a barber starts `waiting`; assigning or changing a barber makes it `ready`, and clearing the barber returns it to `waiting`. Only `ready` entries can start service (`in_progress`), and only an `in_progress` entry can be completed. Waiting or ready walk-ins can be removed; completed and removed entries are terminal. Start and completion timestamps are set once and remain ordered. The shared lifecycle helper checks transitions, and migration 015 enforces state and timestamp consistency in PostgreSQL; existing invalid rows must be reconciled before that migration can apply. Check-in creates one booking-linked ready entry; starting, completing, or cancelling a checked-in booking updates booking and queue together in a transaction. Generic walk-in operations reject booking-linked entries. Assignment means ready for handoff; it does not start service. The server checks the barber's manual unavailable block, active service, current Manila shop/shift hours, scheduled breaks, and temporary absences at assignment and again at start. The stored `busy` status is a legacy manual value, not live queue state; an `in_progress` queue entry determines whether the barber is serving someone. A transaction locks the barber row before starting, and migration 014 adds a partial unique index so even simultaneous or direct database writes cannot create two active services for one barber. The Queue page reads the API on reload and displays rejection messages from the server. The Payments page lets Front Desk, Manager, and Administrator check out completed unpaid bookings and walk-ins; Manager and Administrator also have permitted refund/void controls. It shows searchable, filterable, paginated transaction history from PostgreSQL and can reopen printer-friendly receipts from saved transactions. Settings, calendar sync, notifications, email confirmations, and complete visit history remain outside the active sprint screens. Service management uses the PostgreSQL catalog. The `/admin/reports` surface serves inventory reporting through `GET /api/reports/inventory` and sales reporting through `GET /api/reports/revenue`; the larger reporting prototype remains in the repository as reference material. The unused static data barrel, empty booking/queue fixtures, and test-only booking-list helper were removed; live screens continue to read their APIs.

The Queue page also offers a front-desk **Next Customer** action for a selected operationally available barber. The server first suggests the oldest `ready` entry assigned to that barber, then the oldest unassigned `waiting` walk-in; ties use queue ID. It excludes started, completed, removed, and un-checked-in appointment entries. Staff review the customer, service, check-in time, and assignment before acting. Confirming an unassigned suggestion rechecks availability and queue order, then assigns the barber and moves the entry to `ready`; the separate Start Service action remains in the queue drawer. A changed suggestion must be requested again.

The Queue page defaults to **Active** (`waiting`, `ready`, `in_progress`) and has a read-only **Completed Today** view. The latter shows customer, service, barber, visit type, and start/completion times for entries whose completion instant falls within the current `Asia/Manila` calendar day. The API filters both views in PostgreSQL; older completed and `removed` entries do not appear in either normal view. Both views retain joined-time and ID ordering. The staff dashboard requests the active view for its count and preview.

Barber Floor shows today's attendance beside each barber's operational status. Front Desk can mark Present, Late, or Absent and clock a barber in or out there. Manager and Administrator have an Attendance page with date, barber, and status filters for history; record details include a correction form and saved correction history. Attendance dates remain Manila calendar dates in API responses regardless of server timezone. Barbers remain business records without login accounts. Attendance does not calculate pay. Explicit absence or clock-out blocks new service starts today; Unmarked remains distinct and eligible if the other rules pass. Clock-out is rejected while a service is active. Today's absence does not remove future booking slots.

Every queue API record includes a derived `visitType`: `walk_in` for an entry without a booking and `appointment` for a booking-linked entry. Appointment records also return the booking's scheduled date and time, current booking status, and existing assigned barber; the queue table does not copy these booking fields. Active cards and lists show a visit-type badge and scheduled appointment time. Next Customer labels a booked suggestion as a checked-in appointment and keeps the existing ready-before-waiting selection order. Confirmed bookings are not in the active queue; even an inconsistent queue row linked to a confirmed booking is filtered out. The completed-today view labels both visit types. Appointment service actions remain in Bookings, where booking and queue status changes stay transactional.

### Roles and access

There are five account roles:

Barbers and accountless walk-ins are staff-managed records, not additional login roles.

- `administrator`: has every module in one sidebar, including the day-to-day Front Desk pages (Front Desk Today, Bookings, Queue, Payments, Barber Floor), and can confirm, reject, create, edit and remove bookings, run the queue, and check out, alongside staff accounts and sensitive controls.
- `manager`: uses the same full sidebar for their assigned branches: bookings, queue, checkout, customers, barber roster and schedules, suppliers, inventory, restocks, reports, transactions, services, commissions, and attendance history/corrections. Managers can manage front-desk staff accounts only and perform refund/void actions. Managers cannot deactivate suppliers or use the remaining Administrator-only deletions (barbers, customers).
- `front_desk`: works in Front Desk on customers, queue, bookings (including confirming or rejecting customer requests and removing closed bookings), checkout, barber operational status, and today's barber attendance. It cannot access attendance history/corrections, inventory, suppliers, restocks, reports, roster editing, schedules, shop-hour mutations, financial adjustments, or staff-account management.
- `customer`: can access only their own customer dashboard/profile and booking flow, including editing or cancelling their own upcoming bookings; customers cannot complete or delete bookings.
- `supplier`: can access the supplier portal for the linked supplier account and its restock requests.

Barbers are business records, not login identities. They do not have accounts or sessions. The migration reassigns legacy `barber` user rows to `front_desk` and removes the obsolete role.

The page-access map in `app/constants/navigation.ts` and `app/utils/view.ts` classifies operational routes, shared Payments, and Management routes for direct URL access and navigation. Front Desk cannot open Management pages by URL; Managers and Administrators can also open daily operational pages within their branch authority. Older `/staff/inventory`, `/staff/suppliers`, and `/staff/restocks` URLs redirect authorized management users to their `/admin` equivalents. Sensitive Administrator-only controls remain inside management pages and are guarded by the API. Barber/customer deletion and supplier deactivation/login creation require Administrator. Barber profile commission/rating fields remain Administrator-only; audited effective-dated rates are managed in Payroll settings, and the legacy bulk commission API returns 409. The Front Desk Barber Floor changes operational status through `/api/barbers/:id/status` and today's attendance through `/api/attendance/today/:barberId`. Payments shows checkout to all staff roles and refund/void controls only to management; Front Desk receipts omit correction reasons and responsible staff details. API guards enforce the same split.

Front Desk navigation shows Dashboard, Queue, Bookings, Payments, Customers, and Barber Floor. Manager and Administrator share one sidebar grouped as Today (Dashboard, Front Desk Today, Bookings, Queue, Payments), People (Customers, Staff, Barbers, Barber Floor, Attendance, Payroll), Business (Services, Reports, Branches; Branches is Administrator-only) and Stock (Inventory, Suppliers, Restocks). There is no workspace switcher; management roles always use this sidebar. A deactivated supplier company blocks sign-in and existing sessions for every login linked to it.

The financial audit panel is shown only in Management. Front Desk receipts still show payment status without refund or void audit details.

## Design direction

### North star

The product follows a restrained Barracks monochrome system. The public site keeps its editorial identity, cream paper surfaces, and photography, while the authenticated product uses a compact dark operational workspace. Both retain the same brand voice while adapting density and interaction patterns to their context.

Dark mode remains the default for operational surfaces. The existing light-mode preference uses `data-theme` and persists in `localStorage["barracks-theme"]`.

### Color system

| Role | Value | Use |
| --- | --- | --- |
| Near black | `#0B0D0D` | Main application canvas |
| Charcoal | `#0F1111` | Sidebar and deep inset regions |
| Dark gray | `#1C1E1F` | Main operational panels and cards |
| Elevated | `#232526` | Controls, popovers, and raised surfaces |
| Hover | `#292B2C` | Interactive hover and selected depth |
| Off white | `#F2F0EA` | Primary text and monochrome actions |
| Cream | `#F3F1EB` | Public paper surfaces and light accents |
| Muted | `#B0B0AB` | Supporting copy and control labels |
| Green / amber / red | semantic tokens | Success, warning, and danger only |

Shared components should consume semantic aliases such as `--ink`, `--surface`, `--text`, `--line`, and the status tokens rather than introducing local hex values. Every status must also have a readable text label and must not rely on color alone. Internal operational modules use the shared hybrid primitives in `barracks-wa/app/components/operations/OperationalPrimitives.tsx` for card/list toggles, filter toolbars, responsive tables, action menus, status badges, and accessible right-side detail drawers that become full-screen mobile sheets.

The shared `EmptyState` component requires a title and accepts an optional description. Title-only states render without an empty description paragraph; supplied descriptions remain visible.

The inventory item drawer and the shared detail drawer use a simple two-state transition: closed at `translateX(100%)`, open at `translateX(0)`, with a matching scrim fade over 180ms. The drawer holds its populated content while sliding back out, stops accepting input as soon as closing begins, and focuses its close control without scrolling the page. `barracks-wa/app/hooks/useDrawerPresence.ts` keeps a closing drawer mounted until the transition finishes, cancels an opening that is closed before its first frame mounts, and publishes `entering`, `entered`, and `exiting` as `data-state` on the drawer layer. Reduced-motion mode skips the drawer and scrim transitions.

### Typography

- The public hero uses the bundled Barracks lockup image for the oversized brand moment, with Sora and Inter retained for navigation, controls, and supporting editorial UI.
- The type system lives in `barracks-wa/app/design-system.css`: `--font-heading` (Sora) for page and section titles, `--font-ui` (Inter) for all interface text, `--font-numeric` (Geist Mono) only for figures such as prices, counts, IDs and dense time columns, and `--font-wordmark` (the serif) only for the Barracks wordmark.
- Sizes and weights come from the same file: `--text-2xs` (10px) through `--text-3xl` (32px), and four weights (`--weight-regular`, `--weight-medium`, `--weight-semibold`, `--weight-bold`). New styles should use these tokens rather than raw values.
- Times are shown in 12-hour format (`9:30 AM`) everywhere through `formatTime`/`formatTimeRange` in `app/utils/format.ts`; dates use `formatDate`.
- Primary buttons are the inverse of the page in both themes (off-white on dark, near-black on light). Workspace sections share one vertical gap (`--space-section`).

Keep serif display styling out of dense tables, forms, and operational copy. Public body text should remain readable and comfortably narrow; internal text should favor scanability.

All customer-facing and operational prices use the Philippine peso symbol (`₱`).

### Layout and material

The public composition remains a paced editorial read: compact navigation, a photography-led hero, service cards, a dark barber roster, branch details, an about/contact section, and a decisive CTA/footer close. Cream and paper surfaces contrast with the dark sections while Barracks photography and the display face carry the brand.

The internal workspace uses a persistent sidebar, a compact sticky topbar, metric rows, layered panels, tables, modals, and clear action zones. Shared controls use restrained radii, quiet borders, and monochrome selection states. The shared UI primitives live in `barracks-wa/app/components/ui/`.

### Product and accessibility principles

- Keep the next operational action obvious.
- Separate staff operations from management oversight without splitting the brand.
- Let bookings, barber availability, customers, inventory, and reporting tell one connected story as the backend grows.
- Make routine updates safe, reversible, and explicit.
- Use semantic controls, visible keyboard focus, readable contrast, clear status labels, and text alongside state colors.
- Keep dialog focus stable while controlled forms rerender, and return focus to the launching control when a modal closes.
- Keep dense booking and schedule-row time/date labels compact and on one line for quick scanning.
- Keep report period actions aligned to the date input controls, with the toolbar wrapping safely at narrow widths.
- Keep shared staff tables aligned by declaring each table's real column count (`staff-table--cols-2` through `staff-table--cols-6`), and stack each cell's primary and secondary text instead of letting them run together on one line.
- Keep page-level vertical rhythm in one place: `app-content > * + *` in `barracks-wa/app/globals.css` spaces stacked panels and metric grids, and adjacent margins collapse into it. Do not add per-block `margin-bottom` values to fix a single page.
- Define every table grid track as `minmax(<minimum>, <fr>)`, never a bare `fr`. A bare `fr` track floors at its own min-content, which differs between the header labels and the row values, so the header and rows resolve to different column widths and drift out of alignment. Give action columns a padded pixel minimum wide enough for their controls.
- Keep row actions compact and contained: a row of inline text buttons crowds the actions column and forces the whole table wider. Give action-heavy tables such as Suppliers a minimum action track and right-align the complete group, put multi-step row actions behind one icon trigger (the shared `stockIn` icon, a carton with an arrow entering it) that opens a chooser, and reserve inline icon buttons for single-step actions (edit, history, deactivate). Choose an icon whose metaphor matches what the menu does rather than a generic overflow/more glyph.
- Preserve factual Barracks content for Davao, its branches, services, roster, contact details, and hours. Synthetic data and placeholder imagery must remain clearly replaceable.

## Architecture

The current sprint uses a hybrid path: the active sprint entities are served by Next.js Route Handlers and PostgreSQL, while the public content and older out-of-scope prototype modules still use local TypeScript data and, in some cases, browser state.

### Server-backed request path

```text
React UI
  -> app/lib/api.ts
  -> Next.js Route Handler in app/api/
  -> session lookup / role check + Zod validation
  -> server/services/
  -> server/db/pool.ts
  -> PostgreSQL
```

Client components call same-origin `/api/...` endpoints. They never connect to PostgreSQL directly. Route Handlers own HTTP parsing and response formatting; server services own database operations and business rules; schemas own input validation.

### Client-only path

```text
React UI
  -> app/data/landing.ts static marketing content
  -> component state
```

The only browser storage is the light/dark theme preference and the customer's remembered booking branch.

The current sprint pages use the API for customers, barbers, inventory, suppliers, restocks, inventory and revenue reporting, services, bookings, staff accounts, supplier accounts, and customer sessions. Front Desk Payments loads eligible visits for checkout and transaction history; Management Transactions loads history and financial actions without checkout controls. The reference lookup supplies persisted receipt details for both checkout printing and later reprints. The landing page still consumes static marketing content from `app/data/landing.ts`. Booking creation and editing load services from PostgreSQL and store name, price, and numeric duration snapshots with an expected end time and optional notes.

### Runtime composition

`barracks-wa/app/layout.tsx` is the root document shell. It loads Geist, Geist Mono, Libre Baskerville, Inter, and Sora, imports `app/globals.css` and the canonical `app/theme.css` layer followed by the landing, login, and booking stylesheets, bootstraps the stored theme before hydration, and defines page metadata.

`barracks-wa/app/components/BarracksApp.tsx` is the client composition root. It:

- Tracks the active `ViewId`, pending destination, current user, search value, and toast message.
- Restores the current session through `GET /api/auth/me` when the app loads.
- Redirects unauthenticated users to login when a protected view is selected, preserving the requested destination after sign-in.
- Redirects customers to the customer area and prevents them from entering staff views.
- Redirects supplier accounts to the supplier portal and keeps them out of staff and management views.
- Chooses the full management sidebar for Administrators/Managers and the operational sidebar for Front Desk, with no workspace switcher.
- Handles sign-out through `POST /api/auth/logout`.

`barracks-wa/app/utils/routes.ts` maps active view identifiers to canonical browser paths, while `barracks-wa/app/[...slug]/page.tsx` exposes those paths through the App Router. `barracks-wa/app/pages/PageRouter.tsx` maps active view identifiers to feature pages. `AppShell` owns sidebar navigation, workspace context, search, profile/sign-out controls, and the internal frame. This client routing is not a substitute for server-side authorization.

## Repository structure

```text
.
├── README.md                         # Canonical product, design, system, and codebase guide
├── DEMO_README.md                    # Focused demo walkthrough and showcase accounts
├── running.md                        # Focused local setup and troubleshooting guide
└── barracks-wa/
    ├── app/
    │   ├── api/                      # Next.js Route Handlers
    │   │   ├── auth/                 # login, signup, logout, current-user lookup
    │   │   ├── barbers/              # barber list and CRUD
    │   │   ├── bookings/              # booking list/create/edit/status update
    │   │   ├── customers/             # staff list/create/update and customer self-service
    │   │   ├── health/                # unauthenticated health response
    │   │   ├── inventory/             # inventory list, CRUD, movements, alerts, thresholds
    │   │   ├── reports/               # management inventory and revenue reporting
    │   │   ├── restocks/              # restock requests, status, delivery, receiving
    │   │   ├── supplier/              # supplier portal self-service
    │   │   ├── suppliers/             # supplier CRUD and supplier accounts
    │   │   └── users/                 # management-role staff account APIs
    │   ├── components/
    │   │   ├── BarracksApp.tsx          # persistent client app and session hydration
    │   │   ├── bookings/              # shared booking form
    │   │   ├── customers/             # shared customer form
    │   │   ├── inventory/             # shared inventory form
    │   │   ├── layout/                # AppShell, PortalTopbar, AccountMenu
    │   │   ├── operations/            # shared card/list/drawer operational primitives
    │   │   └── ui/                    # buttons, fields, panels, dialogs, badges, icons
    │   ├── constants/                 # navigation and role options
    │   ├── data/                      # landing content and inventory catalog images
    │   ├── hooks/                     # drawer transitions and scroll locking
    │   ├── lib/                       # frontend API wrapper and response types
    │   ├── pages/                     # public, auth, customer, supplier, staff, and admin screens
    │   │   └── public/landing-motion.css # landing-page scroll motion and entrance choreography
    │   ├── types/                     # shared frontend domain types
    │   ├── utils/                     # formatting, CSV download, view helpers, and route mapping
    │   ├── globals.css                # tokens, shared styles, shell, modules, responsive rules
    │   ├── theme.css                  # canonical dashboard theme layer
    │   ├── layout.tsx                 # document shell and metadata
    │   ├── page.tsx                   # public root route
    │   ├── [...slug]/page.tsx         # validated URL-backed app routes
    │   └── favicon.ico
    ├── public/                        # logo, branch imagery, and static assets
    ├── server/
    │   ├── auth/                      # session lookup, role guards, and branch access
    │   ├── db/                        # PostgreSQL pool and SQL migrations
    │   ├── schemas/                   # Zod schemas and validation formatting
    │   └── services/                  # database-facing domain and session services
    ├── scripts/                       # migration and seed commands
    ├── tests/                          # schema and PostgreSQL integration tests
    ├── package.json                    # scripts and dependencies
    ├── next.config.ts
    ├── postcss.config.mjs
    ├── tsconfig.json
    └── .env.example                   # server-only local environment contract
```

### Active page surfaces

The largest screens keep their dialogs, drawers and panels in a folder beside the page: `app/pages/staff/inventory`, `queue`, `payment` and `bookings`, and `app/pages/admin/restock` and `payroll`.

| Surface | Main implementation | Data path |
| --- | --- | --- |
| Public landing | `app/pages/public/LandingPage.tsx` and `app/pages/public/landing/*` | Static `app/data/landing.ts` and bundled imagery |
| Login/signup | `app/pages/auth/LoginPage.tsx` | `/api/auth/login`, `/api/auth/signup` |
| Customer dashboard/profile | `app/pages/customer/CustomerDashboard.tsx` — dashboard-style color accents for metrics and appointment state; the empty upcoming state keeps booking in the panel header instead of repeating a second button | `/api/customers/me`, `/api/bookings`, `/api/barbers` |
| Customer booking | `app/pages/customer/CustomerBookingPage.tsx` | Service catalog plus `/api/barbers` and `/api/bookings` |
| Staff dashboard | `app/pages/staff/StaffDashboard.tsx` — selected branch booking and queue metrics | `/api/barbers`, `/api/bookings`, `/api/queue?view=active` with `branchId` |
| Staff queue | `app/pages/staff/QueuePage.tsx` — active queue workflow and read-only completed-today view | `/api/queue?view=active`, `/api/queue?view=completed-today`, `/api/customers`, `/api/services`, `/api/barbers` |
| Staff bookings | `app/pages/staff/BookingsPage.tsx` — card/list schedule with appointment drawer | `/api/bookings`, `/api/customers`, `/api/barbers` |
| Staff customers | `app/pages/staff/CustomersPage.tsx` — card/list customer records, profile drawer, and CRUD | `/api/customers`, `/api/barbers` |
| Front Desk Barber Floor | `app/pages/staff/BarberFloorPage.tsx` — current availability, queue assignments, and daily status updates | `/api/barbers`, `/api/barbers/:id/status`, `/api/queue?view=active` |
| Management barbers | `app/pages/admin/BarbersManagement.tsx` — roster, profile drawer, and scheduling | `/api/barbers`, `/api/barbers/:id/schedule`, `/api/shop-hours` |
| Management inventory | `app/pages/staff/InventoryPage.tsx` — item cards/list with photo, branch, and stock state plus an item drawer | `/api/inventory` |
| Admin dashboard | `app/pages/admin/AdminDashboard.tsx` — branch or Administrator global aggregates | `/api/reports/dashboard?branchId=...` |
| Admin staff accounts | `app/pages/admin/StaffManagement.tsx` — card/list access roster with lifecycle drawer | `/api/users` |
| Management suppliers | `app/pages/admin/SuppliersManagement.tsx` — card/list vendor directory with profile drawer | `/api/suppliers`, `/api/inventory`, `/api/restocks` |
| Management restocks | `app/pages/admin/RestockManagement.tsx` — workflow cards/list with request drawer | `/api/restocks`, `/api/suppliers`, `/api/inventory` |
| Admin inventory reports | `app/pages/admin/InventoryReports.tsx` — current stock cards, low-stock attention list, usage composition, supplier spending bars, and expandable usage/movement tables | `/api/reports/inventory` |
| Admin sales reports | `app/pages/admin/RevenueReports.tsx` — sales/reversal cards, calendar-first daily activity and a line chart, service/barber/payment bars, and expandable exact figures | `/api/reports/revenue` |
| Supplier portal | `app/pages/supplier/SupplierPortal.tsx` — profile, supplied items, open requests, delivery history, and account settings | `/api/supplier/me`, `/api/restocks`, `/api/supplier/account` |

The unused prototype report and settings screens, with their static seed data, have been removed; the `/admin/reports` destination renders `ManagementReports` with sales and inventory sections. `ServicesManagement` is available at `/admin/services` to managers and administrators. `QueuePage` and the staff `PaymentPage` are active PostgreSQL-backed shop-floor destinations.

Management Reports uses one period toolbar for both sections, with Today, This week (Monday onward), This month, Last 30 days, and custom inclusive dates in Manila time. Switching sections preserves the applied period. Sales highlights show the busiest checkout day, highest net-revenue service, and average gross checkout value. Daily activity opens on the calendar, with a Line chart toggle. The line chart switches between gross sales, net revenue, and transaction count; long periods use up to 60 equal-sized date buckets. Selecting a point or calendar date shows exact sales and reversal totals; the calendar supports month navigation within the selected period. Missing daily activity is shown as zero. Negative net revenue stays visible below zero and in red calendar cells. Service/barber bars rank net revenue; payment bars show gross sales and their share of gross sales. All breakdowns remain accessible in expandable tables.

Inventory distinguishes current valuation, active items, and low-stock status from period activity. Usage bars show each item's used/sold/wasted composition, with a comparison to the preceding equal-length period; quantities across different item units are not combined into a shared total. Low-stock previews show six items, usage previews show six active records, and ranked spending/revenue bars show seven groups with full detail tables beneath. Movement history shows up to the latest 250 records with Manila timestamps. Both APIs now use Manila midnight boundaries for period activity. Report loading and errors have dedicated states and a retry action; a failed or superseded request cannot present an older period as the new result. No comparison revenue API, historical stock snapshots, or chart dependencies are introduced.

## API routes

All protected routes use the HTTP-only `barracks_session` cookie. JSON errors follow the general shape `{ success: false, message, errors? }`; validation errors include field-level messages.

### Authentication

- `POST /api/auth/login` — public. Validates credentials, verifies the scrypt password hash, creates a seven-day database session, and sets the HTTP-only cookie. Returns `429` with `Retry-After` after too many attempts.
- `POST /api/auth/signup` — public. Validates customer details, creates a customer user plus linked customer record, and starts a session. Returns `429` with `Retry-After` after too many attempts.
- `POST /api/auth/logout` — clears the current database session and expires the cookie.
- `GET /api/auth/me` — returns the authenticated public user or `401` when no valid session exists.
- `GET /api/health` — public, database-independent health response.

### User management

- `GET /api/users` — administrator/manager; lists public staff account records visible to the actor: administrators see administrator/manager/front-desk accounts, while managers see front-desk accounts only.
- `POST /api/users` — administrator/manager; administrators can create administrator, manager, or front-desk accounts; managers can create front-desk accounts only.
- `GET /api/users/:id` — administrator/manager; reads one visible public staff record, including verification, blocked, and active state. Managers can view front-desk accounts only.
- `PUT /api/users/:id` — administrator/manager; updates identity, email, role, and optionally resets the password. Managers can edit front-desk accounts only.
- `PATCH /api/users/:id` — administrator/manager; accepts `verify`, `unverify`, `block`, or `unblock`, revoking sessions whenever access is disabled. Managers can change lifecycle for front-desk accounts only.
- `DELETE /api/users/:id` — administrator/manager; soft-deactivates a permitted account, revokes its sessions, and keeps the database record. Managers can deactivate front-desk accounts only; administrators cannot deactivate themselves, and the last administrator cannot be disabled, blocked, unverified, or deleted.

New staff accounts start unverified and unblocked. Login rejects unverified, blocked, or deactivated accounts. Account management provides search, role/status filters, a details view, and explicit lifecycle controls; passwords are hashed and never returned.

### Customers

- `GET /api/customers` — administrator/manager/front desk; lists registered and accountless customer profiles.
- `POST /api/customers` — administrator/manager/front desk; explicitly creates a registered customer account/profile. Accountless walk-in creation remains part of Queue and does not create a login.
- `GET /api/customers/:id` and `PUT /api/customers/:id` — administrator/manager/front desk; read/update a customer profile. Loyalty points are administrator/manager-only; Front Desk updates are limited to contact and preference fields.
- `GET /api/customers/me` and `PUT /api/customers/me` — customer only; read/update the profile linked to the current session.

Staff customer management includes search, profile details, contact/preference editing, loyalty-point updates for managers and administrators, and Administrator-only account deactivation. Accountless walk-in records can be edited through their profile without creating an account; login/deactivation actions apply only to linked accounts. Deactivation returns a conflict while the customer has a pending, confirmed, checked-in, or in-progress appointment; completed, cancelled, and no-show history remains available after deactivation. Booking writes recheck customer activity while locking the account/profile rows so a concurrent deactivation cannot leave a new active appointment hidden. The profile view is opened from the first action in each customer row and uses the same detail-modal pattern as barber profiles.

### Barbers

- `GET /api/barbers` — administrator, manager, front desk, or customer; Front Desk and customers receive only ID, name, and status, while management receives full barber records.
- `POST /api/barbers` — administrator/manager; creates a barber profile. Service totals are read-only.
- `GET /api/barbers/:id` — administrator/manager/front desk; Front Desk receives only ID, name, and status, as with the barber list.
- `PUT /api/barbers/:id` — administrator/manager; updates a barber profile.
- `PATCH /api/barbers/:id/status` — administrator/manager/front desk; accepts only `{ "status": "available" | "busy" | "unavailable" }` and updates daily operational status without profile fields.
- `PATCH /api/barbers` — administrator only; the retired bulk-rate operation returns 409 and directs users to Payroll settings for individual effective-dated rates with an audit reason.
- `DELETE /api/barbers/:id` — administrator only; deletes a barber only when no linked operational or historical record, including attendance, references the profile; otherwise returns a conflict.

### Inventory

- `GET /api/inventory` and `POST /api/inventory` — administrator/manager; list/create inventory items. Inventory rows have immutable numeric branch ownership; `GET` and `POST` accept `?branchId=...`, defaulting to the staff primary/first accessible branch.
- `GET /api/inventory/:id` and `PUT /api/inventory/:id` — administrator/manager; read/update an item.
- Inventory SKUs are unique within each branch (case-insensitive, blank SKUs excluded). Creating an item with, or editing an item onto, a SKU that is already in use returns `409` with "Another inventory item already uses this SKU" instead of a generic failure.
- `DELETE /api/inventory/:id` — administrator/manager; deletes an item that has never moved, or archives (deactivates) an item with movement, restock or threshold history and returns `outcome: "deleted" | "archived"`. Archived items are hidden unless the Archived filter is chosen.
- `GET /api/inventory/:id/movements` and `POST /api/inventory/:id/movements` — administrator/manager; list or record auditable stock movements with item branch context.
- `GET /api/inventory/:id/threshold-history` — administrator/manager; returns item/branch threshold changes with actor and timestamp.
- `GET /api/inventory/alerts` and `POST /api/inventory/alerts/:id/acknowledge` — administrator/manager; list and persist low-stock acknowledgements per user. Acknowledgements reactivate after stock rises above the branch threshold and later falls below it again.

Edit item includes the current stock count; changing it requires a reason and is recorded as an `ADJUSTMENT` movement, so the history stays auditable. Stock operations are grouped as Add to stock, Remove from stock, and Set actual count (a count correction entered as the number on the shelf), and every operation shows a before → after preview.

Inventory state is derived from quantity and the branch-specific minimum stock: In Stock, Low Stock, or Out of Stock. The UI provides a branch selector, search, category/status/supplier filters, editable minimum/maximum thresholds, validation, loading/empty/error states, metrics, confirmation dialogs, stock movement recording, and movement history. Threshold changes retain the item, branch, user, and timestamp. Receiving a restock also writes an auditable `RECEIVE` movement.

### Suppliers and restocks

- `GET /api/suppliers` and `POST /api/suppliers` — administrator/manager; list/create supplier records.
- `GET /api/suppliers/:id` and `PUT /api/suppliers/:id` — administrator/manager; read and edit suppliers. Only an Administrator can deactivate an active supplier, including through `PUT` status changes or `DELETE /api/suppliers/:id`.
- `POST /api/suppliers/:id/account` — administrator only; creates or links one supplier portal account.
- `GET /api/supplier/me` — supplier only; returns the linked profile, supplied items, deliveries, and restock history.
- `PATCH /api/supplier/me` — the linked supplier can update its company name, contact person, phone, email, address, and notes; status remains staff-managed.
- `GET /api/restocks?branchId=...` — administrator/manager receive requests for the authorized selected branch; supplier accounts receive only requests for their active supplier.
- `POST /api/restocks` — administrator/manager; creates a branch-scoped request with one or more unique items linked to the selected active supplier and branch. The staff Restocks workspace supports adding, removing, and editing lines.
- `PATCH /api/restocks/:id/status` — the linked supplier advances Pending → Accepted → Preparing → Shipped.
- `POST /api/restocks/:id/delivered` — administrator/manager; confirms arrival from any open stage (Pending, Accepted, Preparing or Shipped), so suppliers without a portal login never leave a request stuck.
- `POST /api/restocks/:id/cancel` — administrator/manager; cancels any request that has not been received.
- `PUT /api/suppliers/:id/items?branchId=...` — administrator/manager; sets which inventory items in the branch the supplier provides (`{ inventoryItemIds: number[] }`). Changing or removing an item's supplier returns 409 while it would strand an open restock, including transfers from another supplier. Inventory editing enforces the same rule. After creating a supplier, the Suppliers page opens this item picker so restock requests can be made straight away.
- `POST /api/restocks/:id/receive` — administrator/manager; receives every line of a delivered request transactionally, rejects duplicate/invalid transitions, updates stock, and writes `RECEIVE` movement records with item, supplier, branch, timestamp, and responsible user.
- `GET /api/reports/inventory` — administrator/manager; returns valuation, low-stock, supplier-spend, and movement summaries.
- `GET /api/reports/revenue?from=YYYY-MM-DD&to=YYYY-MM-DD` — administrator/manager; returns gross sales, refunded and voided amounts, net revenue, transaction count, daily sales, and service/barber/payment-method breakdowns. The default range is the latest 30 Manila-local dates. Both endpoints use inclusive report dates.

The supplier portal is a responsive supplier-specific workspace with a split overview: a compact clickable supplier profile card sits beside linked-item, open-request, delivery, and account-status metrics. Selecting the profile card opens the shared operational detail drawer for editing supplier details, while the restock and delivery panels preview the newest records and expose full queue/archive drawers when there are more to browse. Restock request and delivery-history rows also open read-focused drawers with status, branch, timestamps, notes, and line-item context. Supplier-facing status actions remain limited to the documented request transition flow. On wider screens, the lower supplied-items panel aligns with the bottom of the combined restock and delivery-history column before returning to natural stacked heights on smaller screens.

### Bookings

- `GET /api/services` — customer, front desk, manager, or administrator; customers receive active services only.
- `GET /api/services/:id` — the same roles; customers may read active services only.
- `POST /api/services` and `PATCH /api/services/:id` — manager or administrator; validate ID, name, description, nonnegative price, positive integer duration, and active state. `PATCH` can enable or disable a service.
- `GET /api/bookings` — administrator/manager/front desk receive bookings for their authorized selected branch; customers receive only their own bookings.
- `GET /api/bookings/availability/month?serviceId=...&month=YYYY-MM[&barberId=...][&branchId=...]` — every booking role; returns each day's open start count, the full list of times with `available` and a `reason` (`past`, `booked`, `break`, `away`, `outside_shift`) for unavailable ones, and a day `reason` (`closed`, `not_working`, `fully_booked`, `too_far`, …). The booking form loads this once per month (and prefetches the next), greys out unavailable dates and times with the reason, and refreshes every 30 seconds and on window focus. The per-day availability endpoint now also returns `times`.
- `POST /api/bookings` — staff (front desk, manager, administrator) can select a customer and create a `confirmed` booking; customers can create only their own booking, which starts as `pending` until staff confirm or reject it. Dates more than 90 days ahead (Manila calendar) are refused. The request includes a barber ID (required for customers; staff may omit it or send null for Any Available Barber), service, date, server-generated time slot, and optional notes (500 characters maximum).
- `PUT /api/bookings/:id` — staff can edit a pending or confirmed booking's customer, barber, service, date, time, and notes; customers can edit only their own pending or confirmed booking (a customer reschedule returns it to `pending`) and cannot change its customer ownership.
- `PATCH /api/bookings/:id` — staff can `confirm` or `reject` a `pending` request, move `confirmed → checked_in → in_progress → completed`, cancel a pending, confirmed or checked-in booking, or mark a confirmed booking no-show once its start is at least 10 minutes past (the drawer shows when No Show unlocks). Customers may only cancel their own pending or confirmed booking.
- `DELETE /api/bookings/:id` — staff can remove a booking that has not started or that closed without service (pending, confirmed, rejected, cancelled, no-show). Started and completed visits stay as records for payments and payroll.

Booking statuses are `pending`, `confirmed`, `rejected`, `checked_in`, `in_progress`, `completed`, `cancelled` and `no_show`. Migration `032_booking_approval.sql` adds `pending` and `rejected` and makes pending requests hold their slot in the same exclusion constraints as confirmed bookings. The staff Bookings page lists requests under Awaiting approval with one-click Confirm and Reject, hides closed bookings (cancelled, rejected, no-show) unless the status filter asks for them, and the management dashboard links to waiting requests. Customers see upcoming appointments soonest first; appointments whose time passed without a visit move to history.

Booking creation and editing validate the selected slot against shop and barber schedules, breaks, absences, existing bookings, and Philippine time. PostgreSQL exclusion constraints prevent overlapping active barber and customer intervals under concurrent requests, while allowing adjacent slots. The booking stores the service name, price, duration, and expected end time; notes are trimmed and stored as null when blank. Customers can cancel only their own pending or confirmed bookings. Front Desk, Manager, and Administrator retain authorized daily lifecycle actions and can remove pending, confirmed, rejected, cancelled, or no-show bookings. Started and completed visits remain on record. Booking-load failures have an error state and never fall through to “No bookings found.”

### Queue

- `GET /api/queue?view=active|completed-today` — administrator, manager, or front desk; defaults to active (`waiting`, `ready`, `in_progress`) and excludes booking-linked rows unless the booking is checked in or in progress with the matching queue state. Completed today contains only `completed` entries whose `completed_at` is in the current Manila-local calendar day; `removed` entries are excluded. Each record has derived `visitType`; appointment records include live booking date, time, and status. Unknown views return 400. Results keep joined-time and ID order.
- `GET /api/queue/next?barberId=...` — front desk, manager, or administrator reads the next eligible customer for an operationally available barber; returns an entry or a clear no-customer message without changing queue state. A checked-in appointment assigned to that barber has first priority. Otherwise, assigned ready walk-ins and then unassigned waiting walk-ins are considered in joined-time and ID order. Each walk-in must have an active service with a duration that fits from the current time through shop hours, shift, breaks, temporary unavailability, and active booking intervals. A longer walk-in can be skipped for a later shorter one; if none fits, the result is empty. This changes suggestions only; the visible Active Queue retains its original order.
- Queue writes below are open to front desk, manager and administrator.
- `POST /api/queue/next` — front desk confirms assignment of a suggested unassigned walk-in using `barberId` and `entryId`; the server rechecks current availability and the suggestion, then moves it to `ready` without starting service.
- `POST /api/queue` — front desk adds a walk-in with an existing customer or a new name/optional phone record, an active service, and an optional operationally eligible barber; the customer and queue entry are written transactionally, and an idempotency key is required for safe retries.
- `PATCH /api/queue/:id` — front desk assigns, changes, or clears a walk-in barber, starts a ready entry, or completes an in-progress entry. Assignment and start recheck operational availability; invalid transitions return a specific conflict message. Linked appointment entries can start or complete service through the booking lifecycle; booking and queue updates are transactional.
- `DELETE /api/queue/:id` — front desk marks a waiting or ready walk-in as removed. Appointment cancellation remains in the booking API.

### Barber attendance

- `GET /api/attendance/today` — Front Desk, Manager, Administrator; lists records for the current Asia/Manila date.
- `POST /api/attendance/today/:barberId` — the same staff roles; accepts `{ "action": "mark", "status": "present|late|absent" }`, `{ "action": "clock_in" }`, or `{ "action": "clock_out" }`. Clock-in and clock-out use server time. Clock-in creates a Present record when none exists and changes an Absent record to Present. Clock-out requires an open clock-in. Marking Absent after clock-in needs a management correction.
- `GET /api/attendance/history?barberId=&date=&status=` — Manager or Administrator; filters by barber ID, exact attendance date, and status, newest dates first.
- `GET /api/attendance/:id/corrections` — Manager or Administrator; returns every saved correction in reverse order.
- `POST /api/attendance/:id/corrections` — Manager or Administrator; requires status, nullable ISO clock-in/out values, and a nonblank reason. The record update and before/after correction entry commit together. Invalid clock order, clock-out without clock-in, and Absent with clock times are rejected.

All routes use server-side role guards: unauthenticated calls return `401`; disallowed roles return `403`. Front Desk cannot access historical records or correction endpoints.

### Payment foundation

- `POST /api/transactions` — front desk, manager, or administrator; accepts `{ "visit": { "bookingId": 1 }, "paymentMethod": "cash", "amountReceived": 500 }` or a `queueEntryId` visit. Non-cash methods omit `amountReceived`. Only completed bookings and completed walk-ins qualify. The server uses the stored visit price snapshot as both subtotal and total, records the signed-in cashier, and creates one completed full-payment transaction and tender atomically. Cash below the total returns `422`; an incomplete visit or duplicate checkout returns `409`. A booking-linked queue entry must be paid by booking ID. The result includes the reference, customer, service, barber, cashier, subtotal, total, method, cash received and change when applicable, status, and timestamp.
- `GET /api/transactions?reference=TX-...` — staff lookup by exact reference.
- `GET /api/transactions?view=eligible` — front desk, manager, or administrator can view completed unpaid bookings and walk-ins with stored service prices; the same staff roles can perform checkout.
- `GET /api/transactions?view=history` — administrator, manager, or front desk can read paginated persisted history with `page` (default 1), `pageSize` (default 20, maximum 100), optional reference/customer `search`, `paymentMethod`, and inclusive Manila-local `dateFrom`/`dateTo` filters. The response includes `total`, `totalPages`, and each sale's current refund/void status.
- `POST /api/transactions/actions` — administrator or manager only; accepts an exact reference, `refund` or `void`, the full paid amount, and a nonblank reason. A row lock serializes competing requests. The audit action and matching sale/tender status changes commit together. Completed sales can receive one full refund or void; repeat actions, partial amounts, and over-refunds return `409`. Receipt lookup includes the dated action, amount, reason, and staff snapshot alongside unchanged original payment details.

Accepted methods are `cash`, `card`, `e_wallet`, `bank_transfer`, and `other`. The API creates a single completed tender for the full amount. It accepts only cash received from the client, never a client-supplied charge amount or status. Database checks constrain the method/status columns, and deferred integrity checks require the sole tender to match the transaction header. Phase 5 supports full refunds and voids with immutable action history. Split and partial payments require a later schema/service change.

## Database and server layer

The backend uses raw parameterized SQL through `pg`. It does not use Prisma, Drizzle, Express, Hono, or another backend framework. The same server layer works with either a local PostgreSQL database or a hosted Supabase PostgreSQL database; the active target is selected by `DATABASE_URL`, with `POSTGRES_URL` as the Vercel Supabase-integration fallback.

`server/db/pool.ts` creates the PostgreSQL pool from `DATABASE_URL` or `POSTGRES_URL`, optionally enables SSL through `DATABASE_SSL`, and uses `DATABASE_POOL_MAX`, defaulting to `3` on Vercel and `10` elsewhere. Migrations are stored in `server/db/migrations/001_user_management.sql` through `033_auth_attempts.sql`, and run transactionally by `scripts/db-migrate.ts` through the shared migration runner, which records each applied file in `schema_migrations` and skips it on later runs. Migration 014 reports any existing simultaneous active queue entries for manual reconciliation before creating the unique index. Migration 015 rejects inconsistent existing queue states for manual reconciliation. Migration 017 preflights duplicate transactions per booking and aborts with transaction IDs before changing schema or data; the migration runner rolls back any failed migration. Migration 018 backfills queue service name/price snapshots, enforces visit identity consistency, and checks that each transaction has exactly one tender matching the header. Migration 019 records cash received and change on tenders, backfills earlier cash payments as exact payments, and enforces cash balance checks. Migration 020 adds append-only financial actions and rejects direct edits or deletion of finalized sales and tenders; deferred checks require a full-amount audit action for every new refunded/voided status. Migration 021 adds unique barber/date attendance, ordered clock times, and a dedicated correction log; attendance references restrict deletion of barbers with history. Database integration tests create and drop their own temporary schemas; they require an exported database URL and schema creation privilege. `npm test` runs test files sequentially to keep disposable-schema pools within PostgreSQL connection limits; the queue concurrency test still sends simultaneous requests inside its test.

`npm test` also runs direct API authorization tests with Node's module-mock flag, checking 401/403 responses and representative allowed actions without a database. Migration 011 checks existing active barber and customer booking intervals before adding its exclusion constraints. If it finds an overlap, it reports the booking ID pairs and rolls back migration 011 without changing bookings or marking it applied. Run the read-only `barracks-wa/scripts/booking-overlap-review.sql` against the affected database to list every pair in ID order. Staff must review the appointments, agree on an explicit time or lifecycle correction, and record that decision before rerunning `npm run db:migrate`. The application never chooses a booking to cancel automatically. Migrations 012 and 013 run after the conflict has been resolved and 011 succeeds.

Together these migrations create:

- `roles` — supported role names and descriptions.
- `users` — account identity, scrypt password hash, role, `is_verified`, `is_blocked`, optional `deleted_at`, and timestamps. Deactivated accounts remain stored but cannot sign in.
- `sessions` — SHA-256 token hash, user, expiration, and creation time.
- `barbers` — business name, availability status, commission rate, services completed, revenue, rating, and timestamps.
- `barber_attendance` — one row per barber and Manila-local date with Present/Late/Absent, server clock-in/out instants, recording/updating staff IDs, and timestamps. Its barber foreign key restricts roster deletion when history exists, and a trigger prevents deletion of recorded attendance.
- `barber_attendance_corrections` — record-specific before/after status and clock values, required reason, correcting staff ID, and timestamp. Corrections append rows and never delete prior entries.
- `customers` — registered customer profiles linked to a user, or walk-in records with a name and optional phone and no user account; preferred barber, loyalty points, and timestamps remain on the customer record.
- `inventory_items` — item name, category, quantity, minimum/maximum stock, unit, SKU, supplier link, status, unit cost, product photo, and timestamps.
- `bookings` — customer/barber relationships, service snapshot, price, date/time, status, demo key, and timestamps.
- `queue_entries` — optional unique booking link, walk-in customer/service/barber, immutable service name/price snapshots, queue status, joined/started/completed timestamps, and an optional idempotency key/fingerprint. Migration 013 links pre-existing checked-in and in-progress appointments; migration 014 permits only one `in_progress` entry per barber; migration 015 requires state-appropriate barber and timestamps, with completion no earlier than start; migration 016 supports accountless queue customers and duplicate-safe submissions; migration 018 backfills snapshots and copies booking snapshots to appointment queue entries.
- `suppliers` and `supplier_accounts` — supplier records and one linked supplier login per supplier.
- `inventory_movements` — auditable stock changes with before/after quantities, supplier, reference, and actor.
- `inventory_threshold_history` — branch-aware minimum/maximum threshold changes with the responsible user and timestamp.
- `inventory_alert_acknowledgements` — per-user persisted low-stock acknowledgement cycles that reset after replenishment.
- `restock_requests` and `restock_request_items` — supplier-linked requests, status transitions, delivery receiving, and line quantities.
- `services` — canonical service catalog with descriptions, numeric durations, prices, and active flags, referenced by bookings and transactions. Historical services with unknown durations are inactive until updated.
- `transactions` — one sale per completed booking or walk-in, with immutable visit type/ID and unique payment reference, optional live links, customer/barber/cashier/service name snapshots, amount, constrained method/status, and processing staff. Historical rows retain their original unfamiliar method/status in legacy columns while using normalized values. Snapshots survive changes or deletion of linked records.
- `transaction_payments` — one tender row linked to each transaction, including cash received and change for cash payments. Deferred database checks require the tender amount, method, and status to match its header; split tenders require a later schema/service change.
- `transaction_financial_actions` — append-only, one full refund or void per transaction, with the original transaction ID, action, amount, reason, responsible staff ID/name, and timestamp. Original sale and tender amounts, method, cash received, change, and receipt snapshots remain intact. Completed financial records cannot be deleted, so the destructive local demo reseed cannot replace an existing transaction after migration 020.

The schema supports local PostgreSQL or the intended hosted Supabase database; earlier deployment evidence names `barracksbarbers`. The configured connection string determines the actual target, and historical evidence does not establish its current migration state. The Next.js server connects through the database connection string and keeps authorization in the application session/role guards; no Supabase secret or database credential is sent to the browser.

Important database constraints include case-insensitive unique user email, explicit account lifecycle columns, valid role/status/category values, non-blank names, non-negative quantities and monetary values with two-decimal precision, commission bounds, customer/user uniqueness, foreign keys, and exclusion constraints preventing overlapping active barber/customer booking intervals, including pending approval requests. Inventory adds a case-insensitive unique SKU per branch (ignoring blank SKUs) and a maximum-stock check that tracks the minimum, suppliers add a case-insensitive unique active company name plus one account per supplier and per user, and restock requests enforce one line per item with a constrained status set.

`scripts/seed-admin.ts` creates the initial administrator from `INITIAL_ADMIN_*` variables and is safe to rerun for the same administrator email. `scripts/seed-demo.ts` is a local Sprint 2 seed: it runs in one transaction, preserves administrator accounts, and loads the current supplier, inventory, restock, customer, booking, and transaction showcase records. It succeeds on a fresh disposable database; a repeat run is rejected once finalized financial records exist, preserving their history. Do not run it against production data.

For an already seeded demo database, use `node --env-file=.env.local --import tsx scripts/refresh-demo.ts` from `barracks-wa/`, or `npm run db:refresh-demo` with the intended environment already exported. The command runs `refresh-demo.sql` and `working-demo.sql` in one transaction. Apply all current migrations first. It requires the original supplier-linked demo inventory, roster, services, and active administrator. With the current branch schema, the four named satellite branches must already exist; the script resolves their IDs but does not create the directory. See [the demo prerequisites](DEMO_README.md#refresh-an-existing-demo). Do not use a demo refresh against real operating data.

For a complete working demo across all five branches, run `node --env-file=.env.local --import tsx scripts/seed-working-app.ts` from `barracks-wa/` (or `npm run db:seed-working-app` with the intended database environment already exported). Apply all current migrations first, including the payroll foundation in 028. This additive command requires the original demo accounts, stock, and services, Main Branch plus the four named active satellite branches, and verified/unblocked demo Manager and Front Desk accounts assigned to all five. Missing prerequisites stop the run; it is not an empty-database installer. It expands satellite rosters to three demo barbers with shifts, fills the original product/supply catalog, adds eight clearly named walk-in profiles per branch, five weeks of paid walk-in history, today's completed/cancelled appointments, a week of upcoming reservations, attendance, and daily queues with completed visits awaiting checkout. Existing financial records, accounts, stock, attendance, and payroll are fingerprinted before writing and rechecked before commit; a mismatch rolls back the entire refresh. Stable fixture keys prevent duplicate visits, and reruns preserve staff progress.

The working-app seed configures missing demo payroll calendars at 35 Manila calendar days before the first run, confirms rates only for documented synthetic fixtures, and creates two closed-period examples per demo barber: an older Paid record and a newer Draft, Pending Approval, or Approved record. Current-period earnings remain available in the overview. Existing calendars and payroll records are not reset. Demo approvals use the assigned `demo.manager@barracks.app`; audit reasons say **DEMO ONLY**, and payment references begin `DEMO-ONLY-NO-FUNDS`. These paid examples represent fictional demonstration disbursements, not actual funds. Unmarked historical services remain unresolved. This command deliberately adds synthetic sales and payroll to reports and must only target an environment intended to contain demo data.

The additive refresh retains the branch stock/restock showcase (Bajada, Lanang, Bangkal, and Maa), moves only untouched overdue Ana/Paulo confirmations forward, and adds 12 accountless customer profiles. Shared operational data adds four weeks of varied completed, cancelled, and no-show appointments, matching cash/card/e-wallet receipts with cashier and historical timestamps, up to two conflict-free appointments per day for the coming week, and 14 days of attendance history. Today's queue has waiting, ready, in-progress, and completed-but-unpaid walk-ins; occupied or unavailable barbers leave new arrivals waiting. New paid visits increment barber service/revenue totals, and fresh seeds start those totals from actual seeded activity. Dates use Asia/Manila. Stable visit keys, profile phones, request references, and daily guards preserve existing records and prevent duplicate showcase additions on reruns. Refreshed appointments respect existing reservations, schedules, breaks, and unavailability. This command adds synthetic demonstration records and should only target a database intended to contain demo data; it does not initialize an empty database or reset staff progress.

## Authentication, validation, and authorization

Passwords are hashed with Node's `crypto.scrypt` using a random salt. The stored format includes the algorithm parameters, salt, and derived key. Login verifies the derived key with a timing-safe comparison. Plaintext passwords are never stored or returned.

Session behavior:

- The raw random session token is sent only in the HTTP-only `barracks_session` cookie.
- Only the token's SHA-256 hash is stored in `sessions`.
- Sessions expire after seven days.
- Production cookies are `secure`, use `sameSite: lax`, and are scoped to `/`.
- Logout deletes the database session and expires the cookie.
- A supplier changing their password signs out their other devices and keeps the current session.

Login and signup are throttled by `server/auth/auth-throttle.ts`, using counters in the `auth_attempts` table from migration 033 so all serverless instances share them. Emails and IP addresses are stored only as SHA-256 hashes.

| Action | Counted by | Limit |
| --- | --- | --- |
| Login | Account and IP address | 10 attempts in 15 minutes |
| Login | Account, from any address | 30 attempts in 15 minutes |
| Login | IP address | 100 attempts in 15 minutes |
| Signup | IP address | 10 attempts per hour |

A correct password clears that account's counters. The IP address comes from the first `x-forwarded-for` value, which the hosting proxy must set. If the counters cannot be read, for example before migration 033 is applied, login and signup stay available and the server logs the error.

Zod schemas live under `server/schemas/`:

- `user.schema.ts` validates login, staff account creation/update, and lifecycle actions.
- `sprint.schema.ts` validates barber, inventory, booking, customer signup, and customer profile input.
- `sprint2.schema.ts` validates supplier records, supplier accounts, inventory metadata/create/movement payloads, and restock create/status/receive payloads.

Schemas are strict, reject unknown fields, enforce bounds and enum values, and are applied before service/database work. `requireAdministrator`, `requireManagement`, `requireStaff`, `requireSupplierUser`, and `requireRoles` resolve the current session and return `401` or `403` responses before protected operations run. Account lifecycle changes use transactions and a PostgreSQL advisory lock to keep the last administrator rule safe under concurrent requests.

The browser does not send an admin token. Private credentials, database URLs, and seed passwords must remain server-only and must not use a `NEXT_PUBLIC_` prefix.

## Environment variables

The contract is documented in `barracks-wa/.env.example`:

```text
DATABASE_URL
DATABASE_SSL
DATABASE_SSL_CA
DATABASE_POOL_MAX
DATABASE_STATEMENT_TIMEOUT_MS
INITIAL_ADMIN_FIRST_NAME
INITIAL_ADMIN_LAST_NAME
INITIAL_ADMIN_EMAIL
INITIAL_ADMIN_PASSWORD
```

The environment is intentionally portable:

| Runtime | `DATABASE_URL` | `DATABASE_SSL` | Purpose |
| --- | --- | --- | --- |
| Local | Local PostgreSQL URL ending in `/barracks` | `false` | Local development and demo data |
| Vercel | Supabase transaction-pooler URL for the Barracks database, or integration-provided `POSTGRES_URL` | `true` | Hosted frontend and API routes |

For the Vercel runtime, add these server-only variables for the intended Supabase database. Apply authorized hosted migrations separately through a direct or session-pooler connection: the migration runner uses a session-level advisory lock and cannot safely use a transaction-pooler connection across migration transactions. See [running.md](running.md#optional-use-a-hosted-supabase-database) and the [Supabase connection guide](https://supabase.com/docs/guides/database/connecting-to-postgres). Demo seeds are not production initialization commands.

```text
DATABASE_URL=<Supabase transaction-pooler connection string>
DATABASE_SSL=true
DATABASE_SSL_CA=<Supabase CA certificate in PEM format>
DATABASE_POOL_MAX=3
```

`DATABASE_SSL` has three modes:

| Value | Behavior |
| --- | --- |
| `true` | Encrypts the connection and verifies the server certificate. |
| `no-verify` | Encrypts without verifying the certificate. Use only as a temporary fallback, because the connection could be intercepted. |
| Anything else | Does not use SSL. Intended for local PostgreSQL. |

Supabase uses a private certificate authority, so `true` also needs `DATABASE_SSL_CA`. Download the certificate from the SSL settings in the project's Supabase dashboard. The variable accepts the PEM text with real line breaks or `\n` escapes. Remove any `sslmode` parameter from the connection URL, because `pg` lets it replace these settings.

The pool stops waiting for a free connection after 10 seconds. Queries are limited to 30 seconds by default, or `DATABASE_STATEMENT_TIMEOUT_MS` if set. Supabase's transaction pooler ignores this limit and applies its own, which was 2 minutes when last checked. The migration runner turns the limit off for its own connection.

Keep `DATABASE_URL` and all `INITIAL_ADMIN_*` values out of `NEXT_PUBLIC_*` variables. The local `.env.local` and the Vercel environment variables are separate, so local PostgreSQL remains available as a fallback and for offline development.

### App responsiveness

A screen that fails to render or load shows a recovery message instead of a blank page: `app/components/ErrorBoundary.tsx` wraps each screen, and a failed workspace page keeps the sidebar so the user can navigate away. `app/global-error.tsx` covers failures in the root layout.

Workspace and account screens load their JavaScript on demand. Internal screen navigation updates browser history immediately through Next.js's History API integration; direct URLs and browser back/forward continue to select the matching screen. The app checks the session on startup and when returning to the tab, rather than on every screen change. An unauthorized API response triggers another session check, and backend routes continue to enforce current permissions.

The legacy `GET /api/reports/dashboard?branchId=...` summary remains available to administrators and managers within their branch permissions. The current management overview uses `/api/dashboard/management`, including its sales and actionable-restock aggregates. Business dates use Asia/Manila.

Concurrent identical GET requests share one network request. Cache keys include the full URL so branch-specific lists stay separate. Mutations, login/logout, authorization failures, and returning to the tab clear in-flight reads and the last-read screen snapshots. Requests and JSON bodies that finish after invalidation cannot restore an old snapshot. A refreshed session with a different account, role, or branch assignment clears cached data and remounts the workspace with the current access scope. Queue, booking, payment, stock, and dashboard responses are never retained by the reference cache.

The management dashboard uses `GET /api/dashboard/management`, restricted to administrators and managers. It returns aggregate metrics, low-stock rows, and five recent deliveries instead of downloading five full collections. Business dates use Asia/Manila, and dashboard responses are private and uncached.

Dashboard entrances take about 200ms without staggered delays. Landing reveals take about 260ms, respect reduced-motion preferences, and use one-time visibility observation instead of scroll-driven parallax calculations. Modals animate opacity and transforms without backdrop blur; sidebar resizing happens immediately rather than animating the entire page layout.

Vercel database pools default to three connections per instance unless `DATABASE_POOL_MAX` overrides this. Set the Vercel function region close to the hosted database region in Project Settings > Functions. Confirm both deployed regions before changing this setting; the repository does not assume a database location. These optimizations become live only after deployment.

The Next.js dev server loads `.env.local` automatically. The standalone migration and seed scripts do not, so export the file before running database commands:

```bash
set -a
source .env.local
set +a
```

Never commit `.env.local` or real credentials. Obsolete variables from the former separate-server setup—such as `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_ADMIN_API_TOKEN`, `ADMIN_API_TOKEN`, `CORS_ORIGIN`, and `PORT`—are not used by the current app.

## Dependencies and tooling

- Next.js `16.3.8` provides the App Router and Route Handlers; `package.json` and the lockfile are the version authorities.
- React `19.2.8` provides the client UI.
- `lucide-react` provides ready-made SVG icons across navigation, controls, forms, and the public landing page. The shared `Icon` component maps existing icon names to Lucide components, preserving sizing, colors, and accessibility props without an external icon API.
- TypeScript provides strict typing across app, server, and scripts.
- `pg` provides the PostgreSQL pool and queries.
- Zod provides request validation.
- `tsx` runs TypeScript database scripts.
- Tailwind's PostCSS integration is installed, but the UI is primarily authored in `app/globals.css`.

Useful commands from `barracks-wa/`:

```bash
npm run dev
npm run lint
npm run format
npm run format:check
npm test
npx tsc --noEmit
npm run build
npm run start
```

`.github/workflows/ci.yml` runs lint, the format check, `tsc`, the tests and the build on pull requests and pushes to `main`, using a throwaway PostgreSQL database.

Run Git commands, including `git diff --check`, from the repository root.

For Next.js-specific changes, read the repository guidance in `barracks-wa/AGENTS.md` and the matching installed guide under `barracks-wa/node_modules/next/dist/docs/` before editing routing, layouts, server/client boundaries, caching, or build configuration.

## Current limitations and next steps

The sprint backend is intentionally partial. The main remaining seams are:

- Settings still needs its own rendered screen. The Payments screen supports full checkout, paginated transaction history, printer-friendly saved receipts, manager/administrator full refunds and voids, and per-transaction audit history. The active Management Reports screen offers Sales & revenue and the existing Inventory reports. Sales reports use persisted transaction amount, service name, barber name, and payment method snapshots; they never use `barbers.revenue` or current catalog values. Gross sales and transaction count use the original checkout date; full refund and void amounts use their financial-action date. Pre-Phase-5 reversed rows without an action timestamp are attributed to their transaction date. Dates and daily grouping use Manila time. Net revenue is gross sales minus both reversal types and may be negative when prior-period sales are reversed. Group names reflect the snapshots saved at checkout, so renamed services or barbers retain their historical labels. Partial refunds, split tenders, discounts, loyalty, product checkout, and gateway workflows remain unimplemented. A refund/void records the financial reversal; it does not initiate an external processor transfer.
- Existing queue rows receive the current catalog price during migration 018 because their historical walk-in prices were never stored; their original prices cannot be reconstructed. New walk-ins snapshot the service name and price when queued, and appointment queue entries copy the booking's snapshots.
- Self-service forgotten-password recovery, email invitation delivery, MFA, rate limiting, and a general account-lifecycle audit trail are not implemented. Administrator password reset, management password changes, payroll audit events, stock movements, and financial-action history have separate implemented paths. Account deactivation is a soft delete; the account row is retained and its sessions are revoked.
- Dashboard and customer/barber summaries cover the sprint entities but do not yet form a complete reporting model.
- Inventory movements and restock receiving are transactional and auditable; broader stock-use workflows and concurrency coverage remain to be expanded.
- There is no payment processor, notification delivery, calendar sync, email confirmation, rate limiting, MFA, or observability layer.
- The repository has schema/UI/API tests and PostgreSQL integration tests. When tests are explicitly requested, run them only against the loopback disposable-database environment required by `tests/helpers/database.ts`, with TLS disabled and schema-creation privilege; never point the suite at a hosted shop database. Database cases without a configured connection are skipped. A browser automation test runner and visual regression suite are not configured, so the final browser smoke evidence is run manually against the local dev server.

The recommended evolution is incremental: add later tender, item, discount, and partial refund workflows, persist settings, and expand automated coverage, observability, rate limiting, and deployment documentation.

## Contribution rules

- Put reusable visual behavior in `app/components/ui` and shared workflows in `app/components/<domain>`.
- Keep shell and navigation behavior in `app/components/layout`.
- Put HTTP endpoints under `app/api` and server-only logic under `server`.
- Keep database queries out of client components and use `app/lib/api.ts` for same-origin requests.
- Add Zod schemas for new request payloads and keep business/database operations in services.
- Add a migration when the database shape changes.
- Preserve accessible labels, keyboard focus, dialog semantics, and text status cues.
- Use the existing neutral design language; do not reintroduce saturated decorative accents.
- Update this root README whenever code, configuration, dependencies, database, API, or architecture behavior changes.
- Follow `barracks-wa/AGENTS.md` for check policy. Tests require an explicit request; choose permitted non-test checks proportional to the change and report only checks actually performed. Do not infer browser or hosted verification from source review or a local build.

### Dashboard surface finish

Staff and Management workspaces (`.app-shell`) and the Customer Dashboard (`.customer-page--dashboard`) use the Barracks precision-grooming theme from the supplied brand board. Inter is the primary interface typeface, with Sora for dashboard display headings and the explicit fallback stack `Inter, Sora, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`. KPI metrics, prices, dates, timestamps, operational statistics, and table rows enable tabular lining figures (`lnum` + `tnum`) for consistent numeric alignment. Primary actions use Barracks red (`#dc2626`), information and links use cyan (`#0ea5e9`), and text uses cool white (`#e2e8f0`) over near-black (`#0b0d10`) surfaces. The dark dashboard follows a compact command-console style: a deep near-black workspace, visibly raised near-flat panels, crisp low-contrast borders, 6–7px corner radii, minimal shadows, a neutral active-navigation fill, and restrained red/cyan functional accents. The sidebar brand rail and sticky topbar share a 64px header line so their dividers align across the shell. Staff, management, and customer dashboards use short, simultaneous entrance animations with a soft deceleration curve plus restrained card, icon, arrow, and row hover responses; reduced-motion preferences collapse these effects to an effectively instant state. Existing content, components, and page structure remain unchanged. Light mode maps the same semantic palette onto off-white surfaces; the customer booking page uses the same customer dashboard tokens and panels, so no dark-only surface or low-contrast text remains. Reduced-transparency preferences remain supported.

Existing dashboard grids, workflows, and semantic status colors remain unchanged. Table rows stay flat for readability. Public landing/marketing styles are isolated in their own stylesheet modules.

The supplier portal shares the staff and management dashboard theme: the same dashboard typography, charcoal/glass panel hierarchy, 7px card treatment, red primary actions, semantic status colors, responsive spacing, and reduced-motion-safe entrance transitions. Its supplier profile, inventory, restock, delivery, and account-security workflows remain backed by the existing API routes.

### Shared navigation and layout polish

- **One topbar everywhere.** `app/components/layout/PortalTopbar.tsx` gives the customer and supplier portals the same topbar as the staff/management `AppShell` (logo, page links, theme toggle, account menu). `AccountMenu.tsx` is the shared account chip and popover (name, role, sign out) used by all three areas.
- **Branch picker in the page header.** `app/components/BranchSwitcher.tsx` is a compact "Branch" select that branch-scoped pages place in their `PageHeader` actions (Bookings, Payments/Transactions, Queue, Inventory, Restocks, Barbers, Barber Floor, Attendance, Payroll). `ReportBranchScope` now passes its picker to the Dashboards and Reports headers the same way. Switching branches still remounts the page content.
- **Shared `Pagination`** (`app/components/ui`) is used by the customer directory (12 per page), customer appointment history (5 per page), payroll records and the daily transactions modal.
- **Calendars.** The bookings day schedule shows status-colored blocks with a legend, half-hour guides and a current-time line. The transaction calendar shows daily totals and opens a day modal with a collected/count/average summary. The attendance week matrix shows labeled, colored cells instead of letter codes.
- **Customer pages.** The booking page uses the dashboard theme, with the branch selector in the page heading and a live summary panel. The dashboard pairs a fixed-height profile panel with a scrolling upcoming-appointments panel.
- **Login on mobile.** On small screens the brand panel collapses to a slim header so the sign-in card stays at the top.

## Migration and implementation history

The phase sections below record how the system evolved. Statements about what a phase added or deferred describe that milestone, not missing features in the current checkout. Use the current role/API sections above for today's behavior, and apply the complete migration sequence through 032 for a current installation. Historical verification results do not establish current local or hosted acceptance.

### Booking foundation (Phase 1)

Migration `009_services_booking_foundation.sql` adds service descriptions and integer durations, booking duration snapshots, expected end times, optional notes, and the statuses `confirmed`, `checked_in`, `in_progress`, `completed`, `cancelled`, and `no_show`. Existing `upcoming` bookings migrate to `confirmed`; their stored service names and prices remain unchanged. Unknown historical durations remain null. The service API exposes active services to customers, all services to front desk, and service creation/editing/enablement to managers and administrators. Scheduling, availability, booking lifecycle, queue persistence, the one-active-service guard, queue state integrity, and quick accountless queue customers are implemented in migrations 010–016. Migrations 017–020 add the payment backend foundation, integrity rules, cash checkout fields, and financial action history. Bookings and queue branch scoping is implemented in migration 024, transaction ownership in migration 025, and attendance ownership in migration 026. Inventory/restock branch ownership is implemented in migration 027; branch aggregates are implemented in Phase 7 and customer booking branch selection in Phase 8. Payment Phase 3 connects checkout UI to the payment backend; Phase 4 adds receipt printing and filtered, paginated history without another invoice table; Phase 5 adds full refunds and voids.

### Multi-branch foundation (Phase 1)

Migration `022_multi_branch_foundation.sql` adds `branches` and `user_branches`. The current shop is `Main Branch` (`MAIN`); existing non-deleted Managers and Front Desk accounts receive a primary Main Branch assignment. Administrators remain global and have no memberships. Customers and suppliers cannot be assigned. Memberships are unique per user/branch, and a partial unique index enforces at most one primary per user. Role changes out of Manager/Front Desk and account deletion remove memberships. New staff accounts require explicit assignment; membership does not change existing operational permissions.

Backend helpers in `server/auth/branch-access.ts` list accessible branches, check/require membership, and retrieve the primary branch. Later phases keep every branch-isolation helper in this one module: operational, customer, and report branch resolution, barber/inventory ownership locks, and the shared `BranchError` HTTP response. Dynamic route IDs are parsed by `server/schemas/route-id.ts`, which rejects values outside the PostgreSQL integer range. Administrators can access every existing branch; Managers and Front Desk can access assigned branches. Inactive branches retain their memberships; operational status enforcement is deferred. A user may have no primary, including after removing their primary assignment. Branch identity is independent of the existing inventory branch text labels. No operational data or behavior is scoped by these tables in Phase 1.

Branch APIs use existing HTTP-only sessions and server role guards: Administrator-only `GET/POST /api/branches` (list includes eligible staff), `PATCH /api/branches/:id` (details or `status: active/inactive`), `GET/POST /api/branches/:id/assignments`, and `DELETE/PATCH /api/branches/:id/assignments/:userId` (PATCH accepts `isPrimary: true`). Duplicate codes/memberships return 409. Primary changes run in a transaction with a user-row lock. `GET /api/branch-context` is available to staff and returns only accessible branches and a nullable primary. Shared `Branch`/`BranchAssignment`/`BranchContext` types and `resolveBranchSelection` provide the minimum future selector foundation; no global selector or operational branch filtering is enabled.

Administrators have a **Branches** navigation entry at `/admin/branches`, using the existing panels, buttons, forms, and modals. They can create/edit branch details, activate/deactivate branches, view assigned staff, assign/remove eligible staff, and set a primary branch. Managers cannot see or open this page; the APIs enforce the same restriction independently.

The Branches workspace uses padded cards with separate address and phone details, aligned status badges, and a divided action area. Cards form two columns on wide screens and a single column on smaller screens; mobile actions wrap with larger touch targets. The staff assignment dialog separates each member's details from their actions. Styling supports the existing light and dark themes without changing branch operations or permissions.


### Multi-branch barbers and scheduling (Phase 2)

Migration `023_branch_barbers_and_hours.sql` gives barbers required branch ownership and replaces global operating-hour uniqueness with `(branch_id, day_of_week)`. Existing barbers and hours belong to Main Branch; existing shifts, breaks and absences are preserved. Existing and newly created branches receive seven default days (09:00–19:30). Legacy SQL imports/demo seeds without barber ownership receive Main Branch through a database default; barber creation/editing APIs require a valid explicit `branchId`.

The existing Barber Management and Barber Floor pages use `/api/branch-context` and the Phase 1 selection helper. Administrators can select any branch; Managers and Front Desk can select assigned branches only. Switching branches reloads the roster and operating hours, clears open editor state, and ignores obsolete load responses. Roster revenue and completed service counts are calculated from branch-owned transactions, bookings, and walk-ins; portable lifetime barber counters are retained but are not presented as branch metrics. Managers can create and edit barber profiles and schedules, but commission and rating controls are Administrator-only and the Manager API schema rejects those fields. Front Desk retains only operational barber visibility/status access and gains no schedule management. Barber lists accept `branchId`, and every staff barber ID read/update and schedule/absence operation checks actual barber ownership on the backend. Authorization and ID operations share a transaction and barber row lock, preventing ownership changes between the check and operation. Moves are blocked while a current Manila-day clock-in remains open. The bulk commission endpoint is now retired in favor of Payroll settings; barber deletion remains Administrator-only.

The Barber schedules panel insets its Weekly shifts / Shop hours tabs to align with the schedule content, with narrower spacing on mobile.

`/api/shop-hours?branchId=...` reads or updates the selected branch's hours, with staff branch access enforced on the backend and management required for updates. Phase 8 allows customers to read hours for an active selected branch, defaulting to Main Branch when omitted. New barber schedules copy only their owning branch's seven days. Working shifts must fit that branch's hours. Changing hours preserves existing shifts; availability intersects the shift with the barber's branch hours. Shared availability helpers resolve barber → branch → hours, including Any Available Barber calculations. Each availability calculation caches hours by branch, avoiding repeated reads for barbers sharing a branch.

Barber moves require access to both source and destination. The database rejects a move while confirmed/checked-in/in-progress bookings or waiting/ready/in-progress queue entries remain, or when existing working shifts do not fit the destination hours. Accepted moves preserve shifts, breaks and absences, and historical references. Phase 2 adds no branch columns or branch filtering to bookings, queue entries, transactions/payments, attendance, inventory, restocks, reports, customer booking flow, or aggregate dashboards. Apply migration 023 through the existing migration runner before using Phase 2; verification uses disposable test schemas and does not migrate the real shop database.


### Multi-branch bookings and queue (Phase 3)

Migration `024_booking_queue_branches.sql` adds required branch foreign keys and branch/date or branch/status/FIFO indexes to bookings and queue entries. Every existing record is backfilled to Main Branch without changing snapshots, lifecycle states or history. Legacy SQL imports default to Main Branch. Visit ownership stays fixed; database triggers serialize barber assignment against barber moves and reject cross-branch assignments. Historical barber references remain valid after permitted moves.

Bookings and Queue now have staff branch selectors using the existing branch context. Switching branches remounts their workspace, clears editors/suggestions, and reloads scoped bookings, active/completed queue and barber choices. Barber Floor queue reads use its selected branch. APIs accept `?branchId=...` for collections, booking creation, walk-ins, availability and next-customer suggestions/confirmation. Missing selection resolves the staff primary/first accessible branch. Managers and Front Desk may access assigned branches only; Administrators may select any branch. ID mutations authorize the record's persisted ownership, preserving existing role/action permissions. Front Desk, Manager, and Administrator can perform authorized booking and queue operations; Managers remain limited to assigned branches.

New bookings store the authorized branch, edits retain it, and check-in creates an appointment queue entry with the booking's branch. Walk-ins store their authorized branch; next-customer selection scans only that branch while retaining appointment/ready priority, FIFO, availability checks, locking, idempotency and lifecycle constraints. Availability and Any Available Barber consider only the selected branch and use Phase 2 operating hours and schedules. Phase 8 extends customer booking creation, availability and barber choices to an active selected branch.

Phase 3 deferred payment/transaction ownership, attendance ownership, inventory/restock branch support and branch reports/dashboard aggregates. Payment/transaction ownership is implemented by Phase 4 below. Apply migration 024 with the existing migration runner before using this phase; implementation verification uses disposable schemas and does not migrate the shop database.

### Multi-branch transactions and payments (Phase 4)

Migration `025_transaction_branches.sql` adds required branch ownership to `transactions`, a restricted branch foreign key, and a branch/creation-time index for payment history. Existing sales are backfilled to Main Branch without changing receipt snapshots, tenders, timestamps, refund/void status or financial audit entries. Inside the migration runner's transaction, the migration temporarily disables the finalized transaction guard and transaction/action consistency trigger for the branch-only backfill, drains the remaining deferred checks, and restores both guards before commit. This preserves older reversed payments that predate the audit table without fabricating audit entries. If an existing transaction already references a non-Main visit, migration stops with its transaction IDs for review rather than assigning conflicting ownership or rewriting financial history.

New checkout stores the locked booking or walk-in queue entry's branch; client branch input never determines sale ownership. Database triggers reject disagreement with linked bookings/queue entries and prevent ownership changes. Nullable visit links may still clear under existing foreign-key deletion behavior while the financial record retains its branch. `transaction_payments` and `transaction_financial_actions` inherit branch ownership through their required transaction links, so no duplicate branch fields are added to tenders or audit entries.

The payment implementation actually present on this branch includes cash/non-cash checkout, saved receipts, paginated history and full refunds/voids. Phase 4 scopes these existing features without adding payment functionality. Checkout and financial actions check the actor's persisted role and branch membership inside their existing transaction. Managers/Front Desk can process only assigned branches within their existing role permissions; checkout API/UI is available to all three staff roles, and refund/void API/UI remains management. Administrators retain global financial access. Transaction GET accepts `branchId` for eligible visits, history and saved receipt lookup. With no branch filter, Administrators see global history and assigned staff see only their accessible branches. Unauthorized reference lookups return 404; explicitly requesting an unauthorized branch returns 403.

The existing payment screen uses branch context and remounts its workspace on selection changes, clearing old checkout drafts, receipts and financial-action forms. Eligible visits, paginated history and receipt reads follow the selected branch. Phase 4 defers attendance to Phase 5 below; inventory/restock ownership, branch report/dashboard aggregates and customer branch selection are implemented by Phases 6–8 below. Apply migration 025 before using Phase 4; automated database verification uses disposable schemas, not the shop database.


### Multi-branch attendance (Phase 5)

Attendance filters align the Date, Barber, and Status controls with the Today and All dates buttons along their bottom edge. The date shortcuts stay together as the toolbar wraps, and share a row with larger touch targets on mobile.

Migration `026_attendance_branches.sql` adds required attendance branch ownership, a restricted branch FK and a branch/date/barber index. All legacy attendance is backfilled to Main Branch, including records whose barber has since moved. Legacy records contain no branch-at-creation or barber-move history, so their original branch cannot always be reconstructed; Main Branch is the agreed historical fallback. Existing attendance values, timestamps and correction entries are preserved.

New records snapshot the barber's current branch on the server and in an insert trigger. Client ownership is rejected, and staff creation requires access to that branch. Stored branch and barber ownership are immutable. There is deliberately no constraint tying historical attendance to the barber's current branch: a subsequent move leaves attendance and correction history under the original branch. Daily updates and management corrections authorize the stored branch and do not rewrite ownership. One record per barber per Manila calendar day, existing clock rules, append-only corrections and the barber-no-login design remain unchanged. A same-day move does not create a second attendance record in the destination branch.

Today's attendance, history and correction reads are scoped to accessible branches, with optional `branchId` narrowing. Administrators have global access; Managers and Front Desk are assigned-only. Existing role permissions are retained: Front Desk uses daily attendance on Barber Floor, while management reviews history and corrections. Explicit unauthorized branch requests return 403; unauthorized correction lookups return an empty list. Writes check persisted staff authorization inside the transaction.

Attendance Management uses the existing branch context and resets its records, filters and correction dialog when branches change. Barber Floor reads and updates today's attendance for its selected branch. Historical filters include barbers represented in the loaded records even after they move. Apply migration 026 with the existing migration runner before using Phase 5. Verification uses disposable schemas and does not migrate the shop database.



### Multi-branch inventory and restocks (Phase 6)

Migration `027_inventory_restock_branches.sql` adds required, restricted branch foreign keys to inventory stock rows, inventory movements and restock headers. Legacy labels matching exactly one existing branch name/code are mapped to it; unknown/ambiguous ownership falls back to Main Branch. Existing records, quantities, timestamps and text snapshots are preserved. Stock ownership cannot change: the same product/SKU can have a separate stock row in each branch, and SKU uniqueness is now case-insensitive within a branch. No transfers are introduced.

New movements snapshot the persisted item's branch, including CUSTOMER_PURCHASE, and cannot change ownership. Restock lines inherit their immutable header branch without another branch column; the database rejects new cross-branch lines. Receiving locks the request and stock, validates every line and changes only the request branch's inventory. Suppliers and supplier accounts remain global; the supplier portal continues to see only its linked supplier's items and requests across branches.

Inventory/restock collection APIs use `?branchId=...` and default to the staff primary/first accessible branch. ID operations authorize persisted ownership and reject a mismatched selected branch. Existing role permissions remain: Administrator/Manager operate inventory/restocks and may delete or archive inventory items, while Front Desk has no inventory permission. Inventory, movement/threshold history, low-stock alerts and receiving enforce branch authorization. Inventory and Restock pages use the existing context, reload on selection, discard forms/dialogs/selections and ignore responses from the old workspace. The shell's inventory alerts use the selected authorized branch and discard late results from a branch that is no longer selected. Phase 6 inventory report reads are restricted to authorized ownership; branch report/dashboard aggregates are implemented by Phase 7 below.

Apply migration 027 using `npm run db:migrate` before using Phase 6. Tests use disposable PostgreSQL schemas and do not migrate the shop database. Phase 7 implements branch revenue/report and dashboard aggregates below; Phase 8 implements customer-facing branch selection below; inventory transfers remain deferred.



### Multi-branch reports and dashboard aggregates (Phase 7)

The Sales & revenue period filter aligns with the report content and keeps its date controls and Manila-time explanation inside a padded panel. On small screens the controls wrap and the Apply period button spans the panel width. Report-type buttons have separate spacing above the report heading.

Management sales and inventory reports and both staff dashboards use the existing branch context. Administrator reports and the management dashboard default to **All branches (global)** and can select one branch. Managers and Front Desk select only assigned branches. Changing branches remounts the workspace, resets report periods/type and clears displayed data; superseded requests cannot populate the new workspace or show late error toasts. Front Desk retains its booking/queue/barber dashboard permissions and has no financial or inventory reporting access.

`GET /api/reports/revenue`, `GET /api/reports/inventory`, and `GET /api/reports/dashboard` accept `branchId=<positive id>` or Administrator-only `branchId=all`. A missing selection aggregates the actor's accessible branches, including inactive ones; an unassigned Manager gets zero totals. The shared server resolver validates selections and rejects unauthorized branches/global requests with 403. All three services also enforce management roles and scope before querying aggregates.

Revenue uses the immutable transaction branch snapshot for sales and related financial actions. Gross sales count completed sales, including sales later refunded/voided; reversals count the action ledger, and net revenue equals gross minus reversals. The legacy reversal fallback runs only where no action exists. Checkout and reversal dates retain the existing inclusive Manila-local date rules. Service/barber/payment breakdowns use saved transaction names/methods. Tender rows, cash received/change and `barbers.revenue` do not supply revenue totals.

Inventory valuation and stock counts use item ownership; movement totals use movement ownership, grouped by item and numeric branch. Legacy movements retain their own branch even when it differs from the item's branch; those rows show historical stock status without exposing another branch's current quantity/threshold. Supplier spending and received-delivery counts follow restock header ownership, including preserved legacy lines. Shared suppliers are grouped once and each delivery is counted once. Spending uses immutable restock line cost; if any delivered line cost is unknown, supplier spend is reported as unknown. Current stock valuation remains independent of report dates; movement/spending dates retain their existing range behavior.

The management dashboard aggregates existing inventory value, low stock, open restocks, today's/upcoming bookings, active barber roster and recent deliveries directly in PostgreSQL. Booking counts use booking snapshots, while current roster counts use barber ownership. The customer count is labeled **Customers with visits**: customers have no branch column, so it counts distinct customers referenced by bookings or queue records in the selected branches. A customer with visits in two branches counts once globally. Front Desk requests existing branch-scoped booking, queue and barber endpoints. No existing report/dashboard attendance metric is present, so attendance screens and metrics remain unchanged.



### Customer branch selection and bookings (Phase 8)

Customers choose an active branch on the existing booking screen. `GET /api/customer-branches` is customer-only and exposes branch ID/name/code/address/phone without staff assignments or staff branch context. The selection is remembered per customer in browser session storage and checked against the latest active list when the booking page opens. With no valid remembered choice, Main Branch is selected if active; otherwise the customer must choose an active branch. An inactive or missing Main Branch never silently becomes a booking destination.

Customer reads of `/api/barbers`, `/api/services`, `/api/shop-hours`, `/api/bookings/availability`, and creation through `/api/bookings` carry `?branchId=...`. The backend validates branch syntax, existence and active status; omitted selection resolves Main Branch safely. Branch Management cannot change the reserved `MAIN` code. Services remain the existing shared active catalog: there is no branch service restriction model in the current schema. Availability and Any Available Barber use only the selected branch's roster, operating days/hours, shifts, absences and booking conflicts. Creation revalidates availability, resolves the authenticated customer's profile, stores the validated branch, and locks an active branch at the insert. Existing migration 024 continues to enforce barber/booking branch agreement and immutable booking ownership.

Switching the booking branch remounts the form, clears barber/date/time, service and notes drafts, and discards availability results. Obsolete branch roster/service/hour responses and availability responses cannot populate the new form. The reservation summary shows branch/address and the selected day's operating hours in Asia/Manila. Confirmation and upcoming/historical appointment cards show the booking's saved branch. Customer booking history includes all of that customer's branches; editing loads barber/service choices and availability for the appointment's persisted branch regardless of the remembered new-booking selection. Rescheduling is rejected if that persisted branch becomes inactive; cancellation and history remain available.


Migration `009_services_booking_foundation.sql` adds service descriptions and integer durations, booking duration snapshots, expected end times, optional notes, and the statuses `confirmed`, `checked_in`, `in_progress`, `completed`, `cancelled`, and `no_show`. Existing `upcoming` bookings migrate to `confirmed`; their stored service names and prices remain unchanged. Unknown historical durations remain null. The service API exposes active services to customers, all services to front desk, and service creation/editing/enablement to managers and administrators. Scheduling, availability, booking lifecycle, queue persistence, the one-active-service guard, queue state integrity, and quick accountless queue customers are implemented in migrations 010–016. Migrations 017–020 add the payment backend foundation, integrity rules, cash checkout fields, and financial action history. Branches are implemented by migrations 022–027; notification delivery remains deferred. Payment Phase 3 connects checkout UI to the payment backend; Phase 4 adds receipt printing and filtered, paginated history without another invoice table; Phase 5 adds full refunds and voids.

## Task-focused operational layout phase

Local implementation is tracked in [plan.md](plan.md), with the data map and browser captures in [evidence/layout-redesign/implementation.md](evidence/layout-redesign/implementation.md). Bookings provides a desktop day schedule and mobile agenda, using stored appointment durations and existing detail/actions. `GET /api/scheduling/day?date=YYYY-MM-DD` is an additive staff-only, read-only projection of weekly shifts, breaks, time away, and shop-hours context; it does not return bookable slots or grant schedule editing. The existing BookingForm availability API remains authoritative. Duplicate shop-hour weekdays are reported as unavailable context, preserving the server configuration guard. Navigation groups existing destinations into Business, People, and Stock; breadcrumbs reflect the active module. Operational freshness timestamps record successful loads, while refresh errors remain visible.

The payment workspace pairs searchable completed unpaid visits with checkout and an explicit confirmation showing visit identity, total, tender and cash change. Eligibility reloads after payment. Transaction history is a month calendar with daily counts in Manila time. Selecting a date opens a modal with that day's transactions, paginated in groups of 20; customer/reference and payment-method filters apply to counts and records. The calendar loads every history page for the selected month so daily counts include all matching transactions. Saved receipt, audit events and permission-guarded refund/void controls open in a detail drawer. The existing transaction endpoints, pricing and duplicate-payment guards are unchanged.

The management overview defines four primary metrics over the last seven Manila calendar days, including today, within the selected branch scope: paid sales (gross saved sales), refunds plus voids (dated financial events), net sales (gross less reversals, not profit), and paid visits (sale transaction count). `GET /api/dashboard/management` preserves its existing fields and adds `sales` (the existing RevenueReport contract), `salesError`, `scope`, `generatedAt`, and `actionableRestocks`. It reuses `getRevenueReport` and its legacy-reversal semantics. The daily table distinguishes sales, refunds, voids and net; sales failures display unavailable values separately. Stock exceptions carry their branch; inventory value is supporting context. Booking counts include accountless customer profiles and exclude deleted linked accounts. Active roster excludes manual unavailable status and is never described as on duty.

On desktop, the Needs attention panel matches the Sales by day panel's height. Its heading stays visible while overflowing entries scroll inside a keyboard-focusable list. At widths of 1000px or less, the panels stack and the attention list scrolls within a limit of 32rem or 70% of the viewport height, whichever is smaller.

The same treatment applies to completed unpaid visits beside Checkout, customer upcoming appointments beside Your profile, stock exceptions beside Supplier spending, and Net revenue by barber beside Net revenue by service. List content and expanded report breakdowns scroll within the matching panel while headings and checkout search controls remain visible. At each layout's stacking breakpoint, list panels return to content-based sizing with the same bounded scroll area. Existing report preview limits and full breakdowns remain available.

Operational screen and panel headings omit repeated introductions and decorative catalog labels. Dates, branch scope, access restrictions, financial definitions, attendance legends, and actionable empty/error guidance remain visible. Revenue breakdown titles explicitly identify net revenue; payment-method totals remain labeled as gross sales.

Weekly barber schedules use a timeline with one selected-day editor; shop hours have a separate tab. Existing validation and schedule/time-away mutation endpoints are preserved. Attendance offers a desktop weekly matrix (Monday–Sunday) and a daily/list view for mobile. `GET /api/attendance/history` adds optional `dateFrom` and `dateTo` filters while preserving date/barber/status fields and the attendance response. Recorded Present/Late/Absent always wins; missing records show Unmarked, future dates show Future, and scheduled-off/full-day time-away labels require authoritative schedule context. Partial-day time away does not imply an attendance status. The correction drawer keeps reason validation and saved before/after history.

Restocks use a compact request list with stage filters: All active, Ready to receive (`Delivered`), In transit (`Shipped`), and With supplier (`Pending`, `Accepted`, `Preparing`). These are view filters, not new states. Delivered requests appear first, followed by shipped requests. Each row keeps supplier, reference, branch, request date, items, status, and next action together; rows stack with visible labels on mobile. Received and Cancelled history is separately searchable. There is no Rejected status in the current backend. Existing receiving confirmation and transactional inventory updates remain intact; explicit delivery confirmation precedes the existing Shipped-to-Delivered action.


Manual demo walkthroughs verified saved checkout/receipt, a schedule edit and restoration, attendance correction and restoration with both audit entries, exact exception links, and receiving demo request #35 (18 bottles; Maa disinfectant stock24). The weekly attendance status filter selects barbers with a matching record, then retains all weekly records for those barbers in both the matrix and mobile list. The count represents those displayed records. Receipt references wrap on mobile; confirmation modals appear above detail drawers and own keyboard focus while open.

Phase verification completed using a user-selected isolated local demo: existing migrations and seed on PostgreSQL17 at127.0.0.1:55432, with a separate built app on http://localhost:3001. Booking create/edit/check-in/start/completion/cancellation and historical overlap/unknown-duration rendering were exercised there. Unassigned bookings are unsupported by the current model. The original demo instance retains its duplicate weekday409; its configuration was not changed. Local configuration and restart commands are in [evidence/layout-redesign/local-demo.md](evidence/layout-redesign/local-demo.md). TypeScript, targeted ESLint and the production build passed; no automated tests, production migrations or deployment were run. Browser screenshots and exact limitations are in the evidence document.

An isolated database-outage walkthrough confirmed refresh errors and unavailable states across the changed operational modules. Front Desk metrics show dashes while their source load fails. The local database was restarted and the healthy overview was verified before delivery.

Attendance toolbar search, week navigation, and filter controls share a 42px height and align along their bottom edge beneath the field labels. Controls retain their stacked layout on mobile.

The attendance matrix displays seven dates at a time. Previous/next week controls and the Week containing date picker select a complete Monday–Sunday range, including weeks that cross month or year boundaries; the mobile list uses the same range.

The daily transaction modal expands to 1200px on desktop and uses the available viewport height. Transaction rows wrap within the modal on mobile; receipt details close the daily modal before opening the existing receipt drawer.

Restock search, status filter, and reset controls share a 42px height and bottom alignment. Search still matches supplier, branch, item, and request information; controls stack at mobile widths.

The layout redesign preserves the existing multi-branch permissions and selectors. Management sales and stock summaries use the selected accessible scope, and exception links select the authorized request or inventory branch. Weekly attendance includes historical records for barbers who have since moved. The day schedule and calendar queries remain branch-scoped; duplicate weekday shop hours are rejected within the selected branch.


## Release and database safeguards

Migrations 029–031 add internal database access controls, immutable visit-duration snapshots, and booking overlap protection across midnight. Migration 032 adds pending/rejected booking approval states and protects pending slot reservations. Database integration tests must use a loopback disposable database with TLS disabled. Local tests and builds do not establish production readiness; hosted behavior, deployment, and restore evidence require separate verification. Follow [local setup](running.md) before running the app or database commands.

Migration 033 adds the `auth_attempts` table behind login and signup throttling.

## Operational data loading

The barber list evaluates current availability with one batched database read and a shared Manila clock, rather than repeating attendance, hours, shifts, breaks, and time-away queries for every barber. Both list reads and locked start transactions use the same availability evaluator; start-time reservation and locking guards remain authoritative. The day schedule similarly batches all barber shifts and time away, while reading branch hours in parallel.

Development route bundles and reloads share one PostgreSQL pool. Branch membership and access checks use direct filtered queries. Management dashboards resolve authorized branch IDs once for their overview and revenue queries. Administrator global dashboards begin fetching without waiting for the branch picker, and refreshes retain their previous values with the existing freshness indicator. Customer lists render independently of preferred-barber options. The picker uses the authorized `/api/barbers?view=options` response, which omits financial summaries and operational checks. Customer lists reuse reference data for up to 15 seconds; mutations and authorization failures invalidate that cache. Operational queue, booking, payment, stock, and availability responses are not cached across completed requests.

## Sprint scheduling safeguards


Migration `031_booking_midnight_overlap.sql` corrects reservation checks against active services to use the saved booking duration and dated start, matching the existing exclusion constraints. Operational starts and bookable slots use the same dated ranges, including reservations continuing from the previous day; a midnight-wrapped `end_time` cannot hide a conflict. Intervals remain half-open, so exact back-to-back work is allowed. Unknown historical booking durations still block their entire day; unresolved walk-in durations still fail closed. Hours, attendance and permissions are unchanged. Migration 031 must be explicitly authorized and applied before hosted acceptance of this fix.

Time-sensitive lifecycle tests use an opt-in clock in their disposable schema, anchored during supported hours and advancing with elapsed real time. The same fixture pins the JavaScript `Date` clock to that instant for the duration of the test, so service-side checks (booking window, past slots, Manila "today") agree with the database and the tests do not drift as real time passes. Controlled late-night fixtures cover lock contention and midnight boundaries without changing the production clock or relaxing scheduling rules. Payment-history tests locate the search by its accessible label and exercise search, method, month, day and pagination.

## Usability feedback round (October 2026)

Changes made from the user-acceptance feedback sheet:

- Customer bookings now need staff approval (pending → confirm/reject in one click), and staff can remove closed bookings so cancelled slots no longer clutter the schedule.
- Booking calendar preloads the month, greys out unavailable dates and times with the reason, limits bookings to 90 days ahead, refreshes live, and explains why a booking failed.
- Times display in 12-hour format; customer appointments are sorted soonest first.
- Managers and administrators reach every module from one sidebar and can create, confirm, reject and run bookings and the queue.
- Deactivated supplier accounts can no longer sign in. Email addresses and contact numbers use one shared rule set (`app/utils/contact-validation.ts`) in forms and APIs: ASCII email only (no emoji or punycode) and Philippine contact numbers (11-digit `09…` mobile or 7–10 digit landline).
- Inventory: stock can be corrected from Edit item, adjustments are entered as the actual count with a before/after preview, items can be deleted (or archived when they have history), and suppliers can be assigned their items. Changing or removing an item's supplier is blocked with HTTP 409 while it would strand an open restock, through both inventory editing and supplier item assignment. Restock creation and supplier reassignment lock affected items in ID order. The supplied-items dialog enables saving only after inventory loads for the selected supplier and branch, and locks its branch and item selection while saving. Restock requests can be marked arrived from any open stage and cancelled by staff.
- Receipts print on a single page from a body-level print copy.
- Screens show layout-shaped skeletons while loading (`app/components/ui/Skeletons.tsx`), and the API client keeps the last successful read per path (`peekApiBody`) so revisited screens paint immediately and refresh in the background. The cache is cleared on sign-in, sign-out and expired sessions.
- Fonts, type scale, primary buttons and section spacing are unified across dark and light themes, and in-app instructions point to the screen or button that performs them.

Automated tests were updated for this round: booking fixtures stay inside the 90-day window of the pinned test clock, permission and navigation tests reflect the unified management sidebar and staff booking removal, and the customer booking UI tests exercise the month calendar and time chips.

