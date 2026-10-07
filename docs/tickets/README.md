# Local GymCoach tickets

This directory stores maintainer-reviewed local tickets that originated from direct user testing. These files are not GitHub issues yet. They are implementation-ready records that can be copied into GitHub or handed to a local coding agent later.

## Open tickets

| ID | Title | Type | Priority | Status | Dependency |
| --- | --- | --- | --- | --- | --- |
| TICKET-001 | Cable weight picker uses sparse exercise values instead of the full machine stack | Bug | High | Open | Related to TICKET-002 |
| TICKET-002 | Support pulley ratios and dual-stack cable stations | Feature | High | Open | None |
| TICKET-003 | Add the Olimp dual cable station to the gym inventory | Data task | High | Blocked | TICKET-002 |
| TICKET-004 | Rest timer must not block workout navigation or input | Bug | High | Open | None |
| TICKET-005 | Replace the history list with a monthly training calendar | Feature redesign | High | Open | None |

## Source evidence

The originating ChatGPT conversation contains five attachments:

- `1000196959.png`: the weight picker for Triceps Pushdowns with Rope shows only 40 kg, 45 kg, and 50 kg.
- `1000196960.png`: the exercise details page identifies the exercise and its imported history.
- `image-1783955186742.jpg`: a full view of the dual-sided cable station.
- `image-1783955226425.jpg`: a close-up of one stack labeled from 10 kg to 105 kg in 5 kg increments.
- `1000196963.png`: the active rest timer blocks exercise switching and normal workout interaction.

The binary attachments are not stored in this repository yet. Copy them into a future `docs/tickets/assets/` directory before publishing the tickets externally.

## Working rules

- Preserve historical workout records unless a separate migration is explicitly approved.
- Distinguish a machine's printed stack value from the effective resistance at the handle.
- Keep web, Android, API, MCP, backup, and offline sync behavior aligned.
- Add focused tests before changing gym load semantics.
