# Huawei Watch GT 4 development installation

Status: official-flow runbook for a real watch. Steps requiring a Huawei account, identity verification, device registration, certificates, profiles, passwords, or on-device approval are intentionally manual.

There is no documented full Watch GT 4 emulator that can replace this procedure. Use the official Lite Wearable Previewer for UI work and a physical registered watch for Wear Engine, sensor, screen-off, background, vibration, crown, and installation verification.

## Before starting

Use the exact versions and paths recorded in `huawei-development-environment.md`. Required components are:

- Windows development PC with DevEco Studio and the official Lite Wearable SDK.
- Supported JDK selected by DevEco Studio.
- Android SDK and ADB for the paired Huawei phone workflow.
- Huawei phone with current Huawei Health and HMS Core.
- Huawei Watch GT 4 paired to that phone in Huawei Health.
- Official DevEco Assistant required by the fitness-watch device workflow.
- A Huawei Developer account eligible to create an app, certificate, profile, and Wear Engine service configuration.

Do not install SDKs, Assistant packages, certificates, or drivers from unofficial mirrors.

The official DevEco Studio and SDK download flow currently redirects to HUAWEI ID sign-in. That sign-in, account verification, license acceptance, and SDK download approval must be completed by the owner. Automation must stop at the sign-in page and must not request credentials, cookies, one-time codes, or account recovery data. Contract, simulator, Android integration, and Previewer-independent work can continue while the official toolchain install is waiting, but a HAP build cannot be reported as complete.

## 1. Enable developer mode on the watch

This is a manual device action.

1. Update the watch and Huawei Health, then confirm the watch is paired and visible in Huawei Health.
2. On the watch, open Settings and the device information or About page.
3. Follow Huawei's current fitness-watch guide to tap the displayed software or build version repeatedly until developer mode is enabled. Menu labels can vary by firmware and region, so use the exact labels shown by the current official guide and watch firmware rather than forcing an Android-specific sequence.
4. Return to Settings and enable the developer or debugging option exposed by the watch firmware.
5. Accept the watch confirmation prompt.

If the developer option is absent, stop. Do not use hidden third-party tools. Confirm the exact model, region, firmware, Huawei Health version, and whether the device is enabled for third-party Lite Wearable development in the official supported-device documentation.

## 2. Obtain the device identifier

This is a manual device-registration action.

1. Connect the paired Huawei phone to the PC by USB.
2. Enable the phone's documented USB debugging or HDB mode and accept the PC fingerprint on the phone.
3. Open DevEco Assistant and follow the official fitness-watch connection flow.
4. Select the paired watch and copy the device identifier or UDID displayed by the official tool.
5. Record it in the private Huawei console workflow only. Do not paste the identifier into source code, issues, commits, or diagnostic logs.

Verify the phone connection with `adb devices` only if the official workflow requires ADB. ADB visibility of the phone does not prove that the watch is registered or reachable.

## 3. Register the app and watch

These steps require the user's Huawei Developer account and must be completed by the user in the Huawei console.

1. Sign in to HUAWEI Developers and complete any required developer identity verification.
2. Create or select the GymCoach project.
3. Register the Android companion application using its real package name.
4. Register the Lite Wearable application using the bundle or package name from `huawei-watch-app`.
5. Apply for and enable Wear Engine according to Huawei's service application guide.
6. Add the Android signing-certificate SHA-256 fingerprint required by the Wear Engine configuration.
7. Register the watch identifier obtained from DevEco Assistant as a debug device where the console or signing workflow requires it.
8. Keep app IDs, package names, fingerprints, and service configuration consistent with both project manifests.

Do not create a second production identity just to bypass a package or certificate mismatch. Correct the registration or signing configuration instead.

## 4. Create certificate and debug profile

These steps handle private signing material and remain manual.

1. In DevEco Studio or the Huawei developer console, generate or select the signing key and certificate request using the official signing workflow.
2. Obtain the Huawei-issued development certificate.
3. Create a debug provisioning profile for the Lite Wearable app, its capabilities, and the registered watch.
4. Import the key, certificate, and profile into the DevEco Studio signing configuration for the watch module.
5. Confirm that package name, app ID, certificate, profile, and device registration all match.
6. Store passwords in the IDE credential store or a private local secret mechanism, never in Gradle files, JavaScript, JSON, shell history, or Git.

Never commit private keys, keystores, certificate requests, developer certificates, provisioning profiles, account exports, passwords, or device registration files. Add local filename patterns to `.gitignore` before the first build if the IDE places them inside the repository.

## 5. Build and sign the HAP

1. Open `huawei-watch-app` as an independent project in DevEco Studio.
2. Select the Lite Wearable module and its debug product or build variant.
3. Confirm the project SDK and API level match `huawei-watch-gt4-capabilities.md` and the installed environment inventory.
4. Select the debug signing configuration created above.
5. Run the IDE build action for signed HAP packages.
6. Treat any unsigned-package, certificate-expired, package-name, profile, or device mismatch as a build failure. Do not disable signature checks.
7. Record the output HAP path, package name, version, size, SHA-256, certificate alias or public fingerprint, and build timestamp. Do not record a private-key path or password in shared logs.

## 6. Connect the phone and watch for installation

1. Keep Bluetooth enabled and the watch connected in Huawei Health.
2. Connect the Huawei phone to the PC by USB.
3. Start DevEco Assistant and select the connected phone and paired watch through the official fitness-watch flow.
4. Approve connection or debugging prompts on both devices.
5. Confirm that the device shown by Assistant is the registered Watch GT 4 before installing.

