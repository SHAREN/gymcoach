# Current Milestone

Last reviewed: 2026-07-16

## Milestone State

Open question: there is no owner-confirmed current milestone recorded in this
repository.

Do not infer a milestone from the active branch, recent commits, open tasks, or
the largest product surface. Until the owner confirms a goal, `next-task` must
state that milestone alignment cannot be enforced and apply its remaining
dependency, priority, age, and parallel-safety rules.

## Source of Work

- Beads is the source of truth for task status, priority, scope, dependencies,
  and acceptance criteria.
- This document records product direction only. It is not a task list and must
  not be used to bypass `stage:ready` or dependency checks.
- Active or recently completed work does not establish the next milestone.

## Rules That Apply Without a Confirmed Milestone

- Select only blocker-free tasks with `stage:ready` and complete acceptance
  criteria.
- Preserve one Beads task, Codex task, branch, and worktree per implementation.
- Serialize uncertain or overlapping files, APIs, schemas, mobile contracts,
  training formulas, and deployment surfaces.
- Follow all security, user-scoping, verification, training-science, Android,
  Huawei, and deployment rules in `AGENTS.md`.
- Do not push, merge main/master, deploy, restart, or synchronize Beads remotely
  without separate authority.

## Confirming the Next Milestone

When the owner confirms the next development goal, update this file with:

1. the owner-confirmed goal;
2. the expected user-visible result;
3. product areas explicitly in and out of scope;
4. required ordering or integration constraints;
5. the main product, data-loss, security, cross-platform, and deployment risks.

Then triage matching Beads tasks so their descriptions or acceptance criteria
provide evidence of milestone alignment. Do not treat a title alone as that
evidence.
