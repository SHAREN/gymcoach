# Huawei Watch Development Environment

Last audited: 2026-07-15.

This is the current Windows development-machine inventory and setup record for the Huawei Watch GT 4 companion. DevEco Studio and the official SDKs were installed without changing the global Android toolchain or storing Huawei credentials. Certificates, Huawei service approval and device registration remain owner-controlled.

## Current machine inventory

| Component                         | Status                             | Version or path                                                                                         | Audit note                                                                                                                                                                                                    |
| --------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operating system                  | Available                          | Windows build `10.0.22631`                                                                              | Reported by the local command environment.                                                                                                                                                                    |
| Java runtime and compiler         | Available                          | Android: Eclipse Temurin `17.0.19+10`; DevEco: bundled JBR `21.0.8`                                     | Android remains on Temurin 17. DevEco Studio uses its bundled JBR 21.0.8, so the global Android JDK configuration was not changed.                                                                            |
| Android SDK                       | Available                          | `C:\Users\RENAT\AppData\Local\Android\Sdk`                                                              | Both `ANDROID_HOME` and `ANDROID_SDK_ROOT` point to this path.                                                                                                                                                |
| Android SDK command-line tools    | Available                          | `20.0`                                                                                                  | Installed under `cmdline-tools\latest`.                                                                                                                                                                       |
| ADB                               | Available                          | ADB `1.0.41`; platform-tools `37.0.0-14910828`                                                          | Executable: `C:\Users\RENAT\AppData\Local\Android\Sdk\platform-tools\adb.exe`.                                                                                                                                |
| Android Emulator                  | Available                          | `36.6.11.0`, build `15507667`                                                                           | Executable is present in the Android SDK.                                                                                                                                                                     |
| Android SDK platforms             | Available                          | API 34 and API 35                                                                                       | Installed platform directories are `android-34` and `android-35`.                                                                                                                                             |
| Android build tools               | Available                          | `34.0.0` and `35.0.0`                                                                                   | Suitable for the existing Android project as configured by that project.                                                                                                                                      |
| Android system image              | Available                          | Google APIs x86_64, API 34                                                                              | Used by the existing phone AVD.                                                                                                                                                                               |
| Android phone AVD                 | Available and running during audit | `PhoneWhisper_Pixel_7_Pro_API_34`; ADB device `emulator-5554`                                           | This can test Android-side synchronization and the development watch simulator. It cannot emulate Huawei Health, HMS Core, Wear Engine Bluetooth pairing, or a Watch GT 4.                                    |
| Android Gradle wrapper            | Available                          | Gradle `8.11.1`                                                                                         | Defined by `android/gradle/wrapper/gradle-wrapper.properties`. A separate system Gradle installation is not required.                                                                                         |
| Android Studio                    | Not usable in this audit           | No working `studio64.exe` found in the standard installation paths or registered installation inventory | Repair or install only from the official Android developer distribution if the IDE is needed. Command-line Android builds remain available.                                                                   |
| DevEco Studio                     | Installed and verified             | `6.1.1.280`; `D:\Program Files\Huawei\DevEco Studio`                                                  | Official wizard project sync, Hvigor build and Lite Wearable Previewer were verified. The installer could not extend the global PATH because the existing PATH exceeded 8192 bytes; no global PATH rewrite was performed. |
| DevEco HarmonyOS SDK             | Installed and verified             | `6.1.1.125`, API 24; `D:\Program Files\Huawei\DevEco Studio\sdk\default`                              | This is the platform SDK selected by the current official wizard. It is distinct from the Wear Engine Lite JavaScript SDK and does not establish the runtime API level of a physical GT 4.                     |
| Lite Wearable Wear Engine SDK    | Integrated                         | Official `5.0.2.306`; vendored `wearengine.js` SHA-256 `8C7F1100C840ABDB237991B0D436EF9AB49A215269C5FECDB3DD59FE63A71471` | The supplied archive is a source-library package, not a DevEco installer. Archive SHA-256: `64130A347647F00D734662523B5A26DACA015E87ECE7D5D916F19753759A1B56`. Huawei's download page still documents compile SDK 6 or 10, so the API 24 wizard mismatch remains a physical-device gate. |
| Wear Engine SDK                   | Integrated                         | Watch `5.0.2.306`; Android Maven `com.huawei.hms:wearengine:5.0.3.304`                                  | Android dependency resolves from Huawei Maven. Real P2P still requires Huawei App ID/service approval, matching package identities and signing fingerprints. |
| HUAWEI DevEco Assistant           | Missing                            | No installation found                                                                                   | Required by Huawei's documented fitness-watch real-device deployment workflow.                                                                                                                                |
| DevEco Previewer                  | Verified                           | Bundled with DevEco Studio `6.1.1.280`; round Lite Wearable profile                                     | Separate `huawei-watch-app/preview-harness` renders and accepts navigation, set start/completion and rest controls. It is not a Bluetooth, Wear Engine or sensor emulator. |
| Official full Watch GT 4 emulator | Not identified                     | None                                                                                                    | The reviewed Huawei documentation provides Previewer for Lite Wearable UI. Wear Engine, sensors, and lifecycle behavior still require the project simulator and real-device verification.                     |
| Huawei Health                     | Not present on the development PC  | Phone component                                                                                         | Install or update it on the paired Huawei or Android phone from an official Huawei source when real-watch testing begins.                                                                                     |
| HMS Core                          | Phone state not audited             | Phone component                                                                                         | The reviewed Wear Engine `5.0.3.304` documentation does not state a separate minimum HMS Core version. Do not treat the Android emulator as a substitute for Huawei Health and a paired physical watch. |

