# TICKET-004: Rest timer must not block workout navigation or input

Status: Open
Type: Bug
Priority: High
Area: Session runner, rest timer, mobile UX, Android parity
Reported: 2026-07-13

## Summary

Starting a rest timer after a completed set currently puts the whole session runner into a blocking `rest` mode. While the timer is active, the athlete cannot switch exercises through the exercise strip or the previous and next controls, and normal set input is disabled.

The rest timer should be a non-blocking background session utility. It must remain visible and continue counting down without preventing the athlete from navigating, reviewing exercises, editing or recording sets, or using other workout functionality.

The separate idea of automatically writing the displayed next-set recommendation into the active table row is explicitly out of scope for this ticket.

## User-visible evidence

- `1000196963.png` shows an active 82-second rest timer below the exercise table.
- The exercise strip is visible, but exercise switching is disabled while the timer runs.
- The timer displays a next-set recommendation of `40 kg x 10, RIR 2`.

The screenshot is attached to the originating ChatGPT conversation and has not yet been copied into the repository.

## Current behavior

1. Complete and confirm a working set.
2. GymCoach starts the rest timer.
3. The global session mode changes from `input` to `rest`.
4. Exercise thumbnails cannot be selected.
5. Previous and next exercise buttons are disabled.
6. Set input and editing controls are disabled until the timer ends or the user presses Skip.

## Expected behavior

The timer must continue independently from the currently selected exercise and from whether the athlete is interacting with the workout.

During an active timer, the athlete must be able to:

- Switch to any exercise from the exercise strip.
- Use previous and next exercise navigation.
- Open exercise details and the exercise menu.
- Review, edit, delete, or record sets where those actions are normally available.
- Open the in-session coach chat.
- Finish the workout.
- Add 30 seconds or skip the timer.

The timer may be presented as a compact sticky card, collapsible panel, floating control, or another non-blocking element. The exact visual design is secondary to preserving session functionality.

## Technical findings

The blocking behavior is explicit in `components/session/session-runner.tsx`:

- `Mode` treats `input` and `rest` as mutually exclusive global states.
- `SessionExerciseStrip` receives `disabled={mode.kind !== 'input'}`.
- `EditableSetsTable` receives `disabled={!hydrated || mode.kind !== 'input'}`.
- Previous and next buttons are disabled when `mode.kind !== 'input'`.
- Cardio input is replaced entirely by `RestTimer` while in rest mode.
- `handleRestEnd()` may automatically select `nextExerciseIdx`, which could unexpectedly override a manual exercise change after navigation is enabled.

The implementation should separate timer state from interaction state. A running timer is not a session navigation mode.

## Required state behavior

- Rest timing state must coexist with normal workout input state.
- Switching exercises must not cancel, reset, or pause the timer unless the athlete explicitly does so.
- Timer expiry must not pull the athlete away from an exercise they manually selected during the countdown.
- The end sound and vibration must still fire once.
- Add 30 seconds and Skip must remain available from the current screen.
- Starting or confirming another set while a timer is active must have a deterministic rule and must not create conflicting timers.

A reasonable first-version rule is one session-wide timer: confirming a newer set replaces or restarts the active timer using the newer set's rest prescription. If a different rule is chosen, it must be explicit and tested.

## Acceptance criteria

- After confirming a set, the timer starts and the exercise strip remains interactive.
- The athlete can switch to another exercise while the countdown continues.
- The athlete can enter and confirm a set on another exercise without first skipping the timer.
- The athlete can use previous and next navigation while the timer is active.
- The athlete can open exercise details, session menus, coach chat, and the finish flow while the timer is active.
- The active countdown remains visible or reachable after switching exercises.
- Timer expiry after a manual exercise switch does not change the selected exercise.
- Skip ends only the timer and does not cause unexpected navigation.
- Add 30 seconds changes the same active countdown regardless of the selected exercise.
- The completion beep and vibration fire once.
- Superset auto-advance behavior remains correct, but it does not lock manual navigation.
- Cardio and strength exercises follow the same non-blocking timer principle.
- Web and Android behavior are consistent.
- No change is made to automatic recommendation insertion in this ticket.

## Test coverage

Add focused component or integration tests for:

- Exercise strip selection during an active timer.
- Previous and next navigation during an active timer.
- Timer expiry after the user manually selects another exercise.
- Skip after a manual exercise change.
- Add 30 seconds after a manual exercise change.
- Recording a new set while an older timer is active.
- One completion sound and vibration event.
- Standalone, superset transition, and cardio rest flows.

## Likely implementation areas

- `components/session/session-runner.tsx`
- `components/session/rest-timer.tsx`
- `components/session/session-exercise-strip.tsx`
- `components/session/rest-timer.test.tsx`
- Session runner component tests or new focused tests
- Android session and timer state implementation
