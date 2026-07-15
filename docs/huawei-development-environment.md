# Huawei Watch Development Environment

Last audited: 2026-07-15.

This is a read-only inventory of the current Windows development machine and a safe setup plan for the Huawei Watch GT 4 companion. The audit did not install software, change global environment variables, sign in to Huawei services, create certificates, or register devices.

## Current machine inventory

| Component                         | Status                             | Version or path                                                                                         | Audit note                                                                                                                                                                                                    |
| --------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operating system                  | Available                          | Windows build `10.0.22631`                                                                              | Reported by the local command environment.                                                                                                                                                                    |
| Java runtime and compiler         | Available                          | Eclipse Temurin `17.0.19+10`; `C:\Program Files\Eclipse Adoptium\jdk-17.0.19.10-hotspot`                | `JAVA_HOME` points to this installation. Compatibility with the selected DevEco Studio and Lite Wearable SDK release must be checked against Huawei's installer requirements before reuse.                    |
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
| DevEco Studio                     | Missing                            | No installation, executable, environment variable, or registered package found                          | Required for the official Lite Wearable project, Previewer, signing workflow, and HAP packaging.                                                                                                              |
| Huawei Lite Wearable SDK          | Missing                            | No SDK path found; `DEVECO_SDK_HOME` and `HARMONYOS_SDK_HOME` are unset                                 | Install the official Lite Wearable SDK version `5.0.2.306` or a newer officially compatible release selected at setup time.                                                                                   |
| Wear Engine SDK                   | Missing                            | No local Huawei Wear Engine library or SDK installation found                                           | Obtain only from Huawei Developer. Android and watch packages must use compatible official Wear Engine components.                                                                                            |
| HUAWEI DevEco Assistant           | Missing                            | No installation found                                                                                   | Required by Huawei's documented fitness-watch real-device deployment workflow.                                                                                                                                |
| DevEco Previewer                  | Missing                            | No installation found                                                                                   | Installed with or configured through DevEco Studio. It is the official UI preview path, not a full Watch GT 4 emulator.                                                                                       |
| Official full Watch GT 4 emulator | Not identified                     | None                                                                                                    | The reviewed Huawei documentation provides Previewer for Lite Wearable UI. Wear Engine, sensors, and lifecycle behavior still require the project simulator and real-device verification.                     |
| Huawei Health                     | Not present on the development PC  | Phone component                                                                                         | Install or update it on the paired Huawei or Android phone from an official Huawei source when real-watch testing begins.                                                                                     |
| HMS Core                          | Not present on the development PC  | Phone component                                                                                         | Install or update the official phone component required by the chosen Wear Engine integration. A generic Android Emulator does not substitute for a compatible physical phone and Huawei account environment. |

## Target toolchain

Use the following target without changing the existing Android toolchain unless Huawei's compatibility requirements force an isolated adjustment:

| Area                  | Target                                                                                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing Android app  | Keep its Gradle wrapper `8.11.1`, current Android SDK, and JDK 17 configuration.                                                                                |
| Watch project         | Separate `huawei-watch-app/` DevEco Studio project using the officially supported Lite Wearable JavaScript, HML, and CSS stack.                                 |
| Lite Wearable SDK     | Official version `5.0.2.306`, published 2025-06-23, with documented compile SDK level 6 or 10. Recheck the official download page before installation.          |
| Phone-watch transport | Official Wear Engine Lite SDK after confirming Watch GT 4 device type, API level, service approval, App ID, package name, and signing fingerprint requirements. |
| Watch UI testing      | DevEco Previewer for layout and interaction plus a development-only simulated transport.                                                                        |
| Android testing       | Existing API 34 phone AVD for Android UI, queues, conflicts, reconnect logic, and simulated sensor events.                                                      |
| Hardware verification | Physical Huawei Watch GT 4 paired to a compatible phone through Huawei Health.                                                                                  |

## Safe installation plan

Do not use third-party SDK mirrors, repackaged installers, unofficial signing tools, or shared certificates.

