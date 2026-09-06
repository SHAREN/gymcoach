# Legacy SHAREN production cutover

This runbook bridges the legacy SHAREN production database to the clean web/server migration without deleting Android/mobile archival tables or coercing historical data.

## Safety rules

1. Take and verify a PostgreSQL backup before changing production.
2. Rehearse every step on a fresh restored production copy first.
3. Do not run `prisma migrate reset`, `prisma db push`, or a destructive schema-diff script against production.
4. Leave legacy-only tables, columns, enums, and their existing `_prisma_migrations` rows intact. The clean runtime ignores them.
5. Stop the old application before the production bridge so only one application version can write during schema reconciliation.

## 1. Apply the non-destructive bridge

Run `scripts/legacy-production-cutover.sql` with `ON_ERROR_STOP=1` against the database.

The bridge is idempotent and does only two clean-runtime additions that legacy production lacks:

- derives `GymEquipment.loadConfigurationKnown` from already-recorded deterministic load facts; rows containing only legacy defaults remain unknown (`false`), while configured selectorized/plate-loaded/barbell facts become known (`true`);
- creates the clean `McpMutation` idempotency table and indexes while leaving `MobileMutation`, `MobileAccessToken`, mobile snapshot/history tables, and all other legacy-only objects untouched.

It does not round or rewrite `Set.rir`. Legacy production contains fractional RIR history, so the clean schema uses `Float?` and the follow-up migration preserves that column as `DOUBLE PRECISION`.

## 2. Reconcile equivalent clean migrations

Legacy production already contains the behavior represented by the following clean migrations under different historical migration names. After the bridge succeeds, mark exactly these clean migrations as applied with `prisma migrate resolve --applied`:

- `20260823063000_add_gym_equipment_inventory`
- `20260823073000_add_set_equipment_history`
- `20260904090000_index_set_gym_equipment`
- `20260905110000_add_external_ai_mcp_workflow`
- `20260905170000_add_preferred_gym_equipment`
- `20260905193000_add_structured_coaching_profile`
- `20260905200000_add_program_revision_lineage`
- `20260905204500_add_exercise_load_profiles`
- `20260905212000_add_permanent_free_weight_profiles`

Do not delete or rename the 21 legacy-only migration rows. Prisma accepts those extra historical rows once the equivalent clean migrations above are resolved.

## 3. Deploy genuinely new migrations

Run:

```text
npx prisma migrate deploy
npx prisma migrate status
```

The first clean-only migration that must execute after reconciliation is `20260906213000_preserve_fractional_rir`. A successful rehearsal ends with `Database schema is up to date!`.

## 4. Required verification before switching application traffic

On the bridged database verify all of the following:

- the historical fractional RIR row(s) still exist unchanged and current Prisma Client can read them;
- `loadConfigurationKnown` has no nulls and matches deterministic load facts;
- `McpMutation` exists; legacy mobile tables still exist;
- clean Prisma Client can read users, programs, sessions, sets, gyms, and equipment;
- MCP gym inventory, training history, and external-AI context reads succeed for an owned gym;
- current web build can register/login a temporary account on an isolated copy and complete the representative program → workout → set logging → history/progress flow;
- full unit, integration, E2E, typecheck, lint, build, and MCP gates are green on the exact deployment commit.

Only after those checks pass should the old application be stopped, the same bridge/reconciliation sequence be applied to production, and the new application be started. Keep the verified backup and the archived old main available for rollback.