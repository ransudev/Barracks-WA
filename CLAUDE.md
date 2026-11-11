# Claude Code guidance for Barracks-PWA

The active Next.js 16 / TypeScript application is in `barracks-pwa/`, not the repository root.

@barracks-pwa/CLAUDE.md

Before making changes, read `barracks-pwa/AGENTS.md` and the relevant sections of `README.md`. Follow the project's branch, commit, validation, security, and README-synchronization rules. Use a dedicated feature branch for implementation; never automatically merge into `main`.

Preserve the existing role/branch permissions, booking and payment protections, and historical financial records. For payroll, treat `payrollspec.md` as the source of truth. Do not change production databases, deploy, or run unrelated tests without explicit authorization.

For code changes within `barracks-pwa/`, follow the Next.js version-specific instructions in `barracks-pwa/AGENTS.md`.
