# GymCoach Huawei Watch companion

This directory is reserved for the standalone Huawei Lite Wearable project.
The existing Android project remains in `../android` and is not moved.

## Verified target

- Device family: HUAWEI WATCH GT series supported by Wear Engine as
  WATCH GT 3 and later models.
- Watch GT 4 classification: Lite Wearable is the supported working target,
  inferred from the official GT-series documentation. The exact device type,
  Wear Engine API level, P2P capability, and sensor list must be verified at
  runtime on the real watch.
- Language and UI: JavaScript, HML, and CSS.
- Planned compile SDK: Lite Wearable SDK 10.
- Official Wear Engine Lite Wearable SDK: 5.0.2.306.

## Current stage

Stage 1 contains the verified capability matrix, environment audit, shared
wire contracts, and architecture. The actual DevEco project will be created in
Stage 2 after the official SDK is available locally.

DevEco Studio and the Lite Wearable SDK are not installed on this workstation.
Huawei's official download center requires an interactive HUAWEI ID sign-in,
which must be completed by the repository owner. No third-party SDK or
installer will be used as a substitute.

See:

- `../docs/huawei-watch-gt4-capabilities.md`
- `../docs/huawei-development-environment.md`
- `../docs/huawei-watch-architecture.md`
- `../docs/huawei-watch-sync-protocol.md`