## Target toolchain

Use the following target without changing the existing Android toolchain unless Huawei's compatibility requirements force an isolated adjustment:

| Area                  | Target                                                                                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing Android app  | Keep its Gradle wrapper `8.11.1`, current Android SDK, and JDK 17 configuration.                                                                                |
| Watch project         | Separate `huawei-watch-app/` DevEco Studio project using the officially supported Lite Wearable JavaScript, HML, and CSS stack.                                 |
| Lite Wearable SDK     | Installed Wear Engine Lite SDK `5.0.2.306`; the generated project targets HarmonyOS 6.1.1/API 24. Huawei's compile-SDK 6/10 documentation mismatch remains a physical-device compatibility gate. |
| Phone-watch transport | Watch SDK `5.0.2.306` and Android SDK `5.0.3.304`; runtime activation remains conditional on service approval, App ID, package name and signing fingerprints. |
| Watch UI testing      | Separate system-API-free `preview-harness` for deterministic UI interaction; protocol and reconnect simulation remain in Node and Android tests.             |
| Android testing       | Existing API 34 phone AVD for Android UI, queues, conflicts, reconnect logic, and simulated sensor events.                                                      |
| Hardware verification | Physical Huawei Watch GT 4 paired to a compatible phone through Huawei Health.                                                                                  |

## Verified installation and remaining owner steps

Do not use third-party SDK mirrors, repackaged installers, unofficial signing tools, or shared certificates.

1. DevEco Studio `6.1.1.280` is installed in `D:\Program Files\Huawei\DevEco Studio`; its bundled SDK is `D:\Program Files\Huawei\DevEco Studio\sdk`.
2. For command-line builds set process-local `DEVECO_SDK_HOME=D:\Program Files\Huawei\DevEco Studio\sdk` instead of modifying the global environment.
3. Open the watch project from a physical path without spaces. The verified IDE worktree is `D:\DevEcoProjects\GymCoachWatchIDE`. The original repository path contains `projects codex` and fails DevEco project sync.
4. Run `npm install` and `npm run bundle` in `huawei-watch-app` before DevEco builds after changing canonical JavaScript under `src/lite` or `src/core`.
5. Open `huawei-watch-app/preview-harness` for official Previewer UI testing. Open `huawei-watch-app` for the production HAP.
6. Install HUAWEI DevEco Assistant only from Huawei's official AppGallery distribution when real-device deployment is ready.
7. Update Huawei Health to at least `14.0.12.310`, pair the Watch GT 4 and confirm the connected state. The reviewed Wear Engine documentation did not establish a separate mandatory HMS Core version for SDK `5.0.3.304`.
8. Keep production signing keys, passwords, account tokens, App IDs, device profiles and private certificates outside the repository.

Official starting points:

