# Android archive status

Paused on 2026-09-06 by user request. Do not deploy or publish this repository now.

This local repository is a history-preserving extraction from SHAREN/gymcoach at source commit 25a784380910a6e0056b2df93bd5caf1e525341e. The former android/ directory is the repository root. huawei-watch-app/ and shared-contracts/ are retained beside it.

Verification completed before pausing:
- source app tree, Huawei tree and shared-contract tree matched the final legacy snapshot before standalone adjustments;
- Android testDebugUnitTest: BUILD SUCCESSFUL on JDK 17 / Android SDK;
- Android assembleDebug: BUILD SUCCESSFUL; ordinary build no longer publishes into the old web release directory;
- shared contracts: 15 schemas and 15 examples validated;
- Huawei companion: bundle/format checks and 77/77 tests passed;
- preliminary filtered-history gitleaks scan found 0 findings;
- npm audit for the Huawei package reported one high-severity transitive browserslist advisory; it was not auto-fixed because this archive is paused and no deployment is planned.

Standalone adjustments remove the old monorepo build dependency on web i18n generation and automatic APK publishing. The generated Russian exercise dictionary remains frozen in source. No GitHub repository was created and nothing was pushed.

When Android work resumes: rerun gitleaks on this v2 extraction, review the Huawei dependency advisory, review server API compatibility, then decide whether to publish/archive SHAREN/gymcoach-android.
