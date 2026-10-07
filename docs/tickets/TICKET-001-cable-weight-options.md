# TICKET-001: Cable weight picker uses sparse exercise values instead of the full machine stack

Status: Open
Type: Bug
Priority: High
Area: Gym inventory, session weight picker, Android sync
Reported: 2026-07-13

## Summary

The weight picker for `Triceps Pushdowns with Rope · Cable` in the Olimp gym profile offers only 40 kg, 45 kg, and 50 kg. The physical cable stack is labeled from 10 kg to 105 kg in 5 kg increments.

The picker is currently consistent with the stored exercise-specific data, but that data is incomplete. A sparse set of historically used weights must not become the complete inventory of a physical machine.

## User-visible evidence

- `1000196959.png` shows the picker with only 40 kg, 45 kg, and 50 kg.
- `1000196960.png` shows the affected exercise and its imported history.
- `image-1783955226425.jpg` shows the physical stack labels from 10 kg through 105 kg.

The source attachments are in the originating ChatGPT conversation and have not yet been copied into the repository.

## Current behavior

1. Open an active workout in the Olimp gym profile.
2. Open `Triceps Pushdowns with Rope · Cable`.
3. Open the weight picker.
4. The selectable list contains only 40 kg, 45 kg, and 50 kg.
5. Other valid pin positions on the physical machine are absent.

## Expected behavior

When an exercise is linked to a configured machine or cable station, the picker must use the full valid load inventory of that equipment. Historical set values may help select or scroll to a likely current value, but they must not define or truncate equipment availability.

The final displayed values must also respect the load semantics introduced by TICKET-002. For this specific station, the stack labels are 10 kg to 105 kg in 5 kg increments and the reported pulley ratio is 2:1.

## Technical findings

The current code path explains the observed behavior:

- `lib/gym-loads.ts` returns `constraints.weightOptions` verbatim for `MACHINE` and `CABLE` equipment.
- `components/session/editable-sets-table.tsx` passes the full result of `gymWeightOptions()` to `SetValuePicker`.
- `components/session/set-value-picker.tsx` renders every option it receives and does not intentionally limit the list to three values.
- The current Olimp exercise config contains only `[40, 45, 50]` for this exercise.
- `lib/gym-equipment.ts` can copy equipment item weights into per-exercise configs, which makes source precedence and stale overrides important.

The picker component is probably not the root cause. The likely defect is incomplete generated data or an incorrect precedence rule between exercise-specific overrides, linked equipment inventory, and historical observations.

## Required source precedence

Define and test an explicit precedence rule. A reasonable default is:

1. A deliberate exercise-specific override, if the user explicitly configured one.
2. The effective load options from the selected or linked physical equipment item.
3. A generic category fallback only when no inventory is configured.

Automatically inferred historical values must not silently act as a deliberate override.

If several linked machines support the same exercise, the product must either ask which station is being used or provide a deterministic union or station-selection rule. Do not silently choose a sparse list from one source.

## Acceptance criteria

- Linking the affected exercise to a machine with a 10 kg to 105 kg stack and 5 kg step exposes the complete valid range under the chosen pin-label or effective-load display mode.
- The picker still scrolls to or highlights the current value.
- Manual entry remains available.
- Historical sets such as 40 kg, 45 kg, and 50 kg do not truncate the equipment inventory.
- A stale auto-generated `GymExerciseConfig.weightOptions` list does not shadow a newer linked equipment inventory.
- A deliberate manual exercise override can still narrow or replace equipment options and is visibly identified as an override.
- Web and Android produce the same option list.
- Backup, restore, MCP context, and offline sync preserve the corrected source semantics.
- Existing historical sets are not rewritten as part of this bug fix.

## Test coverage

Add focused tests for:

- Sparse historical values plus a complete equipment stack.
- A stale exercise config plus a newer linked equipment inventory.
- An explicit manual exercise override.
- Several linked equipment items with different ranges.
- Web and Android option parity.
- A stack range ending at 105 kg with a 5 kg step.

## Related tickets

- TICKET-002 defines pulley ratio and dual-stack semantics.
- TICKET-003 adds the photographed station to the Olimp profile after the model supports it.