- [Lite Wearable SDK download](https://developer.huawei.com/consumer/en/doc/connectivity-Library/litewearable-sdk-cn-0000001705004353)
- [Lite Wearable overview](https://developer.huawei.com/consumer/en/doc/harmonyos-guides-V3/lite-wearable-overview-0000001197577411-V3)
- [Lite Wearable development experience](https://developer.huawei.com/consumer/en/doc/harmonyos-guides-V3/lite-wearable-experience-0000000000622606-V3)
- [Wear Engine integration](https://developer.huawei.com/consumer/en/doc/connectivity-Guides/integrating-fitnesstwatch-sdk-0000001052859174)
- [Applying for Wear Engine](https://developer.huawei.com/consumer/en/doc/connectivity-Guides/applying-wearengine-0000001050777982)

## DevEco Studio and Previewer configuration

Verified configuration:

1. Open the physical worktree's `huawei-watch-app/` as its own DevEco Studio project. Do not import or convert the Android Gradle project.
2. The official `[Lite] Empty Ability` wizard generated HarmonyOS 6.1.1 API 24 metadata. Keep the mismatch with the Wear Engine page's compile SDK 6 or 10 documented until real-device validation.
3. Keep application IDs and package names in environment-specific configuration. Debug and production identities must remain separate.
4. Use `preview-harness` with the round Lite Wearable profile. The current Previewer viewport is 454 x 454 inside the official watch frame; production UI remains designed for the GT 4 466 x 466 display. A visual pass does not validate sensors, P2P, vibration, crown input, background execution or HAP installability.
5. The Previewer harness is system-API-free and deterministic. Production `@system.file` and `@system.wearengine` imports are confined to the production bundle.
6. Build and sign a debug HAP using an authorized development certificate and profile only after the owner completes the Huawei account and device-registration steps.

## Android emulator setup

The existing AVD is sufficient for Android-side development:

```text
AVD: PhoneWhisper_Pixel_7_Pro_API_34
System image: Android API 34, Google APIs, x86_64
ADB serial observed during audit: emulator-5554
```

Use it to test:

- active-workout snapshot generation;
- event queue persistence and acknowledgements;
- duplicate-event idempotency;
- revision conflicts;
- Bluetooth-loss simulation at the transport boundary;
- watch restart and phone restart simulation;
- sensor batching with the 900-byte outbound target, 1,024-byte inbound hard limit, and 3.5 MiB file target strictly below 4 MB.

Do not report a Wear Engine integration as verified from this AVD. Huawei Health, HMS Core, actual pairing, watch sensors, screen-off lifecycle, and signed-HAP installation require supported physical hardware.

## Wear Engine and HMS configuration

Real Wear Engine setup requires Huawei-controlled configuration and user-owned credentials:

1. Create or select the Huawei Developer project and apply for Wear Engine service access.
2. Register the Android package name and required application identifier.
3. Register the watch application identity according to the Lite Wearable and Wear Engine guides.
4. Add the Android signing-certificate fingerprint required by Huawei.
5. Configure debug and production application identities separately.
6. Add only the minimum Huawei dependencies and permissions required for discovery, connection, P2P messages, and files.
7. Pair the physical watch in Huawei Health `14.0.12.310` or newer and record the HMS Core state and version if present. The reviewed documentation does not establish a separate minimum HMS Core version.
8. Query device type and API level at runtime. Do not activate watch synchronization if the device does not advertise the required capabilities.

Official references:

- [Wear Engine service introduction](https://developer.huawei.com/consumer/en/doc/connectivity-Guides/service-introduction-0000000000018585)
- [Application ID and package name](https://developer.huawei.com/consumer/en/doc/connectivity-Guides/addingappid-packagename-0000001050818013)
- [Obtaining the device API level](https://developer.huawei.com/consumer/en/doc/connectivity-Guides/obtains-api-level-0000001063993525)
- [Sending messages and files](https://developer.huawei.com/consumer/en/doc/connectivity-Guides/send-message-0000001052460491)

## Real Watch GT 4 prerequisites

The following steps require the owner's Huawei account, explicit confirmations, and physical access to the phone and watch. They must not be automated with stored credentials:

1. Enable the developer workflow required by the chosen Huawei instructions.
2. Obtain the watch or device identifier through the official flow.
3. Register the device in the Huawei Developer project.
4. Create a development certificate and debug profile.
5. Sign the debug HAP without exposing the private key or password.
6. Copy the signed HAP to the Huawei phone under `/sdcard/haps` as documented.
7. Use Huawei Health and HUAWEI DevEco Assistant to install and start the application on the paired watch.
8. Grant the requested health-data permission on the watch only after the UI explains its workout-analysis purpose.
9. Verify P2P ping and pong, active-workout synchronization, heart-rate samples, reconnect behavior, vibration, suspension recovery, and any crown handling on the real GT 4.
10. Record the exact watch model, HarmonyOS build, reported device type, API level, Huawei Health version, HMS Core version, Wear Engine version, Lite Wearable SDK version, and test date.

Official deployment and signing references:

- [Running a fitness-watch application](https://developer.huawei.com/consumer/en/doc/harmonyos-guides-V2/run_fitnesswatch-0000001054134240-V2)
- [Signing a HarmonyOS application](https://developer.huawei.com/consumer/en/doc/harmonyos-guides-V2/signing-0000001587684945-V2)

## Post-installation verification record

This table separates verified local toolchain evidence from remaining owner-account, signing and physical-hardware gates. Do not replace `Not verified` with an assumption.

| Item                | Expected evidence                                        | Current result |
| ------------------- | -------------------------------------------------------- | -------------- |
| DevEco Studio       | About dialog version and installation path               | Verified: `6.1.1.280`, `D:\Program Files\Huawei\DevEco Studio` |
| Lite Wearable SDK   | SDK package, source hash and project target              | Verified: Wear Engine Lite `5.0.2.306`; wizard target API 24; compile-level discrepancy documented |
| Previewer           | Successful round watch-page render and interaction       | Verified: home, workout, set start/completion and rest screen |
| Wear Engine SDK     | Official artifact version on Android and watch           | Verified at build time: Android `5.0.3.304`, watch `5.0.2.306` |
| DevEco Assistant    | Version and phone connection                             | Not verified   |
| Huawei Health       | Phone version and paired Watch GT 4                      | Not verified   |
| HMS Core            | Phone version and Wear Engine availability               | Not verified   |
| Signed debug HAP    | Build output, signature verification, authorized profile | Not verified   |
| Real-device install | Application visible and launchable on Watch GT 4         | Not verified   |
| Runtime identity    | Model, device type, API level, HarmonyOS build           | Not verified   |
| P2P transport       | Ping and pong plus reconnect test                        | Not verified   |
| Health sensor       | Permission, valid heart-rate cadence, off-wrist behavior | Not verified   |
| Background behavior | Screen-off, suspension, restore, and data-retention test | Not verified   |
