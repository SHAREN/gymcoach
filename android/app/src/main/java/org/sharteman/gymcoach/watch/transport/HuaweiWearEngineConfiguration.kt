package org.sharteman.gymcoach.watch.transport

import org.sharteman.gymcoach.BuildConfig

data class HuaweiWearEngineConfiguration(
    val appId: String,
    val watchPackageName: String,
    val watchFingerprint: String,
    val preferredDeviceUuid: String? = null,
) {
    val isConfigured: Boolean
        get() = appId.isNotBlank() && watchPackageName.isNotBlank() && watchFingerprint.isNotBlank()

    val peerIdentity: HuaweiWearEnginePeerIdentity
        get() = HuaweiWearEnginePeerIdentity(
            packageName = watchPackageName,
            fingerprint = watchFingerprint,
        )

    companion object {
        fun fromBuildConfig(): HuaweiWearEngineConfiguration = HuaweiWearEngineConfiguration(
            appId = BuildConfig.HUAWEI_WEAR_ENGINE_APP_ID.trim(),
            watchPackageName = BuildConfig.HUAWEI_WATCH_PACKAGE_NAME.trim(),
            watchFingerprint = BuildConfig.HUAWEI_WATCH_FINGERPRINT.trim(),
            preferredDeviceUuid = BuildConfig.HUAWEI_WATCH_DEVICE_UUID.trim().ifEmpty { null },
        )
    }
}

enum class WatchTransportMode {
    SIMULATOR,
    HUAWEI;

    companion object {
        fun parse(value: String?): WatchTransportMode = when (value?.trim()?.lowercase()) {
            "huawei" -> HUAWEI
            else -> SIMULATOR
        }
    }
}
