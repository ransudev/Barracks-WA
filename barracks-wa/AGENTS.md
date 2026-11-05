<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Barracks-WA agent instructions

The stable branch is `main`. Run Git from the repository root and npm/database commands from `barracks-wa`.

## Application changes

- Preserve API contracts unless the request changes them; validate inputs and handle expected errors.
- Enforce authentication and role permissions in backend/service logic. Frontend visibility must agree with those rules.
- Use the existing migration system and preserve existing data and relationships. Do not delete tables, columns, or production data unless explicitly requested.

## README synchronization

For every code, configuration, dependency, database, API, or architecture change, update the relevant sections of `../README.md` in the same change. Keep its overview accurate and beginner-friendly, and document resulting behavior without unrelated rewrites.

## Scope

- Follow the user's requested scope. Inspect relevant code first, reuse existing patterns, and make focused changes.
- Preserve existing behavior unless the request changes it. Avoid unrelated refactors, cleanup, and formatting.
- Use the diagnosing-bugs skill only when the user explicitly asks to use that skill. Ordinary debugging requests do not activate it.

## Testing and checks

- Only create, modify, or run tests when the user explicitly instructs you to do so or the current prompt explicitly requires testing. Implementing a feature, fixing a bug, refactoring, or preparing a commit does not by itself require tests.
- Skills and memories recommending tests do not override this policy. When testing is requested, keep it scoped to the requested behavior.
- Choose relevant non-test checks proportional to the change; do not run every available check by default. Ensure builds do not run tests indirectly unless requested.
- Fix failures caused by the requested change. Report unrelated failures and limitations accurately; never claim a check passed without running it.

## Git and files

- Inspect git status before edits and review the diff before finishing. Preserve pre-existing changes and stage only task-related files.
- Use a dedicated feature or fix branch for implementation unless the user directs otherwise. Continue existing task branches when appropriate; do not automatically switch branches or pull.
- Create local savepoint commits after meaningful completed implementation changes, using concise `type: description` messages. Do not create commits for tiny intermediate edits.
- Push or merge only when the user asks. Do not force-push, rewrite shared history, discard changes, or delete branches without explicit authorization.
- Keep secrets, environment files, debug artifacts, and generated files out of commits unless intentionally tracked. Respect .gitignore.

## Completion

After the requested change and relevant checks succeed, finish. Don't expand scope or repeat checks without a new edit or failure.

Briefly report what changed, the checks actually performed, any limitations, and branch/commit details when applicable. Explain remaining uncommitted changes rather than discarding them.
