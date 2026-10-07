# TICKET-002: Support pulley ratios and dual-stack cable stations

Status: Open
Type: Feature
Priority: High
Area: Data model, gym inventory, load calculations, session UI, MCP, Android
Reported: 2026-07-13

## Summary

GymCoach currently stores a cable or machine inventory as a flat list of `weightOptions`. That model cannot distinguish the printed pin-stack value from the effective resistance at the handle, and it cannot describe a single physical frame with two independent cable stacks.

The photographed station in the Olimp gym is dual-sided. Each side has its own stack labeled from 10 kg to 105 kg in 5 kg increments. The user reports a 2:1 pulley ratio, so a selected stack value produces approximately half that value at one handle before friction and other real-world losses.

## Physical equipment facts

Confirmed from the user and photographs:

- One physical dual-sided cable frame.
- Two independently selectable cable sides and two independent stacks.
- Each visible stack is labeled 10 kg, 15 kg, 20 kg, and so on through 105 kg.
- The reported pulley ratio is 2:1.
- The nominal effective load multiplier for one handle is therefore `0.5`.
- The brand badge appears to read `VSPORT`, but the manufacturer and exact model are not confirmed.

For one side, the printed pin options are 10 kg to 105 kg with a 5 kg step. Under a 2:1 ratio, the nominal effective options are 5 kg to 52.5 kg with a 2.5 kg step.

## Problem

The current schema includes:

- `GymEquipment.quantity`
- `GymEquipment.weightOptions`
- links between an equipment item and exercises

It does not include:

- The basis of `weightOptions`, such as printed stack labels versus effective resistance.
- A pulley ratio or load multiplier.
- Independent stations or sides inside one frame.
- A recording convention for one handle, per-side bilateral work, or total combined load.

Without explicit semantics, the same saved value can mean different physical loads on different machines. Progress charts can then compare unlike values as if they were equivalent.

## Required behavior

The equipment model must represent at least the following concepts:

1. Printed stack options.
2. A load conversion from printed stack value to nominal effective handle resistance.
3. The number of independent stations or sides.
4. The convention used to record workout sets.
5. Whether an exercise uses one station, one value per side, or a combined total.

The exact field names are an implementation decision, but the model must avoid overloading one ambiguous `weightOptions` list.

## Suggested model direction

A possible design is:

- `stackWeightOptionsKg`: printed pin values.
- `effectiveLoadMultiplier`: defaults to `1.0`, set to `0.5` for a 2:1 station.
- `stationCount`: defaults to `1`, set to `2` for the photographed frame.
- `recordedLoadMode`: an explicit enum such as `PIN_LABEL`, `EFFECTIVE_PER_HANDLE`, or `EFFECTIVE_TOTAL`.
- An exercise-equipment link setting that describes one-side, per-side, or combined use when necessary.

These names are not mandatory. The behavior and unambiguous persistence are mandatory.

## User interface requirements

- The inventory editor must allow a maintainer or trainee to enter a stack range and pulley ratio without manually calculating every effective value.
- The session picker must clearly identify what is being recorded.
- For ratio machines, show both values when practical, for example `22.5 kg effective` with a secondary label `45 kg pin`.
- Do not silently convert an existing historical value because the application cannot know whether the old value represented the pin label or effective resistance.
- If a linked exercise can use either one side or both sides, the exercise or session must make the recording convention explicit.

## Data and API requirements

The new semantics must be included in:

- Prisma schema and migrations.
- Gym inventory API validation and responses.
- MCP gym inventory tools and training context.
- Backup and restore formats.
- Mobile bootstrap and offline sync models.
- Android calculation and picker logic.
- Program design constraints where equipment loads are exposed to the AI coach.

Existing equipment records must migrate to safe defaults equivalent to the current behavior:

- One station.
- Multiplier `1.0`.
- Existing values treated under an explicit legacy basis without changing their numeric values.

## Acceptance criteria

- A dual-sided station can be saved as one frame with two independent sides.
- Each side can share the same 10 kg to 105 kg printed stack range with a 5 kg step.
- A 2:1 ratio derives nominal effective one-handle values from 5 kg to 52.5 kg with a 2.5 kg step.
- The picker can display pin and effective values without ambiguity.
- The recorded value convention is persisted and available to progress calculations.
- Single-stack 1:1 machines continue to behave exactly as before.
- Existing equipment records and historical workout sets are preserved without silent numeric conversion.
- Web, Android, API, MCP, backup, restore, and offline sync use the same semantics.
- Unit tests and integration tests cover 1:1, 2:1, one-side, per-side, and combined recording modes.

## Open product questions

- Should the default recorded value be the printed pin label or effective resistance?
- For bilateral exercises using both stacks, should the primary value be per side or total effective load?
- How should progress charts separate history recorded under different conventions?
- Should friction-adjusted calibration be supported later, or should the first version remain nominal only?

These questions must be resolved before any automatic migration of historical cable data.

## Related tickets

- TICKET-001 fixes incomplete weight option source and precedence behavior.
- TICKET-003 uses the completed model to add the photographed station to the Olimp profile.
