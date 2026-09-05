# SHAREN web migration

Goal: rebuild SHAREN/gymcoach as a clean web/server fork on top of current Julien-Au/gymcoach `main`, preserving useful SHAREN web/backend/MCP behavior while leaving Android/Huawei/mobile-client code out of this branch.

## Invariants

- Base work starts from current upstream `main`; do not rebuild from the old Android monorepo.
- Do not add `android/`, `huawei-watch-app/`, `app/api/mobile/`, APK release tooling, mobile-client auth/sync code, or personal Home-PC/HERMES/deployment hacks.
- Do not reintroduce the rejected embedded web AI proposal/review flow. External AI (ChatGPT/agent) is the semantic layer; MCP exposes bounded context and safe deterministic operations.
- Before porting a SHAREN feature, compare it with current upstream and skip it if upstream already has equivalent behavior.
- Port in small logical batches. Each completed batch gets focused tests and its own commit.
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
| M04 | Completed workout/history set editor | TODO | Preserve current upstream equipment-history model. |
| M05 | Preferred equipment per exercise/gym | TODO | Add domain first, then UI. |
| M06 | Exercise detail/equipment editor | TODO | Depends on M05. |
| M07 | Durable web set acknowledgement/replay | TODO | Port only behavior not already present upstream. |
| M08 | Equipment-aware return-to-training | TODO | Extend upstream return-to-training, do not replace it. |
| M09 | Session exercise strip/navigation | TODO | Web-only UI. |
| M10 | Set value picker and editable set table | TODO | Split if the combined diff gets too large. |
| M11 | Structured coaching profile | TODO | Re-evaluate schema against current upstream before migration. |
| M12 | Program revisions/design context/validation | TODO | Prefer neutral provenance/validation infrastructure. |
| M13 | Multi-muscle exercise load profile | TODO | Port only after compatibility review. |
| M14 | Permanent free-weight system profiles | TODO | Re-check against current upstream equipment UX first. |
| M15 | Final semantic diff audit + full gate | TODO | Confirm no approved non-Android product behavior was missed. |

## Already upstream / do not re-port

Russian localization, intra-set autoregulation, saved gym profiles, exercise technique media, base ChatGPT MCP, base return-to-training, physical gym equipment, set equipment history, native GymCoach CSV import, aerobic decoupling, progress photos, and muscle heat map are already present upstream or have an upstream-equivalent implementation.
