# Web preferred equipment autosave - 2026-09-12

Production behavior fixed in the production-source snapshot `D:\codexpro_workspace\gymcoach-deploy-d32de4c-20260905`.

## Required behavior

When the trainee selects a concrete machine/station in an active web workout, the selection must immediately persist as `GymExerciseConfig.preferredEquipmentId` for that gym + exercise. It must not wait for a set or exercise to be completed. A later newly created workout must default to the last explicitly selected equipment.

## Implementation in production source

- Added `PATCH /api/gyms/[id]/exercises/[exerciseId]/preferred-equipment`.
- The route validates input and delegates to `setPreferredExerciseEquipment`, so only the preference changes; exercise-equipment links are not rewritten.
- `SessionRunner` updates the current selection optimistically and queues preference writes in selection order.
- Save failures keep the current workout selection but show a toast.
- Existing next-workout resolution already reads `preferredEquipmentId` through `resolveSelectedEquipmentId`.
- Added unit coverage for the client persistence request and failure path.

## Verification / deployment

- Production green gate: 155 test files, 1360 tests passed; lint, typecheck and production build passed.
- Deployed image: `gymcoach-app:preferred-equipment-autosave-20260912`.
- Image revision label: `d32de4c-wheel-c4948dd-preference-autosave`.
- Public root check: 307; unauthenticated `/mcp/health`: 401.
- Database migrations: 32 found, no pending migrations.
- Rollback image: `gymcoach-app:rollback-preferred-equipment-20260912`.
- Pre-deploy DB dump: `backups/deploy/gymcoach-pre-preferred-equipment-20260912.dump` inside the production-source snapshot.

## Important merge note

The fresh upstream-sync branch currently does not contain the later production-only preferred-equipment domain. When that domain is restored/reconciled into the main web branch, carry this autosave route and SessionRunner behavior forward. Do not replace it with the broad exercise-equipment editing route because that route can rewrite links; this autosave must mutate only the preferred equipment field.
