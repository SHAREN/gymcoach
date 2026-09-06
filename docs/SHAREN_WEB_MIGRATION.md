# SHAREN web migration

Persistent implementation/handoff journal: [`SHAREN_WEB_MIGRATION_LOG.md`](SHAREN_WEB_MIGRATION_LOG.md). Read it first when continuing from another thread.

Goal: rebuild SHAREN/gymcoach as a clean web/server fork on top of current Julien-Au/gymcoach `main`, preserving useful SHAREN web/backend/MCP behavior while leaving Android/Huawei/mobile-client code out of this branch.

## Invariants

- Base work starts from current upstream `main`; do not rebuild from the old Android monorepo.
- Do not add `android/`, `huawei-watch-app/`, `app/api/mobile/`, APK release tooling, mobile-client auth/sync code, or personal Home-PC/HERMES/deployment hacks.
- Do not reintroduce the rejected embedded web AI proposal/review flow. External AI (ChatGPT/agent) is the semantic layer; MCP exposes bounded context and safe deterministic operations.
- Before porting a SHAREN feature, compare it with current upstream and skip it if upstream already has equivalent behavior.
- Port in small logical batches. Each completed batch gets focused tests and its own commit.
- Mutual exclusion: before any mutation, commit, migration, or DB-resetting test, check `D:\codexpro_workspace\.gymcoach-interactive-chat.lock`. While that file is owned by `interactive-chat` and its filesystem mtime is younger than 90 minutes, an hourly watchdog may inspect/report only and must not mutate the worktree or test DB. If the lock is stale, first verify that no matching GymCoach write/test process is active before taking over.
- All migration work is performed through Home-PC/CodexPro directly. Do not launch Codex Threads or the local Codex CLI for this project.
- Do not deploy this migration branch until the complete migration passes the full gate and is explicitly approved for deployment.

## Source snapshots

- Upstream base at migration start: `Julien-Au/gymcoach@f4cc2a98753604cf4347e22da6dadd346289b521`
- Legacy SHAREN monorepo reference: `SHAREN/gymcoach@25a784380910a6e0056b2df93bd5caf1e525341e`

## Backlog

| Batch | Feature | Status | Notes |
| --- | --- | --- | --- |
| M01 | Exercise catalog/replacement filters | DONE | Catalog filters ported with shared helper; later replacement UI should reuse the same helper. |
| M02 | MCP read tools: gyms, inventory, training history | DONE | Read-only tools ported against current upstream Gym/GymEquipment/Set models with ownership checks and exact history facts. |
| M03 | MCP equipment write operations | DONE | Added confirmed write tools for current-upstream free weights, physical equipment and equipment images; ownership delegated to/checked by server domain helpers. |
| M04 | Completed workout/history set editor | DONE | Completed strength rows can be corrected/appended without mutating frozen exercise/equipment history; focused unit/component/API tests cover ownership and finished-session guards. |
| M05 | Preferred equipment per exercise/gym | DONE | Domain/schema, ownership/link/type validation, delete-safe FK and MCP inventory context are implemented; UI follows in M06. |
| M06 | Exercise detail/equipment editor | DONE | Added exercise detail page plus per-gym physical-equipment linking/preference editor with transactional ownership, gym-scope and compatibility validation. |
| M07 | Durable web set acknowledgement/replay | DONE | Web queue posts stable client IDs; server exact replays are idempotent/conflicting replays are 409; hydration reconciles client IDs without synthetic duplicates and keeps unknown outcomes durable. |
| M08 | Equipment-aware return-to-training | DONE | Added exact per-gym/per-equipment return history while preserving the upstream generic API; live selection switches return ceilings without mixing physical machines or deleted-equipment snapshots. |
| M09 | Session exercise strip/navigation | DONE | Added a web-only horizontal exercise strip with direct in-session navigation, completion markers and superset grouping; switching is locked during rest. |
| M10 | Set value picker and editable set table | DONE | M10a adds the saved-value/keypad picker; M10b edits existing strength rows through the same durable IndexedDB queue, using POST before server acknowledgement and narrow PATCH after it while preserving frozen equipment history. |
| M11 | Structured coaching profile | DONE | Added versioned UNKNOWN/KNOWN/NOT_APPLICABLE coaching facts with atomic partial profile writes, web settings UI, backup/restore and bounded MCP/coach context; no program-design policy is applied here. |
| M12 | Program revisions/design context/validation | DONE | Added external-agent program-design context, deterministic primary-muscle validation, confirmed inactive revision lineage/provenance, and backup-safe lineage restore; no new embedded LLM methodology or generator path. |
| M13 | Multi-muscle exercise load profile | DONE | Added server-owned versioned load profiles, collision-safe full-fingerprint provenance, direct/indirect/equivalent deterministic aggregation for MCP/history/program design, and backup v8 trust re-derivation; existing upstream progress/stats UI remains unchanged. |
| M14 | Permanent free-weight system profiles | DONE | Permanent Dumbbells/Barbell profiles, plate pools, structured load facts, backup v9, MCP/REST/UI integration, and full green-gate verified. |
| M15 | Final semantic diff audit + full gate | DONE | Approved non-Android parity is exhausted; committed candidate passed unit/integration/E2E/typecheck/lint/build gates. |

## Remaining migration-plan stages

| Stage | Scope | Status | Notes |
| --- | --- | --- | --- |
| S13 | Remove Android-specific backend from clean web | DONE | Audit found no tracked Android/Huawei/mobile API, APK runtime/data/scripts, mobile auth models or mobile mutation models. Neutral MCP tokens/mutations and frozen equipment snapshots are shared web/MCP domain and remain. |
| S14 | Preserve Android/Huawei archive | PAUSED | Correct v2 history-preserving local extraction is stored at D:/codexpro_workspace/gymcoach-android-extract-v2 with ARCHIVE_STATUS.md. Per user request, do not publish/deploy it now; Android work does not block clean-web completion. |
| S15 | Final clean-web verification | DONE | Non-destructive legacy bridge verified on production DB copy; current Prisma runtime, real web workflow, MCP read/write smoke, forbidden-path audit, full unit/integration/E2E/typecheck/lint/build gates all green on exact cutover candidate. |
| S16 | Integrate/switch main, deploy, production health, cleanup | TODO | Preserve old main before switching; no force-push without backup. |

## Already upstream / do not re-port

Russian localization, intra-set autoregulation, saved gym profiles, exercise technique media, base ChatGPT MCP, base return-to-training, physical gym equipment, set equipment history, native GymCoach CSV import, aerobic decoupling, progress photos, and muscle heat map are already present upstream or have an upstream-equivalent implementation.
