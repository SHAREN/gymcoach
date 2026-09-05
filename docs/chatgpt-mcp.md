# GymCoach MCP and ChatGPT

GymCoach exposes a Streamable HTTP MCP endpoint at `/mcp`. It lets external AI
agents read the trainee context and, with an explicitly write-enabled token,
create or edit training programs.

## Connect ChatGPT

1. Sign in to GymCoach and open **Settings -> ChatGPT and MCP**.
2. Create a connection. Leave write access enabled only when ChatGPT should be
   allowed to change saved programs.
3. Copy the connector URL immediately. Its secret token is shown only once.
4. In ChatGPT Developer Mode, create a custom connector and paste the URL.
5. Select **No authentication**. The private query token in the URL is the
   authentication credential for this personal deployment.

The public URL must use HTTPS. A local or LAN URL is not suitable for ChatGPT.

## Security model

- Raw tokens are never stored; PostgreSQL contains only their SHA-256 hashes.
- Tokens belong to one GymCoach user and can be revoked from Settings.
- Read-only tokens cannot call program-writing tools.
- Every write tool requires an explicit `confirmed: true` argument and is
  annotated as changing saved data.
- The agent never receives direct database, filesystem or shell access.
- The connector URL carries the token as a query string, so treat the URL
  itself as a secret: query strings routinely end up in reverse-proxy and
  access logs and in browser history. Disable or scrub query-string logging
  on any proxy in front of GymCoach, and prefer the `Authorization: Bearer`
  or `X-GymCoach-Token` header (both are supported) for MCP clients that can
  send headers.

For a shared or publicly distributed ChatGPT app, replace personal query-token
authentication with OAuth before submission.

## MCP capabilities

Resources:

- `gymcoach://instructions/agent`

Prompts:

- `build-training-program`

Read tools:

- `get_training_context`
- `list_exercises`
- `list_programs`
- `get_program`

Write tools:

- `create_program`
- `update_program_metadata`
- `add_program_exercise`
- `update_program_exercise`
- `remove_program_exercise`
- `activate_program`

## Responsibility boundary: external AI vs GymCoach

For free-form workout import and gym-inventory interpretation, semantic reasoning belongs to the external MCP-capable AI agent (for example, ChatGPT), not to a duplicate LLM workflow embedded in the GymCoach web UI.

The intended architecture is: User -> ChatGPT / external AI agent -> GymCoach MCP -> validated GymCoach data.

The external agent is responsible for understanding natural-language exercise names, photos and context, comparing them with the exercise catalog, recent history, the current program and the selected gym inventory, and deciding which existing records are the best semantic match. When there is a real ambiguity, the external agent asks the user in chat instead of inventing an answer.

GymCoach MCP is responsible for exposing bounded, user-scoped context and safe, deterministic operations. It should let the external agent read exercises, program/history context and gym inventory; reuse or create canonical exercises and physical equipment; bind compatible exercise/equipment records; and import or update training data. Server-side validation must still enforce ownership, gym scope, compatibility, idempotency, confirmation and other data-integrity constraints.

Do not add a dedicated web AI-proposal/review interface or an embedded LLM proposal pipeline for this workflow unless the owner explicitly requests such a product feature. Ordinary manual editing remains separate from semantic reasoning performed by the MCP agent.

Example: if the user writes “Хаммер верхняя тяга 25 кг”, ChatGPT should inspect the selected gym inventory and exercise catalog through MCP, recognize the intended plate-loaded upper-pulldown movement, and reuse or create appropriate canonical exercise/equipment records without inventing a manufacturer, model or unknown loading characteristics. If two physical machines are genuinely plausible, ChatGPT asks the user which one was used.

## Health check

`GET /mcp/health` returns `401` without a token and `200` for an active token.
