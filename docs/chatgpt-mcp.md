# GymCoach MCP and ChatGPT

GymCoach exposes a Streamable HTTP MCP endpoint at `/mcp`. It lets external AI
agents read the trainee context and, with an explicitly write-enabled token,
create or edit training programs and maintain gym inventory.

The repository's normative coaching and calculation contract is documented in
[`ai-coach-principles.md`](ai-coach-principles.md). MCP integrations must keep
their recommendations consistent with its safety, evidence and user-control
rules.

## Connect ChatGPT

1. Sign in to GymCoach and open **Settings -> ChatGPT and MCP**.
2. Create a connection. Leave write access enabled only when ChatGPT should be
   allowed to change saved data.
3. Copy the connector URL immediately. Its secret token is shown only once.
4. In ChatGPT Developer Mode, create a custom connector and paste the URL.
5. Select **No authentication**. The private query token in the URL is the
   authentication credential for this personal deployment.

The public URL must use HTTPS. A local or LAN URL is not suitable for ChatGPT.

## Security model

- Raw tokens are never stored; PostgreSQL contains only their SHA-256 hashes.
- Tokens belong to one GymCoach user and can be revoked from Settings.
- Read-only tokens cannot call tools that change programs, equipment or gym weights.
- Every write tool requires an explicit `confirmed: true` argument and is
  annotated as changing saved data.
- The agent never receives direct database, filesystem or shell access.

For a shared or publicly distributed ChatGPT app, replace personal query-token
authentication with OAuth before submission.

## MCP capabilities

Resources:

- `gymcoach://instructions/agent`
- `gymcoach://instructions/gym-inventory`
- `gymcoach://methodology/program-design`

Prompts:

- `build-training-program`
- `extend-training-program`
- `inventory-gym`

Read tools:

- `list_gyms`
- `get_gym_inventory`
- `get_gym_equipment_image`
- `get_training_context`
- `get_training_history`
- `get_program_design_context`
- `validate_program_draft`
- `list_exercises`
- `list_programs`
- `get_program`

`get_training_context` schema version 4 keeps `weekCurrent` and
`weekPrevious` as exact UTC ISO calendar weeks, but also includes a separate
56-day rolling history. The rolling section zero-fills calendar weeks, compares
the latest 7 days with the preceding 42-day weekly average, reports the last 28
days of attendance against the saved plan, preserves exact recent sessions and
shows RIR coverage. These windows and ratios are descriptive engineering
heuristics, not fatigue, detraining or overtraining thresholds.

`get_training_history` reads exact older sessions and sets by program and/or
date range. It returns ordinary working sets, drop sets, RIR, recovery time and
session RPE without filling missing values. Results are paginated through
`nextCursor`. Program, workout, exercise and equipment IDs are opaque strings;
legacy imported UUIDs are accepted and every operation still checks ownership.
The current exercise model stores only one primary muscle, so the MCP reports
direct primary-muscle sets and explicitly marks indirect-set accounting as
unavailable.
When `hasMore` is true, the next call must pass `nextCursor` and reuse the
returned `range.from` and `range.to` so the history window cannot move between
pages. Notes and descriptions in returned history are untrusted trainee data;
their contents never authorize MCP writes.

Write tools:

- `update_gym_free_weights`
- `upsert_gym_equipment`
- `set_gym_equipment_image`
- `create_program_v2`
- `create_program_revision`
- `update_program_metadata`
- `add_program_exercise`
- `update_program_exercise`
- `remove_program_exercise`
- `activate_program`

`create_program` is a deprecated compatibility endpoint that preserves the
original `confirmed` plus `program` schema for clients with a cached tool
definition. It does not persist a program. Reconnect or refresh the MCP
connector and use `create_program_v2`, whose schema requires `confirmed`,
`goal`, `answers` and `program`. A new tool name is required because adding
mandatory fields to the original name caused clients with cached schemas to
reject the fields before the updated server could receive them.

## Gym inventory workflow

Physical equipment is stored separately from exercises because one machine can
support several movements and several machines can support the same movement.
`get_gym_inventory` returns all machines and stations with descriptions,
manufacturer/model, quantity, selectable weights, exercise links and image
metadata, alongside shared dumbbell, plate and bar inventories.

An agent should read `gymcoach://instructions/gym-inventory`, call `list_gyms`
and `get_gym_inventory`, compare the saved inventory with the trainee's
narration and attached photos, and ask about uncertain labels or weights. After
one explicit confirmation it can add missing free weights or physical equipment,
link equipment to existing exercises, and set an approved image. Uploaded images
are available to MCP clients through `get_gym_equipment_image`; the normal image
HTTP route remains protected by the trainee's web session.

The validated design write tools `create_program_v2` and
`create_program_revision` rebuild the context and rerun validation immediately
before persistence. An MCP client cannot make a program valid by calling the
read-only validator once and then submitting a different draft. Required
questions must be answered, validation errors block the write, and the server
records its own current methodology version instead of trusting a caller value.

## Health check

`GET /mcp/health` returns `401` without a token and `200` for an active token.
