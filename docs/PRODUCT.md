# GymCoach Product

Status: durable product summary. Detailed product direction remains in
docs/PROJECT_GOALS.md. Training formulas and safety boundaries remain in
docs/ai-coach-principles.md.

## Purpose

GymCoach is an open source, self-hosted training tracker with an optional AI
coach. It helps a trainee plan workouts, record sessions, review progress, and
make training decisions from actual history, available equipment, and recovery
context. The core workout flow must remain useful without an AI provider.

## Primary Users

- Trainees who want to keep their training data on infrastructure they control.
- Trainees who need fast strength and cardio logging, progress analysis, and
  optional AI-assisted coaching.
- Self-hosters and maintainers who operate the web, database, Android, and AI
  integrations.

Assumption: a deployment may serve more than one user because the current
application implements registration, authentication, and per-user data
isolation.

## Critical User Scenarios

1. Sign in and access only the current user's data.
2. Start, record, edit, and finish a workout without losing set data.
3. Continue the core Android workout flow offline, then synchronize safely.
4. Resume a session after a weak connection, refresh, or application restart.
5. Review history, progress, records, workload, and body measurements.
6. Create, edit, activate, and run training programs.
7. Use deterministic training guidance without requiring an LLM.
8. Use an optional AI coach or MCP client with validated, user-scoped context.
9. Import, export, back up, and restore user-owned training data.
10. Download the currently published Android APK when native Android changes
    have shipped.

## Main Product Modules

- Web and PWA interface: Next.js App Router pages and React components.
- Backend API: Next.js route handlers with Zod validation and ownership checks.
- Training and progress logic: shared TypeScript modules under lib.
- Data layer: Prisma with PostgreSQL, plus Dexie for the PWA offline flow.
- AI and MCP: provider-neutral LLM interface, prompts, validation, and MCP tools.
- Native Android app: Kotlin, Compose, Room, WorkManager, and local training
  calculations.
- Operations: Docker Compose, deployment scripts, verification, backup, and APK
  publishing.

## Important Constraints

- User data must remain scoped to the authenticated user.
- Product code, documentation, prompts, and user-visible source text are
  English unless a localization file intentionally contains another language.
- API inputs and AI-produced write payloads require validation before storage.
- Core workout logging must degrade safely when AI or internet access is
  unavailable.
- Training-methodology decisions require the NotebookLM workflow in AGENTS.md.
- GymCoach must not diagnose or treat illness or injury.
- Native Android and web behavior must remain compatible where they share API
  or deterministic training contracts.
- The canonical Home PC runtime is port 3030, with the configured public HTTPS
  route proxying to it.
- Secrets, tokens, private environment files, keys, and personal data must not
  be committed or copied into task records.

## Conscious Non-Goals

- Requiring an AI provider for normal workout tracking.
- Acting as a medical, rehabilitation, injury-diagnosis, or treatment product.
- Sending users' raw training databases directly to an LLM.
- Building a separate task-management web application for project development.
- Replacing source-backed coaching principles with generated formulas presented
  as settled science.

Open question: the repository does not define a product goal for social
networking, public leaderboards, or a hosted subscription service. Treat these
as out of scope unless the owner creates and prepares a Beads task.

## Critical Bug Definition

A critical bug is a P0 issue. It includes:

- confirmed or imminent user data loss or corruption;
- a critical security vulnerability or cross-user data exposure;
- complete unavailability of a core function such as authentication, workout
  recording, workout completion, or required synchronization.

A severe but partially usable failure is normally P1. Ordinary defects and
meaningful improvements are P2. Cosmetic issues, ideas, and technical debt are
P3. Deployment defects use the same impact definitions; staleness alone does
not make an issue P0.
