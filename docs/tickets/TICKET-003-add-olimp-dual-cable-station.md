# TICKET-003: Add the Olimp dual cable station to the gym inventory

Status: Blocked
Type: Data task
Priority: High
Area: Olimp gym profile, equipment inventory, exercise links
Reported: 2026-07-13
Blocked by: TICKET-002

## Summary

Add the photographed dual-sided cable station to the `Olimp` gym profile after GymCoach supports pulley ratios and independent stations.

This task must not be completed by storing only a flat list of printed stack values. The equipment must preserve the distinction between the pin label and the effective handle resistance.

## Equipment data to enter

- Proposed name: `Dual-sided cable crossover`
- Equipment type: `CABLE`
- Physical quantity: `1` frame
- Independent station count: `2`
- Printed stack options per side: 10 kg to 105 kg inclusive
- Printed stack step: 5 kg
- Reported pulley ratio: 2:1
- Nominal effective multiplier per handle: `0.5`
- Nominal effective range per handle: 5 kg to 52.5 kg inclusive
- Nominal effective step per handle: 2.5 kg
- Manufacturer: unconfirmed
- Visible badge: appears to read `VSPORT`
- Model name: unconfirmed

## Photo evidence

- `image-1783955186742.jpg` shows the complete dual-sided frame, two stacks, upper and lower pulley paths, attachments, and pull-up handles.
- `image-1783955226425.jpg` shows one stack labeled from 10 kg through 105 kg in 5 kg increments.

The files are attached to the originating ChatGPT conversation and are not yet stored in the repository.

## Initial exercise link

Link at least:

- `Triceps Pushdowns with Rope · Cable`

Candidate links that require user confirmation before saving include:

- Face pulls with rope.
- Cable curls.
- Cable rows.
- Straight-arm pullovers or pulldowns.
- Other one-side or two-side cable movements supported by the available pulley positions and attachments.

Do not link every cable exercise automatically. The physical station and the user's actual setup must support the exercise safely and consistently.

## Existing data to reconcile

The current Olimp configuration for `Triceps Pushdowns with Rope · Cable` exposes only 40 kg, 45 kg, and 50 kg. Those values appear to come from historical or exercise-specific data rather than the complete machine inventory.

After TICKET-001 and TICKET-002 are implemented:

- The linked equipment must provide the complete valid range.
- Existing historical sets must remain numerically unchanged.
- The app must explicitly identify whether old values were recorded as pin labels or effective loads before any conversion is considered.
- A stale auto-generated exercise override must not shadow the new equipment inventory.

## Acceptance criteria

- The Olimp inventory contains one dual-sided cable frame with two independent stations.
- Both stacks use the same printed 10 kg to 105 kg range with a 5 kg step.
- The equipment stores the 2:1 pulley ratio and derives the correct nominal effective range.
- The equipment record includes the supplied photographs or stable repository copies of them.
- `Triceps Pushdowns with Rope · Cable` is linked to this station.
- The session picker exposes the full valid range under the selected recording convention.
- The UI shows enough context to distinguish the printed pin value from the effective load.
- Existing workout history is preserved.
- MCP training context returns the new equipment and its load semantics.
- Android receives the same inventory through bootstrap and offline sync.

## Verification checklist

- Compare the saved stack list against the close-up photograph.
- Verify both sides of the station are represented.
- Set the pin to 45 kg and confirm the UI can represent 45 kg pin and 22.5 kg nominal effective load without ambiguity.
- Open the affected exercise in a workout and confirm the picker is not limited to 40 kg, 45 kg, and 50 kg.
- Confirm progress history is not silently rewritten.
