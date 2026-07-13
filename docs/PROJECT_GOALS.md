# GymCoach project goals

Status: living product requirements captured from owner discussions.

This document describes the desired product direction. It does not claim that
every capability is already shipped. Implementation status, behavioral details
and training-calculation rules belong in the relevant design documents, tests
and `ai-coach-principles.md`.

## Product mission

GymCoach is a self-hosted strength-training tracker and AI coach. It helps a
trainee plan, perform, review and improve training using actual history,
available equipment and recovery context. The core workout flow must remain
useful without AI or internet connection, while AI expands analysis and program
design when a trusted provider is available.

## Core outcomes

### Adaptive, transparent coaching

- Generate, extend, revise and analyze programs from structured user data, not
  a generic template.
- Recalculate the next working set after each completed set where the selected
  autoregulation mode requires it.
- Use load, repetitions, RIR, rest, supersets, exercise type, equipment,
  history and recovery data when available.
- Preserve two deterministic autoregulation modes with bounded per-exercise
  coefficients selected during program design.
- Explain material recommendations and let the user apply, edit or ignore them.
- Treat exercise-specific breaks and muscle-group continuity separately. Work
  for the same muscle in another exercise can inform readiness, but must never
  become an exact load conversion.
- Detect practical workload and recovery risks, including sudden stress rises,
  falling performance and persistent poor recovery. Do not present a catabolism
  percentage, CNS-fatigue score or medical diagnosis as fact.

### Fast in-session workflow

- Run a workout from a horizontally scrollable strip of exercise thumbnails.
  The active exercise is distinct and the others are dimmed.
- Tapping another thumbnail changes the active exercise. Tapping the current
  thumbnail opens its detail page, and returning restores the session and the
  selected exercise.
- Show supersets as connected thumbnails and move immediately to the next
  exercise in a superset after confirming a set, then start its rest timer.
- Record weight, repetitions and RIR directly in the set table. Prior results
  can prefill editable draft values.
- Keep the confirmation control only for the current working set. Editing a
  completed set saves directly and never creates a second confirmation state.
- Let the athlete apply the current recommendation from the set number, then
  restore that option when a relevant value is manually edited.
- Show the prior workout below the current table and link to full history and
  progress charts.

### Program controls during a session

- Change planned set count and undo the last completed set when appropriate.
- Replace an exercise from a list prefiltered by its primary muscle group.
- Create, join and break supersets without rebuilding the whole workout.
- Show notes only when a meaningful athlete or coach note exists.
- Keep exercise titles compact. Technique, muscles and history belong on the
  exercise detail page rather than being duplicated in the session screen.

### Accurate gym and equipment modeling

- Support multiple saved gyms and make the selected gym part of every workout
  decision.
- Model machines, bars, plates, dumbbells and irregular available weights. One
  gym can have non-uniform dumbbells and equipment absent from another gym.
- Apply equipment settings to all relevant exercises or to the current exercise,
  always scoped to the active gym.
- Restrict proposed and selectable loads to real available equipment.
- Provide a custom weight picker with explicit confirmation, an available-weight
  tape and a right-side barbell diagram using `(total load - bar weight) / 2`.
- Let the user edit bar weight, plate denominations, dumbbell ranges and
  individual odd dumbbell values.
- Maintain an initial Olimp gym profile from imported user materials while
  allowing later corrections.

### Complete history and useful metrics

- Import Alpha Progression history while preserving dates, programs, loads,
  repetitions and RIR where available.
- Provide per-exercise history and charts, including estimated strength and
  volume.
- Let users choose `1RM + volume` or `10RM + volume`. Do not configure 1RM and
  10RM together in one metric view.
- Pass validated metrics and data confidence into program design instead of
  relying on raw text or an LLM's memory.

### Localization and exercise information

- Ship Russian and English interfaces, with translations outside business logic
  so contributors can add languages such as Spanish.
- Provide Russian exercise names and finish remaining user-visible translations.
- Show technique, target muscles, history and related information from one
  exercise detail page.
- Add properly licensed images, animations or videos for technique and clear
  photos or schematics for machines.

### AI, MCP and ChatGPT integration

- Use one shared program-design context for the internal LLM, MCP tools and
  ChatGPT-connected agents so they use the same validated metrics and methods.
- Support a configured OpenAI-compatible provider such as `codex-lb` without
  coupling the product to one model vendor.
- Expose MCP tools for reading relevant history, metrics, programs, gyms and
  equipment, and for preparing controlled edits.
- Allow an AI agent to inventory a gym from spoken descriptions or images,
  compare it with known equipment, add missing inventory through validated,
  reviewable changes and attach machine images.
- Support ChatGPT Developer Mode or comparable ChatGPT access through a secure
  MCP integration, plus other MCP-compatible agents.
- Treat program changes as reviewable drafts. MCP writes require confirmation.
  MCP can reduce duplicated context transfer, but is not inherently free.

### Offline-first Android application

- Deliver a real Android APK, not only a web wrapper.
- Continue logging workouts and calculating the next set offline, including
  timestamps, load, repetitions, RIR and other core fields.
- Synchronize when connectivity returns, preserving local work and resolving
  conflicts without silent data loss.
- Offer the same core experience as the web application when online. AI and MCP
  can be unavailable offline, but deterministic workout functions must remain.

### Self-hosting and operational quality

- Keep the app usable on the home network and through the configured public
  HTTPS route under `gymcoach7.sharteman.duckdns.org`.
- Preserve Docker, deployment, backup and local-development materials with the
  source so the service is reproducible on the home PC.
- Validate API input and AI-produced structures before persistence. Never put
  secrets, tokens or private environment files into GitHub.
- Run the project verification gate before commits and deploys. Keep focused
  commits and document material behavior changes.

## Coaching boundaries

- Training-methodology changes require NotebookLM research in the `ИИ тренер`
  notebook according to `AGENTS.md`, with the result recorded in
  `ai-coach-principles.md`.
- Source-backed principles and engineering heuristics must be labeled
  separately. Coefficients and thresholds are not universal physiology.
- GymCoach supports ordinary training decisions only. It must not diagnose,
  treat or rehabilitate illness or injury. Medical red flags require conservative
  guidance and an appropriate qualified professional.
- Safety, user constraints, real available equipment and recorded data override
  performance optimization and LLM prose.

## Delivery principle

Implement the product in small, testable vertical slices. Keep reusable coaching
logic separate from the UI, preserve the upstream architecture where practical,
and make advanced AI capabilities degrade gracefully to clear deterministic
workflow when data, a provider or internet access is unavailable.