If the official guide uses the phone staging directory, stage the signed HAP on the phone, not in a public cloud location:

```powershell
adb devices
adb push <absolute-path-to-signed.hap> /sdcard/haps/
```

Use the exact destination and Assistant action documented for the installed tool version. Do not use an unverified watch-side shell, unofficial installer, or modified Huawei Health package.

## 7. Install the HAP

1. In DevEco Studio or DevEco Assistant, choose the signed HAP.
2. Select the registered Watch GT 4 target.
3. Start installation and accept the watch prompt if it appears.
4. Wait for the official tool to report success.
5. Verify that GymCoach appears in the watch application list and that its package and version match the built artifact.

Common failures:

| Failure                         | Check                                                                                                                       |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Signature or profile rejected   | Package name, app ID, certificate validity, profile, registered device ID, and system time.                                 |
| Device not listed               | Huawei Health pairing, Bluetooth, USB or HDB approval, DevEco Assistant version, supported-device list, and developer mode. |
| Wear Engine connection denied   | Service application status, Android package name, signing fingerprint, permissions, HMS Core, and Huawei Health versions.   |
| HAP installs but does not start | Lite Wearable API level, manifest entry point, bundle name, signing profile, and watch firmware support.                    |

## 8. Launch and run the connection check

1. Start the GymCoach Android debug build on the paired phone.
2. Sign in using the existing GymCoach authorization flow. The watch must not request or receive the bearer token.
3. Open the watch status screen on Android and start discovery.
4. Launch GymCoach on the watch.
5. Confirm the watch shows phone connection, watch app version, protocol version, and pending event count.
6. Run the ping/pong diagnostic.
7. Verify round-trip latency and confirm that logs contain only redacted identifiers.

If ping/pong fails, collect the sanitized error code and verify console configuration before changing workout logic.

## 9. Verify active workout synchronization

1. Start a workout on the Android phone.
2. Confirm one active session appears on the watch with matching session, workout, exercise, targets, and revision.
3. Change the exercise on the phone and verify the watch update.
4. Change the exercise on the watch and verify the phone update.
5. Complete a test set on the watch with weight, repetitions, and RIR.
6. Confirm the same stable set ID appears once on the phone and enters the existing server sync outbox.
7. Disconnect Bluetooth, record another set, reconnect, and verify ordered replay and ACK cleanup.

## 10. Grant health and sensor permissions

Permission prompts are manual user actions.

1. Open the sensor status page in the watch app.
2. Request only the permissions for collectors reported as supported at runtime.
3. Read the purpose text and approve or deny on the watch as desired.
4. Verify that denial leaves workout recording functional and shows sensor data as unavailable, not zero.
5. Do not request SpO2, stress, skin temperature, wrist state, motion sensors, or other permissions unless the capability matrix and runtime probe confirm the production API on this exact device.

## 11. Verify heart rate

1. Wear the watch normally and wait for the supported heart-rate collector to report a valid timestamped value.
2. Start and complete a short test set.
3. Verify samples are tagged `SET` and the set summary has start, end, minimum, maximum, average, sample count, and duration from valid samples.
4. Run a rest period long enough to inspect the available 30-second and 60-second recovery calculations.
5. Remove the watch or force an invalid test condition and confirm the sample is marked invalid and excluded rather than recorded as a real zero.
6. Turn off or sleep the screen and document whether callbacks continue. Do not call this supported until the exact firmware passes repeated tests.

These are fitness analytics and must not be described as medical measurements or diagnosis.

## 12. Complete the hardware acceptance run

Run every mode 1 row in `huawei-watch-testing.md`, including:

- Process restart on phone and watch.
- Screen sleep and reopen.
- Bluetooth loss and reconnection.
- Offline set entry and ordered replay.
- Duplicate event delivery.
- Conflict preservation.
- Message and file boundary tests.
- Vibration and crown tests only when reported as supported.
- Sensor permission denial and invalid readings.
- Workout finish and server history synchronization.

Record redacted evidence with exact hardware and software versions. Hardware-dependent capabilities remain `NOT VERIFIED` until this run succeeds.

## Uninstall and certificate rotation

- Uninstall only through the official watch, Huawei Health, DevEco Studio, or DevEco Assistant flow supported by the current tools.
- Export or synchronize pending workout events before uninstalling because watch-local data may be removed.
- Rotating a signing identity can prevent updates over an installed package. Preserve the intended production key securely and document public fingerprints.
- Revoke a compromised certificate or profile in the Huawei console and rebuild. Never publish a private key to troubleshoot an installation.

## Official references

- [Running a fitness watch application](https://developer.huawei.com/consumer/en/doc/harmonyos-guides-V2/run_fitnesswatch-0000001054134240-V2)
- [HarmonyOS application signing](https://developer.huawei.com/consumer/en/doc/harmonyos-guides-V2/signing-0000001587684945-V2)
- [Applying for Wear Engine](https://developer.huawei.com/consumer/en/doc/connectivity-Guides/applying-wearengine-0000001050777982)
- [Integrating the fitness watch SDK](https://developer.huawei.com/consumer/en/doc/connectivity-Guides/integrating-fitnesstwatch-sdk-0000001052859174)
- [Obtaining the Wear Engine API level](https://developer.huawei.com/consumer/en/doc/connectivity-Guides/obtains-api-level-0000001063993525)
- [Lite Wearable experience and Previewer](https://developer.huawei.com/consumer/en/doc/harmonyos-guides-V3/lite-wearable-experience-0000000000622606-V3)
