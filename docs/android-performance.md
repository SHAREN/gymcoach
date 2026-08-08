# Android performance contract

GymCoach publishes an R8-minified, resource-shrunk `release` APK. Debug APKs
remain local regression artifacts and must never replace the downloadable
distribution. The release build consumes the checked-in Baseline Profile from
`android/app/src/release/generated/baselineProfiles/baseline-prof.txt`.

Regenerate the profile only on the Android emulator with:

```powershell
cd android
.\gradlew.bat :app:generateReleaseBaselineProfile
```

The generator records startup plus deterministic Home, Workout, Settings,
exercise catalog, History and Programs flows. Its two benchmark activities are
disabled in the release manifest; the profile test temporarily enables them
through ADB. The non-debug `performance` variant uses release runtime behavior
and profile inputs, but deliberately keeps shrinking disabled so benchmark
symbols and the before/after comparison remain stable. It is signed with the
debug key and has a benchmark application id, so it cannot be published
accidentally. The actual distribution is separately verified with release R8
and resource shrinking.

## 2026-08-08 benchmark

Device: `emulator-5554`, 1440×3120, actual 60 Hz. The emulator cannot run at
120 Hz, so `framesOver8Ms120HzBudgetProxy` is only a strict 8.33 ms proxy. At
60 Hz virtually every rendered frame occupies more than 8.33 ms; the proxy
must not be reported as a real 120 Hz result.

Each screen used 12 identical down/up swipe pairs, `gfxinfo`, `simpleperf` and
benchmark-only composition counters. A cold restart of the same AVD was
required after the long profile-generation session because a control run of
the old APK proved that the hours-old emulator process itself had degraded.
The final after set was then collected consecutively without reinstalling
between screens.

The table preserves the originally captured pre-change baseline as required,
but its absolute improvement must not be attributed entirely to code because
the after set followed that cold AVD restart. A same-cold Home control of the
older APK measured p50/p90/p99 17/18/25 ms and 25/324 deadline misses; the final
current-code APK measured 17/18/21 ms and 24/326. Code-specific evidence therefore comes
from that same-cold tail/jank improvement, the removed catalog parsing hotspot,
the off-main serialization tests and the isolated destination composition
counters, not from the full headline delta alone.

| Screen | Before deadline missed | After deadline missed | Before p50/p90 | After p50/p90 |
| --- | ---: | ---: | ---: | ---: |
| Home | 131/151 (86.8%) | 24/326 (7.4%) | 53/77 ms | 17/18 ms |
| Workout | 65/130 (50.0%) | 14/155 (9.0%) | 32/53 ms | 17/19 ms |
| Settings | 130/286 (45.5%) | 20/366 (5.5%) | 34/53 ms | 17/18 ms |
| Catalog | 138/280 (49.3%) | 9/375 (2.4%) | 40/61 ms | 17/18 ms |
| History | 118/281 (42.0%) | 24/341 (7.0%) | 34/57 ms | 17/21 ms |
| Programs | 122/289 (42.2%) | 18/355 (5.1%) | 34/53 ms | 17/18 ms |

The final after counters recorded zero destination-screen recompositions after
the measurement reset while 379–401 benchmark-only root pulses occurred. Catalog
profiling no longer repeatedly parses `exercise-media.json`; bootstrap and
progress cache serialization runs on `Dispatchers.Default`; and the 250 ms rest
countdown owns its state inside the timer section instead of invalidating the
whole Workout screen.
