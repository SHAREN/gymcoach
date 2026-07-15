package org.sharteman.gymcoach.watch.transport

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HuaweiWearEngineConfigurationTest {
    @Test
    fun `configuration requires app id package and fingerprint`() {
        assertTrue(config().isConfigured)
        assertFalse(config(appId = "").isConfigured)
        assertFalse(config(watchPackageName = "").isConfigured)
        assertFalse(config(watchFingerprint = "").isConfigured)
    }

    @Test
    fun `debug transport selector defaults safely to simulator`() {
        assertTrue(WatchTransportMode.parse(null) == WatchTransportMode.SIMULATOR)
        assertTrue(WatchTransportMode.parse("unknown") == WatchTransportMode.SIMULATOR)
        assertTrue(WatchTransportMode.parse(" simulator ") == WatchTransportMode.SIMULATOR)
        assertTrue(WatchTransportMode.parse(" HUAWEI ") == WatchTransportMode.HUAWEI)
    }

    private fun config(
        appId: String = "test-app-id",
        watchPackageName: String = "org.example.watch",
        watchFingerprint: String = "AA:BB",
    ) = HuaweiWearEngineConfiguration(
        appId = appId,
        watchPackageName = watchPackageName,
        watchFingerprint = watchFingerprint,
    )
}
