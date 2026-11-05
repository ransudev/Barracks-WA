# Run Barracks locally

This guide matches the current repository. Run app and database commands from `barracks-wa/`; run Git commands from the repository root.

## What you need

- Node.js `20.9.0` or newer, as required by the installed Next.js package: [nodejs.org](https://nodejs.org/).
- A running PostgreSQL server and its command-line tools: [postgresql.org/download](https://www.postgresql.org/download/).
- This project folder, including `barracks-wa/package-lock.json`.

## 1. Open the app folder

On Windows, open **PowerShell** and adjust the path for your computer:

```powershell
cd "C:\Users\your-name\Documents\Barracks-WA-sprint-2\barracks-wa"
Get-ChildItem
```

On macOS or Linux:

```bash
cd "/path/to/Barracks-WA-sprint-2/barracks-wa"
ls
```

You should see `package.json`, `package-lock.json`, and `.env.example`. Check the tools:

```bash
node --version
psql --version
```

## 2. Start PostgreSQL and create a database

Start the PostgreSQL service before using login or database-backed screens. On Windows, start the installed PostgreSQL service from **Services**, then use pgAdmin to create a database named `barracks`, or run:

```powershell
createdb -U postgres barracks
```

On macOS, start your installed PostgreSQL app or the matching Homebrew service shown by `brew services list`, then create the database with the correct PostgreSQL user:

```bash
createdb -U postgres barracks
```

If your installation uses a different database role, replace `postgres` here and in the connection string below. Create the database once; do not recreate a database containing records you need.

## 3. Install the app packages

```bash
npm ci
```

This installs the versions recorded in the lockfile. Repeat it after pulling changes that update dependencies.

## 4. Create the local settings file

On Windows PowerShell:

```powershell
Copy-Item .env.example .env.local
```

On macOS or Linux:

```bash
cp .env.example .env.local
```

Copy only if `.env.local` does not already exist; keep your existing settings when updating the repository. Edit the file to match your PostgreSQL username, password, port, and database:

```text
DATABASE_URL=postgres://postgres:postgres@localhost:5432/barracks
DATABASE_SSL=false
DATABASE_POOL_MAX=10

INITIAL_ADMIN_FIRST_NAME=Admin
INITIAL_ADMIN_LAST_NAME=User
INITIAL_ADMIN_EMAIL=admin@example.com
INITIAL_ADMIN_PASSWORD=choose-a-long-random-password
```

The database password in this example is a placeholder, not a password that Barracks sets. Change `INITIAL_ADMIN_PASSWORD` before creating the administrator. Keep environment files and connection strings private. URL-encode reserved characters in the database username/password when putting them in a connection URL.

Next.js reads `.env.local` automatically. The database npm scripts do not. The commands below use Node's `--env-file` option so they work in PowerShell, macOS, and Linux without shell-specific environment loading. Variables already set in the command window take precedence over the file; check that they target the intended database.

## 5. Apply migrations and create the administrator

Run these one at a time from `barracks-wa/`:

```bash
node --env-file=.env.local --import tsx scripts/db-migrate.ts
node --env-file=.env.local --import tsx scripts/seed-admin.ts
```

These are the environment-file equivalents of `npm run db:migrate` and `npm run db:seed-admin`. The npm commands also work when the intended variables are already exported in the current shell.

The migration runner applies missing files in order, records them in `schema_migrations`, and skips files already applied. The current files run from `001_user_management.sql` through `032_booking_approval.sql`, including branch ownership, payroll, database access controls, saved visit durations, midnight overlap protection, and booking approval. Let the runner complete before starting the app against an older database. Do not manually mark a failed migration as applied.

The administrator seed creates the account configured by `INITIAL_ADMIN_*`. Rerunning it for an existing administrator does not reset that account's password. To reset it deliberately, change `INITIAL_ADMIN_PASSWORD` and run:

```bash
node --env-file=.env.local --import tsx scripts/reset-admin-password.ts
```

This updates the account identified by `INITIAL_ADMIN_EMAIL` and revokes its sessions.

## 6. Choose whether to add demo data

Skip this section for a database intended to hold real shop records. An administrator-only database can be used to set up branches, staff assignments, services, and barbers through the app.

For a **fresh disposable local demo database only**, initialize the showcase:

```bash
node --env-file=.env.local --import tsx scripts/seed-demo.ts
```

This is `npm run db:seed-demo` with `.env.local` loaded. It attempts to replace non-administrator business data, including users, customers, bookings, stock, and restocks. Finalized financial and attendance records can prevent reseeding; a failure rolls back the transaction. Do not rerun it as an update step for populated databases.

For an **existing demo database**, the additive refresh command is:

```bash
node --env-file=.env.local --import tsx scripts/refresh-demo.ts
```

This is `npm run db:refresh-demo`. It expects the original demo accounts, roster, services, supplier-linked stock, and, with the current branch schema, the four named satellite branches to exist. It adds demonstration activity and can move untouched overdue fixture appointments; it does not initialize an empty database or reset account passwords.

For the fuller five-branch activity and payroll showcase, use `npm run db:seed-working-app`, or:

```bash
node --env-file=.env.local --import tsx scripts/seed-working-app.ts
```

This also requires Main Branch plus `Barracks Bajada HQ`, `Barracks Lanang HQ`, `Barracks Bangkal HQ`, and `Barracks Maa HQ`, and verified, unblocked demo Manager and Front Desk accounts assigned to all five branches. The script stops when prerequisites are missing. It preserves existing records through fingerprint checks and adds synthetic sales and payroll marked **DEMO ONLY**; it does not transfer funds. See [the demo guide](DEMO_README.md) for prerequisites, accounts, and walkthroughs.

## 7. Start Barracks and sign in

```bash
npm run dev
```

When the server is ready, open [http://localhost:3000](http://localhost:3000). Sign in using `INITIAL_ADMIN_EMAIL` and `INITIAL_ADMIN_PASSWORD`. Keep the terminal open; stop the server with `Ctrl+C`.

If you seeded a demo, its account identifiers end in `@barracks.app`, not `@barracks.local`. See [DEMO_README.md](DEMO_README.md) for the seeded credentials. They apply only when that seed was used and those accounts have not since been changed.

Administrators and Managers have one sidebar covering their permitted management and daily operational modules. Front Desk has its own operational sidebar. There is no workspace switcher. New Manager and Front Desk accounts need explicit branch assignments; if a seeded or newly created staff account shows **No branch assigned**, sign in as Administrator, open **Branches**, and assign it to the intended branch. New staff accounts also require verification before login.

Customer booking requests start as **Awaiting approval**. An authorized staff user must confirm the request in **Bookings** before check-in and service.

## Updating an existing local checkout

Run Git commands from the repository root. Inspect `git status` and preserve local work before changing branches or pulling. After updating the intended branch:

1. Run `npm ci` from `barracks-wa/` if dependencies changed.
2. Keep your existing `.env.local` and confirm its database target.
3. Stop the local app, apply missing migrations with the command in step 5, then restart it.
4. Do not rerun `db:seed-demo` to update existing business data. Demo refresh commands are optional and only for databases intended to contain synthetic records.

## Optional: use a hosted Supabase database

Barracks uses PostgreSQL through the Next.js server and the application's own users/sessions. It does not require Supabase Auth, a browser Supabase client, or public API keys.

Copy connection details from **Connect** in the intended project's Supabase dashboard. Earlier Barracks activation evidence names `barracksbarbers`; the connection URL selects the actual target, so verify it rather than copying a project name from old notes.

For a serverless app runtime such as Vercel, use the intended project's transaction-pooler URL and server-only variables:

```text
DATABASE_URL=<the intended project's transaction-pooler URL>
DATABASE_SSL=true
DATABASE_SSL_CA=<Supabase CA certificate in PEM format>
DATABASE_POOL_MAX=3
```

`DATABASE_SSL=true` verifies the database certificate, and Supabase's certificate only verifies with its own CA. Download it from the SSL settings in the project's Supabase dashboard. Without it, connections fail with `SELF_SIGNED_CERT_IN_CHAIN`. `DATABASE_SSL=no-verify` is a temporary fallback that encrypts without verifying.

For migrations, use a direct connection, or a session-pooler connection when direct access is unavailable on your network. The repository's migration runner holds a session-level advisory lock across migration transactions, so a transaction-pooler URL is unsuitable for that command. Keep migration connection settings in a separate untracked file such as `.env.migrations.local`, with SSL enabled, and run:

```bash
node --env-file=.env.migrations.local --import tsx scripts/db-migrate.ts
```

Ensure an existing shell `DATABASE_URL` does not override that file. See the [Supabase connection guide](https://supabase.com/docs/guides/database/connecting-to-postgres) for connection modes. Hosted migrations must target the intended database and be authorized separately; these instructions do not establish the live migration state.

The app falls back to `POSTGRES_URL` only when `DATABASE_URL` is unset. Vercel uses its own environment settings; a local `.env.local` does not configure or change a deployment. Never add database credentials or `INITIAL_ADMIN_*` values to `NEXT_PUBLIC_*` variables. Demo seeds are not production setup commands.

## Troubleshooting

### A command is not found

Install the missing tool and reopen the terminal. On Windows, PostgreSQL's `bin` directory may need to be on PATH for `psql` and `createdb`; pgAdmin is an alternative for creating the database.

### PowerShell cannot load `npm.ps1`

Use `npm.cmd ci`, `npm.cmd run dev`, and the corresponding `npm.cmd` form for other npm commands. The `node --env-file=...` database commands above do not use `npm.ps1`.

### Database does not exist, password authentication failed, or connection refused

Confirm that PostgreSQL is running and that `DATABASE_URL` matches the database name, role, password, host, and port. Create a missing local database once as described in step 2. Restart the app after changing environment settings.

### A database script says an environment variable is required

Use the full `node --env-file=.env.local --import tsx scripts/...` command from the guide, from `barracks-wa/`. Check that the file exists and contains `DATABASE_URL` or `POSTGRES_URL`. Do not print connection strings while troubleshooting.

### Login fails or a staff screen is empty

Confirm that migrations and the administrator seed completed. Use the configured administrator email, or the `.app` demo email from the current seed. An existing administrator keeps its prior password until the reset command is used. Staff accounts must be verified, active, unblocked, and assigned to a branch to use branch operations.

### A demo refresh reports missing branches or fixtures

The refresh scripts extend an existing showcase. They do not create every prerequisite. Use Administrator **Branches** to create any missing satellite branches with the exact names above and assign demo staff as required. Keep the original roster, active services, and supplier-linked items. Do not use destructive reseeding to repair a database containing records you need.

### A migration reports overlapping bookings or inconsistent historical records

Read its reported record IDs and reconcile the data deliberately before rerunning the migration. The runner rolls back that file. For migration 011 overlap reports, the read-only `scripts/booking-overlap-review.sql` lists affected booking pairs. Never delete bookings or bypass constraints just to advance the ledger.

### Port 3000 is in use

```bash
npm run dev -- --port 3001
```

Open [http://localhost:3001](http://localhost:3001).

## Useful commands

Run these from `barracks-wa/`:

```bash
npm run dev                 # Development server
npm run lint                # ESLint
npx tsc --noEmit             # TypeScript check
npm run build               # Production build
npm run start               # Serve an existing production build
```

Only run checks requested for the task or permitted by `AGENTS.md`. These commands do not certify hosted behavior. A production build must complete before `npm run start`; migrations and seeding are separate database operations.
