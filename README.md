# GymCoach Android archive

This repository is the history-preserving extraction of the native Android and Huawei Watch work that previously lived inside `SHAREN/gymcoach`.

## Status

Frozen / archival. The actively maintained GymCoach product is the clean web/server repository. This repository exists so the Android/Huawei implementation and its Git history are not lost.

Source lineage:

- source repository: `SHAREN/gymcoach`
- source branch: `codex/huawei-watch-companion`
- source commit before filtering: `25a784380910a6e0056b2df93bd5caf1e525341e`
- history extraction: `git filter-repo` with degenerate merge preservation; the former `android/` directory is now the repository root
- Huawei companion remains in `huawei-watch-app/`
- shared phone/watch protocol contracts remain in `shared-contracts/`

The filtered history intentionally does not contain the old web application, `/api/mobile/*`, `/api/android/*`, or other server runtime. Some historical documentation may still refer to the former monorepo layout.

## Repository layout

- `app/` — native Android application
- `gradle/`, `gradlew`, `settings.gradle.kts` — Android Gradle project
- `huawei-watch-app/` — Huawei Watch companion / preview harness
- `shared-contracts/` — versioned phone/watch protocol schemas, examples and fixtures
- `docs/` — Android/Huawei architecture, offline and testing notes
- `scripts/` — retained Android-specific verification/release helpers

## Standalone-build adjustments

The original monorepo regenerated the Android Russian exercise dictionary from the web `i18n/` tree before every build and automatically copied debug APKs into the web server release directory. Those monorepo hooks are deliberately disabled here:

- the generated Russian dictionary already committed under `app/src/main/.../ExerciseNamesRu.generated.kt` is retained as the frozen source;
- ordinary `assembleDebug` only builds the APK and does not publish into a web runtime;
- `scripts/publish-android-apk.mjs` remains a manual archival helper and writes to `data/android-release/` when explicitly invoked.

## Android verification

Requires JDK 17 and an Android SDK compatible with compile SDK 35.

```bash
./gradlew testDebugUnitTest
./gradlew assembleDebug
```

Instrumentation/auth-upgrade verification still requires an Android emulator and the SDK command-line tools. See `scripts/verify-android-auth-upgrade.ps1`.

## Shared contract verification

```bash
node shared-contracts/test-contracts.mjs
```

## Huawei companion verification

```bash
cd huawei-watch-app
npm ci
npm run check
```

Device packaging/install also requires the matching Huawei/DevEco toolchain described in `docs/`.

## Server compatibility

This is an archived client snapshot. Its network layer was developed against the legacy GymCoach mobile/server API that existed in the source monorepo. The current clean web/server branch is intentionally not required to keep those archived mobile endpoints. Do not assume this client can be pointed at a newer server without a compatibility review.

## Security

`local.properties`, build outputs and release APK/metadata are ignored. No signing keystore or private key is intentionally stored in this repository. The filtered Git history is scanned for secrets before publication.

## License

See `LICENSE`.
