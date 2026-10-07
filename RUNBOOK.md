# GymCoach MCP Runbook

This runbook is the first operational entry point for GymCoach MCP work on Renat's Home PC.

## Mandatory reading order

Before inspecting, explaining, or changing this repository, read:

1. `D:\codexpro_workspace\gymcoach\AGENTS.md`
2. `D:\codexpro_workspace\gymcoach\CLAUDE.md`
3. `D:\codexpro_workspace\gymcoach\docs\chatgpt-mcp.md`

Before changing or explaining training calculations, methodology, prompts, progression, fatigue, recovery, deload, or return-to-training logic, also read:

```text
D:\codexpro_workspace\gymcoach\docs\ai-coach-principles.md
```

The NotebookLM research workflow in `AGENTS.md` is mandatory for training-science decisions. If NotebookLM authentication is unavailable, report the block instead of inventing evidence.

## Project location

```text
D:\codexpro_workspace\gymcoach
```

GymCoach is a Next.js application with an integrated Streamable HTTP MCP endpoint at `/mcp`.

## Upstream sync checkpoint

For the 2026-08-22 synchronization with `Julien-Au/gymcoach`, including the resolved Git conflicts, current branch, database-migration conflict, production-only database fields/migrations, verification results, web PR candidates, and Android architecture discussion, read:

```text
docs\upstream-sync-2026-08-22.md
```

Do not deploy the synchronized branch or rewrite production migration history before reading that checkpoint. Production currently contains local database changes that are not yet fully represented in the synchronized repository.

For the Android sync incident with the stale `UPDATE_PREFERRED_EQUIPMENT` queue item, the accidental 2026-08-22 mobile-API downgrade, the server rollback, and the required Android recovery fix, also read:

```text
docs\android-sync-incident-2026-08-22.md
```

For the historical Codex work, the recovered `v0.4.49` source line, imported archive branch/tags, release-by-release Android changes, important Codex thread IDs, and product contracts recovered from those threads, read:

```text
docs\codex-history-handoff-2026-08-22.md
```

The exact Codex Android release source is now reachable in this repository as `archive/codex-manual-sequential-v0.4.49`; do not merge that branch wholesale into the upstream-sync branch.

## Primary MCP files

MCP HTTP route:

```text
app\mcp\route.ts
```

MCP server, tool registration, handlers, and schemas:

```text
lib\mcp\server.ts
```

MCP token and access checks:

```text
lib\mcp\auth.ts
```

MCP tests:

```text
lib\mcp\server.test.ts
lib\mcp\auth.test.ts
```

User-facing MCP settings:

```text
components\settings\mcp-section.tsx
app\api\mcp-tokens\
```

Normative connector documentation:

```text
docs\chatgpt-mcp.md
```

## Architecture

```text
ChatGPT GymCoach connector
  -> public HTTPS route
  -> GymCoach Next.js application
  -> /mcp
  -> lib/mcp/server.ts
  -> Prisma
  -> PostgreSQL
```

The connector token belongs to one GymCoach user. Raw tokens must never be printed, committed, or copied into documentation. Read-only tokens cannot change saved data. Write tools require both write permission and an explicit `confirmed: true` argument.

## Safe operating rules

- Read GymCoach data before making recommendations.
- Never invent completed sets, equipment, records, injuries, or recovery signals.
- Respect the active gym and its saved equipment inventory.
- Use stable opaque IDs returned by GymCoach read tools.
- Do not call a write tool without explicit user confirmation for that saved-data change.
- Do not activate a program without explicit confirmation.
- Treat the live ChatGPT connector schema as the source of truth for the currently exposed tool set.

## Local development and verification

Development server:

```powershell
cd D:\codexpro_workspace\gymcoach
npm run dev
```

The development script uses port `3030`.

Focused checks:

```powershell
npm run typecheck
npm test
```

Repository verification gate:

```bash
bash scripts/verify.sh
```

Do not weaken or skip tests to make the gate pass.

## MCP health and smoke checks

HTTP health behavior is documented in `docs/chatgpt-mcp.md`:

```text
GET /mcp/health without an active token -> 401
GET /mcp/health with an active token    -> 200
```

Preferred read-only checks through the connected ChatGPT MCP:

1. Call `list_gyms` and confirm an active gym is returned.
2. Call `list_programs` or `get_training_context` when a deeper data-path check is needed.
3. Do not use a write tool as a health check.

## Last verified state

Verified from ChatGPT on 2026-07-31:

- `list_gyms` completed successfully.
- Active gym: `Олимп`.
- The connector returned saved gym counts and IDs, confirming the authenticated data path works.

This status is a point-in-time observation. Re-run a read-only check before diagnosing a new incident.
