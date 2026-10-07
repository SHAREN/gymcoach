# Proposal: structured diagnostic feedback from MCP agents

Status: local issue draft only — do not open automatically.
Roadmap item: DESIGN-D1.
Revalidated against upstream/main: 6b33dc2 (2026-09-17).
Prototype reference: 8ab32f7 (feedback portion only).

## Motivation

MCP clients and AI agents can encounter failures that are difficult to observe from ordinary server logs alone: a tool can be hard to discover, a schema can be technically valid but confusing to an agent, a result can be ambiguous, a capability can be missing, or a workflow can require a repeated workaround.

Today GymCoach has no structured channel for an authenticated MCP agent to report that diagnostic context back to the project. The local prototype explored a deliberately narrow feedback surface so recurring MCP friction can be reviewed with enough context to reproduce it.

This proposal is about the feedback lifecycle and storage choice, not a request to merge the prototype as-is.

## Proposed behavior

Add a structured diagnostic submission surface for authenticated MCP agents. A report may describe:

- tool errors;
- discovery friction;
- missing capabilities;
- confusing schemas;
- ambiguous results;
- workflow friction;
- performance problems;
- other actionable MCP issues.

Each report can carry a severity, short summary, detailed description, related tool names, expected versus actual behavior, reproduction steps, attempted workarounds, a suggested improvement, client/agent identity when supplied, and the GymCoach MCP server version.

The prototype also includes a bounded read surface for reviewing accumulated feedback, optionally filtered by category.

## Safety model

Feedback is untrusted diagnostic data, never an instruction channel.

- Stored feedback must never authorize a training-data write or count as user confirmation.
- Agents should submit one report per real root cause rather than spam duplicates.
- Prompts/instructions should explicitly prohibit secrets, access tokens, and unrelated private conversation in reports.
- A feedback submission does not modify workouts, programs, equipment, or other training state.
- The prototype allowed authenticated read-only MCP tokens to submit diagnostics so permission/discovery failures are not silenced. Whether upstream wants that policy is an explicit design decision.
- Listing feedback remains scoped to the authenticated user's MCP workspace in the prototype.

## Prototype shape

The local prototype used two MCP tools:

- `submit_mcp_feedback` — store one structured diagnostic report;
- `list_mcp_feedback` — inspect recent reports for the authenticated user, with category filtering and a bounded result limit.

It stored reports in a dedicated `McpAgentFeedback` Prisma model rather than mixing them with workout-operation audits. The prototype categories are `TOOL_ERROR`, `DISCOVERY_FRICTION`, `MISSING_CAPABILITY`, `CONFUSING_SCHEMA`, `AMBIGUOUS_RESULT`, `WORKFLOW_FRICTION`, `PERFORMANCE`, and `OTHER`; severities are `LOW`, `MEDIUM`, `HIGH`, and `BLOCKING`.

## Open design questions

1. Where should feedback live? A dedicated database table, structured application logs, an admin/developer diagnostics view, GitHub issue export, or another sink?
2. Should authenticated read-only MCP tokens be allowed to submit diagnostic feedback, or should submission require write permission despite not changing training data?
3. Who should be able to read submitted feedback: the trainee, instance administrators, maintainers, or some combination?
4. What retention/deletion policy should apply, especially when reports may contain user-provided diagnostic context?
5. Should duplicate reports be deduplicated/rate-limited server-side, or is agent guidance plus ordinary request limits sufficient?
6. Which client metadata is useful and appropriate to retain (client name, agent name, server version, protocol/client version)?
7. Should the server provide a machine-readable acknowledgement/feedback ID only, or support later status/resolution tracking?

## Suggested minimal first slice

If upstream wants this capability, start smaller than the prototype:

1. agree on the storage/retention and authorization model;
2. add one `submit_mcp_feedback` tool with a bounded schema and explicit untrusted-data semantics;
3. add tests for authentication, tenant isolation, validation limits, and the guarantee that feedback cannot authorize or mutate training data;
4. add a review/read path only after deciding who owns and consumes the reports.

This keeps the first code PR independent of historical-equipment backfill, capability discovery, workout audits, and unrelated MCP functionality.

## Alternatives considered

- **Application logs only:** operationally simple, but loses structured agent-provided expected/actual behavior, reproduction steps, and workaround context unless a new structured logging contract is designed.
- **GitHub issues directly from agents:** creates moderation, privacy, credentials, duplication, and external-network concerns; not appropriate as an automatic default.
- **Workout-operation audit records:** wrong lifecycle and trust model because diagnostic feedback is not a training-data mutation and is not undoable.

## Maintainer decision requested

Would GymCoach benefit from a structured MCP-agent diagnostic feedback channel? If yes, which storage/retention model and authorization/read policy should a minimal implementation target?
