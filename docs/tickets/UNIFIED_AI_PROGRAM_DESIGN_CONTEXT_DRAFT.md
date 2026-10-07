# Proposal: share one validated AI program-design pipeline across web and MCP

Status: local discussion draft only. Do not open automatically.

## Motivation

GymCoach currently exposes two AI-facing program-design paths with different context and validation boundaries:

- the web generation route calls `generateProgram(userId, goal)` and returns a structured draft;
- MCP instructs an external agent to call `get_training_context` and `list_exercises`, then submit a `generatedProgramSchema` payload through `create_program` after explicit confirmation.

Both paths can create useful programs, but they do not share one explicit, versioned program-design context and deterministic validation contract. That makes it possible for web generation and an MCP agent to reason from different inputs or enforce different training-design constraints.

A local prototype explored a shared pipeline. This draft is intentionally about the architecture and contract, not about upstreaming that prototype as-is.

## Proposed direction

Introduce a small shared program-design domain layer that both web generation and MCP can consume:

1. `buildProgramDesignContext(userId, ...)` returns the same normalized trainee/program/gym/history/recovery inputs regardless of caller.
2. A versioned program-design methodology describes deterministic rules and the assumptions an AI client should follow.
3. `validateProgramDesign(...)` performs deterministic validation of a structured draft before persistence and returns machine-readable issues.
4. Web generation uses the shared context/methodology/validation around its LLM call.
5. MCP exposes the same context and validation contract to external agents instead of maintaining a separate implicit design path.
6. Persistence remains a separate confirmed write step. Validation must not itself write or activate a program.

## Safety and ownership boundaries

- All context is scoped to the authenticated GymCoach user.
- The shared context should expose only data needed for program design; it should not become a generic database dump.
- MCP write permission and explicit confirmation remain required for persistence.
- A generated or validated draft is not evidence of user confirmation.
- Deterministic validation should reject structurally or domain-invalid drafts before persistence rather than relying on prompt compliance.
- Active-gym/equipment constraints should come from the same canonical source for both callers.
- The local NotebookLM workflow policy is explicitly out of scope and should not be upstreamed as part of this proposal.

## What the local prototype explored

The local implementation in commits `d4857b5` and `68d84dd` included:

- a `ProgramDesignContext` builder combining relevant trainee, gym, history, goal and recovery information;
- a versioned program-design methodology/rules module;
- deterministic program-design validation with structured issues;
- web program-generation integration;
- MCP integration using the same design concepts;
- focused unit/integration coverage.

The prototype also touches schema, UI, prompts and other broad surfaces. Those parts should not be treated as the proposed PR shape.

## Suggested upstream slicing

If the direction is accepted, prefer multiple reviewable changes rather than one large PR:

1. Shared read-only context builder plus focused tests.
2. Shared deterministic validator plus focused tests.
3. Web generation adopts the shared context/validator without changing persistence semantics.
4. MCP exposes/adopts the same context/validator while retaining existing confirmation and write-permission rules.
5. Any schema/revision-lineage changes only if independently justified after the core contract is agreed.

## Questions for the maintainer

1. Does upstream want web generation and MCP program design to share one explicit domain contract, or should the two paths remain intentionally independent?
2. Which inputs belong in the canonical design context: recent sessions, records, goals, recovery/readiness, active gym inventory, existing program, exercise preferences, and/or other data?
3. Should the methodology be a versioned machine-readable rules object, prose instructions, or both?
4. Which constraints should be deterministic validation errors versus warnings for the AI/user to resolve?
5. Should MCP receive the complete design context in one dedicated tool, extend `get_training_context`, or compose existing read tools?
6. Should validation be exposed as a read-only MCP tool so an agent can validate a draft before asking for confirmation?
7. Is revision lineage desirable in the same initiative, or should persistence/versioning remain a separate proposal?

## Non-goals

- No automatic program activation.
- No bypass of existing MCP confirmation/write authorization.
- No local NotebookLM dependency or policy.
- No attempt to upstream the full historical local commit stack.
- No design issue or code PR should be opened from this draft without an explicit decision to proceed.
