# Android error and warning contract

Android user-facing failures use one application error contract. Primary UI
must never render a server response, `Throwable.message`, exception class,
endpoint, JSON body, sync discriminator, operation enum, or stack trace.

Every primary message answers three questions:

1. What failed.
2. Whether the attempted data is saved locally, queued, not saved, or cannot be
   confirmed.
3. What the user can safely do next.

Technical evidence remains available separately. A blocked synchronization
card has explicit **Technical details** and **Download error report** actions.
Failures routed through the central presentation layer and Settings network
failures are recorded as sanitized diagnostic events and are available from
Settings > Incident diagnostics. Operation-specific fixed workout messages keep
their existing no-raw-error contract.

## Category and recovery mapping

| Category | Typical evidence | Retry | Primary recovery |
| --- | --- | --- | --- |
| `OFFLINE` | no active network, DNS/connect failure | yes | retry when a connection is available |
| `TIMEOUT` | socket/HTTP 408 timeout | yes | retry |
| `SERVER_TEMPORARY` | HTTP 429/5xx, temporary TLS/transport failure | yes | retry later |
| `AUTH_REQUIRED` | HTTP 401/403 or expired mobile session | no automatic retry | sign in again; preserve queued local changes |
| `APP_UPDATE_REQUIRED` | HTTP 426 | no | update the app |
| `CLIENT_SERVER_INCOMPATIBLE` | unsupported response, schema or discriminator mismatch | no | update app/server together; report if no update exists |
| `VALIDATION_OR_LEGACY_OPERATION` | permanent 4xx validation or rejected legacy mutation | no | review input or remove only the blocked queue item |
| `CONFLICT` | HTTP 409 or stale revision | yes after refresh | reload authoritative data, then retry |
| `NOT_FOUND_OR_DELETED` | HTTP 404/410 or deleted entity | no blind retry | refresh or remove only the impossible queued operation |
| `LOCAL_STORAGE` | Room/SQLite or local persistence failure | no | preserve existing data, export diagnostics, contact the developer |
| `PERMISSION_OR_FILE_EXPORT` | Android file picker or URI read/write failure | yes with a new target | choose another file or location |
| `UNKNOWN` | unclassified exception | no blind retry | verify the relevant screen and send a report |

Permanent schema and validation failures do not receive an unlimited retry
action. A retryable blocked operation shows **Retry**. A permanent operation
instead directs the user to update GymCoach or delete only that operation after
reviewing the consequences.

## Surface inventory

| Surface | Data-state rule | Recovery UI |
| --- | --- | --- |
| Home sync queue and rejection card | exact blocked item is `QUEUED_LOCALLY`; all other queue items stay available | retry only when retryable, exact deletion-scope confirmation, technical details, TXT report |
| Automatic/manual sync snackbar | durable outbox is `QUEUED_LOCALLY` | friendly retry/sign-in/update instruction |
| Login | credentials are not retained as error evidence; failed action is `NOT_SAVED` | field correction, retry, update/server guidance |
| Workout set/save/finish actions | uses operation-specific fixed copy; never exposes repository exceptions | retry while preserving the values stated by the operation contract |
| History/calendar and completed-session editing | cached history remains available; uncertain mutation results are labelled `UNKNOWN` | reload and verify before repeating |
| Programs and exercise catalog | cached content remains available for reads; mutation result is `UNKNOWN` until reload | reload or retry using central friendly mapping |
| Progress dashboard | mutation result is `UNKNOWN` until refresh | refresh before repeating |
| Coach and chat | existing conversations/context remain available; failed writes are `NOT_SAVED` or `UNKNOWN` | retry; failed chat input is restored |
| Settings, backup, import/export and APK update | settings-specific server categories remain friendly; file failures are `NOT_SAVED` | retry server actions or choose another system file target |
| Huawei Watch status | queue remains durable | primary status is friendly; protocol error code appears only in Technical details |
| Calibration and recommendation failures | no raw exception path; existing safe fixed copy remains authoritative | keep current training data and retry without changing calculation rules |

`UserFacingErrorGuardTest` prevents direct throwable/server-message rendering in
primary Android UI. Category, retryability, redaction, report generation,
exact-scope deletion, RU/EN copy, large-font behavior, and the original
`Invalid discriminator value` scenario have dedicated regression coverage.

Deletion scope is derived from the same decoded queue operation and local
session lookup used by the repository mutation. Most failures remove only the
blocked operation. A rejected offline session start, or a session-scoped change
whose server session no longer exists, instead warns that the unsynchronized
local workout, its sets, and related queued operations will be removed.

## Error report format and privacy

The synchronization card exports a UTF-8 TXT file through Android's system
document picker. It starts with a short human-readable summary and embeds a
pretty-printed JSON section for a developer or an analysis assistant.

When available, the report contains:

- UTC and local timestamps;
- app package, version name/code, build type, and `SOURCE_COMMIT`;
- Android/API version, manufacturer/model, locale, timezone, and coarse network
  state;
- safe category/code, retryability, data state, operation type, queue item ID,
  attempts and queue timestamps;
- HTTP status and safe correlation ID;
- sanitized server response and bounded sanitized stack trace;
- current pending count and the latest bounded diagnostic events.

Central redaction runs before report output. It removes Authorization/Bearer
values, access and refresh tokens, passwords, cookies, email addresses, JWTs,
medical/passport/injury/note/payload values, and private Windows or Unix home
paths. The report never includes the raw database, request payload, photos,
credentials, cookies, or authentication headers.
