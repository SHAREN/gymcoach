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
- `get_program_design_context`
- `validate_program_draft`
- `list_exercises`
- `list_programs`
- `get_program`

Write tools:

- `update_gym_free_weights`
- `upsert_gym_equipment`
- `set_gym_equipment_image`
- `create_program`
- `create_program_revision`
- `update_program_metadata`
- `add_program_exercise`
- `update_program_exercise`
- `remove_program_exercise`
- `activate_program`

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

The two design write tools rebuild the context and rerun validation immediately
before persistence. An MCP client cannot make a program valid by calling the
read-only validator once and then submitting a different draft. Required
questions must be answered, validation errors block the write, and the server
records its own current methodology version instead of trusting a caller value.

## Health check

`GET /mcp/health` returns `401` without a token and `200` for an active token.
