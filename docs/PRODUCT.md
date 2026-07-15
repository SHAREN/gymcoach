# GymCoach Product

Status: canonical product orientation for Codex task preflight. Detailed product
direction lives in `docs/PROJECT_GOALS.md`. Training formulas and safety
boundaries live in `docs/ai-coach-principles.md`. Source code, schemas, and
tests remain authoritative for implemented behavior.

## Purpose

GymCoach is an open source, self-hosted training tracker with an optional AI
coach. It helps a trainee plan workouts, record sessions, review progress, and
make decisions from actual history, available equipment, and recovery context.
The core workout flow must remain useful without an AI provider and must
degrade safely when network access is unavailable.

## Primary Product Surfaces

- Web and PWA application for programs, workout logging, history, progress,
  imports, settings, and coaching.
- Next.js API and PostgreSQL data layer with authentication, ownership checks,
  Zod validation, and Prisma migrations.
- Native Android application with Room-backed offline workout state, ordered
  synchronization, shared mobile contracts, and published APK metadata.
- Huawei Lite Wearable companion with a file-backed offline runtime, durable
  phone/watch messaging, Previewer harness, and Android Wear Engine transport.
- Optional provider-neutral AI coach and token-scoped MCP interface.
- Self-hosting, backup, verification, deployment, and release tooling.

## Critical User Scenarios

1. Authenticate and access only the current user's data.
2. Create, activate, and run a training program.
3. Record, edit, finish, and recover a workout without silent set loss.
4. Continue supported Android workout operations offline and synchronize them
   safely when connectivity returns.
5. Preserve durable watch commands and events across transient transport or
   process failures.
6. Review history, equipment-specific loads, progress, records, and body data.
7. Import, export, back up, and restore user-owned training data.
8. Use deterministic guidance without an LLM, and optional AI guidance only
   through validated, user-scoped context.
9. Download Android builds whose version, size, and SHA-256 metadata match the
   published APK.

## Product Contracts

- Every user-owned read and write remains scoped to the authenticated user.
- API inputs and AI-produced write payloads are validated before persistence.
- Offline and synchronization failures remain visible and never silently erase
  newer local work.
- Shared web, Android, and watch identifiers, units, ordering, and equipment
  semantics remain compatible.
- Available equipment constrains selectable and recommended loads where the
  relevant workflow supports equipment-aware behavior.
- AI is optional. Core workout tracking and deterministic calculations do not
  require a model provider.
- Training-methodology changes follow the NotebookLM workflow in `AGENTS.md`
  and update `docs/ai-coach-principles.md`.
- GymCoach does not diagnose, treat, or rehabilitate illness or injury.
- Secrets, private environment files, signing material, credentials, and
  personal data are never committed or copied into task records.
- The canonical Home PC runtime is `http://192.168.0.119:3030`; deployment or
  restart requires separate authority.

## Conscious Non-Goals

- Requiring an AI provider for ordinary workout tracking.
- Presenting generated thresholds or formulas as settled training science.
- Acting as a medical or rehabilitation product.
- Building a product-facing task-management system to replace Beads.
- Enabling Huawei hardware capabilities without the required service approval,
  permissions, signing, and physical-device validation.

Open question: social networking, public leaderboards, and a hosted subscription
service have no owner-confirmed product goal. Treat them as out of scope unless
they are captured and prepared as explicit Beads work.