1. Open the [official DevEco Studio page](https://developer.huawei.com/consumer/en/deveco-studio/) and follow its official download link. At the time of this audit, the download route redirected to HUAWEI ID login. The owner must sign in interactively before the official installer can be obtained.
2. Before installation, check the DevEco Studio release notes and compatibility matrix for Lite Wearable SDK `5.0.2.306`. The archived guide for DevEco Studio 3.1.1 Release and API 9 does not by itself establish compatibility with the current Lite SDK or the Wear Engine compile SDK 6 or 10 targets. Do not install an old third-party mirror. Do not assume that the currently installed JDK 17 is suitable for the selected Lite Wearable toolchain. Prefer DevEco Studio's supported bundled runtime when Huawei provides one.
3. Install DevEco Studio in a separate directory and leave the existing Android SDK, `JAVA_HOME`, and Android Gradle configuration unchanged.
4. Add the official Lite Wearable SDK through the mechanism documented for the chosen DevEco Studio release. Record the final SDK path, installed package revision, compile SDK, Node runtime if bundled, and Previewer version.
5. Download the official Wear Engine SDK and follow Huawei's application process. Record the exact Android SDK artifact, watch SDK artifact, and service version used by the repository.
6. Install HUAWEI DevEco Assistant only from Huawei's official distribution when real-device deployment is ready.
7. Install or update Huawei Health and HMS Core on the test phone from official Huawei channels. Pair the Watch GT 4 normally and confirm that Huawei Health can see it before attempting application deployment.
8. Keep production signing keys, passwords, account tokens, device profiles, and private certificates outside the repository. Commit only sanitized setup notes and public certificate fingerprints where Huawei explicitly requires them.

Official starting points:

- [Lite Wearable SDK download](https://developer.huawei.com/consumer/en/doc/connectivity-Library/litewearable-sdk-cn-0000001705004353)
- [Lite Wearable overview](https://developer.huawei.com/consumer/en/doc/harmonyos-guides-V3/lite-wearable-overview-0000001197577411-V3)
- [Lite Wearable development experience](https://developer.huawei.com/consumer/en/doc/harmonyos-guides-V3/lite-wearable-experience-0000000000622606-V3)
- [Wear Engine integration](https://developer.huawei.com/consumer/en/doc/connectivity-Guides/integrating-fitnesstwatch-sdk-0000001052859174)
- [Applying for Wear Engine](https://developer.huawei.com/consumer/en/doc/connectivity-Guides/applying-wearengine-0000001050777982)

## DevEco Studio and Previewer configuration

After the official tools are installed:

1. Open `huawei-watch-app/` as its own DevEco Studio project. Do not import or convert the Android Gradle project.
2. Select the installed Lite Wearable SDK and the compile SDK level supported by the official package and project template.
3. Keep application IDs and package names in environment-specific configuration. Debug and production identities must remain separate.
4. Configure Previewer for the closest official round-watch profile available and verify the 466 x 466 layout. A visual Previewer pass does not validate sensors, P2P, vibration, crown input, background execution, or HAP installability.
5. Provide a debug transport adapter that uses the same shared event contract as Wear Engine. The adapter may simulate connection loss, duplicate events, heart rate, timers, and file-size limits, but it must not be included in the production HAP.
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
- sensor batching and the 1 KB message and 4 MB file limits.

Do not report a Wear Engine integration as verified from this AVD. Huawei Health, HMS Core, actual pairing, watch sensors, screen-off lifecycle, and signed-HAP installation require supported physical hardware.

## Wear Engine and HMS configuration

Real Wear Engine setup requires Huawei-controlled configuration and user-owned credentials:

1. Create or select the Huawei Developer project and apply for Wear Engine service access.
2. Register the Android package name and required application identifier.
3. Register the watch application identity according to the Lite Wearable and Wear Engine guides.
4. Add the Android signing-certificate fingerprint required by Huawei.
5. Configure debug and production application identities separately.
6. Add only the minimum Huawei dependencies and permissions required for discovery, connection, P2P messages, and files.
7. Pair the physical watch in Huawei Health and confirm that both Huawei Health and HMS Core are current.
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

Fill this table after the tools and hardware are available. Do not replace `Not verified` with an assumption.

| Item                | Expected evidence                                        | Current result |
| ------------------- | -------------------------------------------------------- | -------------- |
| DevEco Studio       | About dialog version and installation path               | Not verified   |
| Lite Wearable SDK   | SDK Manager package ID, version, path, compile SDK       | Not verified   |
| Previewer           | Version and successful 466 x 466 watch-page render       | Not verified   |
| Wear Engine SDK     | Official artifact version on Android and watch           | Not verified   |
| DevEco Assistant    | Version and phone connection                             | Not verified   |
| Huawei Health       | Phone version and paired Watch GT 4                      | Not verified   |
| HMS Core            | Phone version and Wear Engine availability               | Not verified   |
| Signed debug HAP    | Build output, signature verification, authorized profile | Not verified   |
| Real-device install | Application visible and launchable on Watch GT 4         | Not verified   |
| Runtime identity    | Model, device type, API level, HarmonyOS build           | Not verified   |
| P2P transport       | Ping and pong plus reconnect test                        | Not verified   |
| Health sensor       | Permission, valid heart-rate cadence, off-wrist behavior | Not verified   |
| Background behavior | Screen-off, suspension, restore, and data-retention test | Not verified   |
