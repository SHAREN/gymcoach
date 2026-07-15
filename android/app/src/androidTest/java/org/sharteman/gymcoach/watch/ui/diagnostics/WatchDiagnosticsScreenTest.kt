package org.sharteman.gymcoach.watch.ui.diagnostics

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.sharteman.gymcoach.ui.theme.GymCoachTheme
import org.sharteman.gymcoach.watch.domain.WatchConnectionStatus

class WatchDiagnosticsScreenTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun rendersStatusAndInvokesForcedSynchronization() {
        val source = FakeWatchDiagnosticsDataSource()
        composeRule.setContent {
            GymCoachTheme(darkTheme = true) {
                WatchDiagnosticsScreen(onBack = {}, dataSource = source)
            }
        }

        composeRule.onNodeWithTag("watch-diagnostics-screen").assertIsDisplayed()
        composeRule.onNodeWithText("Huawei Watch GT 4 test device").assertIsDisplayed()
        composeRule.onNodeWithText("HEART_RATE").assertIsDisplayed()
        composeRule.onNodeWithText("NO_ROUTE").assertIsDisplayed()
        composeRule.onNodeWithTag("watch-diagnostics-force-sync").performClick()
        composeRule.waitUntil(timeoutMillis = 5_000) { source.forceSyncCalled.get() }
        assertTrue(source.forceSyncCalled.get())
    }
}

private class FakeWatchDiagnosticsDataSource : WatchDiagnosticsDataSource {
    val forceSyncCalled = AtomicBoolean(false)
    private val mutableSnapshot = MutableStateFlow(
        WatchDiagnosticsSnapshot(
            watchModel = "Huawei Watch GT 4 test device",
            connectionStatus = WatchConnectionStatus.CONNECTED,
            watchAppVersion = "test-watch",
            protocolVersion = "1.0",
            lastSyncAt = 1_000L,
            unacknowledgedEventCount = 2,
            lastErrorCode = "NO_ROUTE",
            supportedSensors = listOf(
                WatchSensorDiagnostic("HEART_RATE", WatchSensorSupport.AVAILABLE),
            ),
            currentHeartRateBpm = 132.0,
            messageLatencyMs = 25,
            queueSize = 2,
            conflictCount = 1,
        ),
    )

    override val snapshot: StateFlow<WatchDiagnosticsSnapshot> = mutableSnapshot

    override suspend fun forceSync() {
        forceSyncCalled.set(true)
    }

    override fun exportRedacted(): String = "{}"

    override fun close() = Unit
}
