# Mobile Settings diagnostics retention

Mobile Settings request events are written by the Node route handlers to the
dedicated `mobile-settings-diagnostics` Docker volume. They are not duplicated
to Docker stdout when the production store is configured.

The checked-in policy is enforced by `lib/mobile-settings-diagnostic-store.ts`:

- maximum age: 24 hours, with startup and append pruning plus a 60-second sweep;
- maximum count: 500 events;
- maximum encoded size: 128 KiB;
- one sanitized JSON file per event, written atomically with owner-only mode.

The store rejects mobile access-token shapes and 64-character hexadecimal token
hash shapes before persistence. Invalid, expired, future-dated and excess owned
event files are removed by the same retention pass. Unrelated files are never
deleted.

`scripts/collect-mobile-settings-incident.mjs` reads this store through a fixed,
read-only `docker exec` command, then applies its own 24-hour, 100-event and
128-KiB output bounds. Docker's `json-file` size/count rotation remains for
ordinary server output, but structured mobile Settings events use only the
age-bounded dedicated store.
