# TICKET-005: Replace the history list with a monthly training calendar

Status: Open
Type: Feature redesign
Priority: High
Area: History, navigation, mobile UX, Android parity
Reported: 2026-07-13

## Summary

Redesign the main History tab as a full monthly calendar instead of a reverse chronological card list.

When the athlete opens History, the current month must fill the primary view. Days that contain completed workouts must be visibly marked. Selecting a marked day must let the athlete open the workout or workouts recorded on that date.

The existing session detail page at `/history/[id]` remains the destination for an individual workout and does not need a full redesign as part of this ticket.

## Current behavior

The current `app/(app)/history/page.tsx` implementation:

- Displays a reverse chronological list of finished sessions.
- Supports program and month filters.
- Limits the query to 100 sessions.
- Uses a month dropdown containing only the most recent 12 months.
- Links each list card to the existing `/history/[id]` detail page.
- Builds month query boundaries with UTC dates.

This is useful as a searchable list, but it does not provide an immediate visual overview of training consistency across a month.

## Desired primary experience

1. Open the History tab.
2. See a calendar for the current month.
3. See clear markers on every date that contains one or more completed sessions.
4. Move to previous or next months with large touch-friendly controls.
5. Tap a date with a workout.
6. If the date has one session, open that session directly or expose a single obvious session card.
7. If the date has several sessions, show a day panel or list and let the athlete choose one.
8. Open the existing workout detail page.

The implementation should choose one consistent interaction pattern. A recommended mobile pattern is to select the day and show its session cards directly below the calendar. Direct navigation for a single session is acceptable only if it does not make multi-session days behave confusingly.

## Calendar layout

- Month and year header.
- Previous month button.
- Next month button.
- Today button that returns to the current month and selects today.
- Seven weekday columns.
- Locale-aware weekday labels and week start. Russian should start on Monday.
- A stable five-row or six-row month grid without layout jumps.
- Days outside the active month shown as muted cells or blank placeholders.
- Today visually distinguished from the selected day.
- Selected day visually distinct even when it has no workout.
- Touch targets of at least the existing app minimum tap size.

Do not add a calendar dependency unless it is clearly necessary. The repository currently has no `react-day-picker` or `date-fns` dependency, and this view can be implemented as a focused CSS grid with native date helpers.

## Workout markers

Each day with completed history must have a clear marker. The minimum acceptable marker is a dot or filled accent.

For several sessions on one date, show either:

- A numeric count badge, or
- Several compact markers up to a sensible visual limit.

The marker must not depend on color alone. Include an accessible label such as `2 workouts`.

Optional follow-up behavior, not required for the first version:

- Distinguish strength and cardio sessions with separate marker styles.
- Show a small completion or volume summary inside the day cell.

## Selected day content

Below the calendar, show the sessions for the selected date.

Each session card should preserve the useful information already calculated by the existing list:

- Workout or activity name.
- Start time.
- Program name when present.
- Working set count for strength sessions.
- Volume for strength sessions.
- Duration.
- Distance and heart rate for cardio sessions when available.
- A clear link to `/history/[id]`.

If the selected date has no completed sessions, show a compact empty message rather than the full-page empty state.

If the account has no history at all, preserve the existing first-session empty state.

## Filters and export

- Keep the program filter.
- Remove the separate month dropdown because the calendar header becomes the month selector.
- Preserve the selected month in the URL as `month=YYYY-MM` so refresh, browser navigation, and deep links work.
- Preserve `programId` while changing months.
- CSV export must respect the visible month and active program filter.
- A future list-view toggle may be added separately, but the calendar is the default and primary History view.

## Date and timezone correctness

Sessions must be grouped into calendar days according to the athlete's local calendar date, not an accidental UTC date.

The current code constructs UTC month boundaries, while the profile does not appear to store a timezone. The implementation must establish one deterministic source of timezone truth, for example:

- A persisted user timezone, or
- A browser timezone submitted to the server and used consistently.

Acceptance requires correct behavior for sessions near midnight and during timezone offset changes. Do not group by formatting a UTC timestamp on one side while filtering it with different timezone semantics on the other.

## Data loading and performance

- Query the visible month range instead of taking an arbitrary latest 100 sessions.
- Load only the fields required for calendar markers and selected-day summaries.
- The calendar must support navigating to any month that contains history, not only the most recent 12 months.
- Month navigation must not load the entire training history.
- Avoid a separate request per calendar day.
- Several sessions on one day must be supported.

A server-rendered month payload with a small client calendar component is acceptable. A route or server action for month changes is also acceptable, provided browser history and loading states remain clear.

## Mobile and interaction requirements

- The month grid must fit a narrow phone screen without horizontal scrolling.
- Day numbers and markers must remain readable at Android phone widths.
- Month navigation must not cause the page to jump unpredictably.
- Show a loading state while changing months.
- Preserve the selected month and day when returning from a session detail page where practical.
- Android and web must expose equivalent calendar navigation and day selection behavior.
- Offline Android history should use locally available synchronized sessions and update after sync.

## Accessibility

- Calendar controls must have accessible labels.
- The grid must expose meaningful day labels including date and workout count.
- Keyboard users must be able to move between days and activate a selected date on web.
- Today, selected date, and workout markers must not be conveyed by color alone.
- Localized month and weekday names must be used.

## Acceptance criteria

- History opens on the current month by default.
- The screen shows a complete monthly calendar grid.
- Every completed session in the visible month marks the correct local date.
- Previous, next, and Today controls work.
- The visible month is reflected in `month=YYYY-MM`.
- Program filtering remains available and updates calendar markers and day summaries.
- Selecting a date shows all completed sessions for that date.
- Selecting a session opens the existing `/history/[id]` page.
- Multiple sessions on one date are represented and individually accessible.
- A date without sessions shows a compact day-level empty state.
- An account with no sessions keeps the existing global empty state.
- CSV export uses the visible month and selected program.
- Navigation is not restricted to the latest 12 months.
- The query has no arbitrary 100-session truncation within the visible month.
- Sessions around local midnight appear on the correct date.
- The calendar works on narrow mobile screens without horizontal scrolling.
- Web and Android provide equivalent core behavior.

## Test coverage

Add focused tests for:

- Month grid generation for 28, 29, 30, and 31-day months.
- Months starting on each weekday.
- Locale-aware Monday-first layout for Russian.
- Previous, next, and Today navigation.
- URL month state and browser navigation.
- Program filter preservation across month changes.
- One session on a day.
- Several sessions on one day.
- Empty selected day.
- Empty account history.
- A session close to midnight under a non-UTC timezone.
- CSV link generation for the visible month.
- Mobile layout and accessible workout-count labels.

## Likely implementation areas

- `app/(app)/history/page.tsx`
- New client component under `components/history/`, such as `history-calendar.tsx`
- `components/history/history-filters.tsx`
- History translations under `messages/en/history.ts` and `messages/ru/history.ts`
- History page component tests
- History query helpers or a focused month-range utility
- Android history screen and synchronized history models

## Out of scope

- Redesigning the individual `/history/[id]` workout detail page.
- Editing workouts directly from the calendar.
- Scheduling future planned workouts in the history calendar.
- Adding bodyweight, measurements, or readiness events to the calendar.
- Advanced heat maps or yearly views.
