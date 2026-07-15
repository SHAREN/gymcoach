package org.sharteman.gymcoach.watch.ui.diagnostics

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.sharteman.gymcoach.watch.domain.WatchConnectionStatus

class WatchDiagnosticsExporterTest {
    @Test
    fun `export contains operational counters but excludes sensitive measurements`() {
        val payload = buildRedactedWatchDiagnosticsExport(
            snapshot = WatchDiagnosticsSnapshot(
                watchModel = "Huawei GT 4 owner@example.test",
                connectionStatus = WatchConnectionStatus.CONNECTED,
                watchAppVersion = "1.2.3",
                protocolVersion = "1.0",
                lastSyncAt = 1_000L,
                unacknowledgedEventCount = 3,
                lastErrorCode = "token=owner@example.test",
                supportedSensors = listOf(
                    WatchSensorDiagnostic("HEART_RATE", WatchSensorSupport.DEBUG_SIMULATED),
                ),
                currentHeartRateBpm = 143.0,
                messageLatencyMs = 27,
                queueSize = 4,
                conflictCount = 2,
            ),
            log = listOf(
                WatchDiagnosticLogEntry(900L, "SYNC", "Bearer private-token"),
            ),
            androidAppVersion = "0.4.14",
            generatedAt = 2_000L,
        )

        val json = Json.parseToJsonElement(payload).jsonObject
        assertEquals("CONNECTED", json.getValue("connectionStatus").jsonPrimitive.content)
        assertEquals(4, json.getValue("queueSize").jsonPrimitive.content.toInt())
        assertEquals(2, json.getValue("conflictCount").jsonPrimitive.content.toInt())
        assertEquals("REDACTED", json.getValue("lastErrorCode").jsonPrimitive.content)
        assertTrue(json.getValue("heartRateStreamActive").jsonPrimitive.content.toBoolean())
        assertEquals(
            "REDACTED",
            json.getValue("log").jsonArray.single().jsonObject.getValue("code").jsonPrimitive.content,
        )
        assertFalse(payload.contains("143.0"))
        assertFalse(payload.contains("currentHeartRateBpm"))
        assertFalse(payload.contains("owner@example.test"))
        assertFalse(payload.contains("private-token"))
        assertFalse(payload.contains("sessionId"))
        assertFalse(payload.contains("deviceId"))
        assertFalse(payload.contains("http://"))
        assertFalse(payload.contains("https://"))
    }

    @Test
    fun `export clamps counters and limits diagnostic history`() {
        val payload = buildRedactedWatchDiagnosticsExport(
            snapshot = WatchDiagnosticsSnapshot(
                protocolVersion = "1.0",
                unacknowledgedEventCount = -1,
                queueSize = -2,
                conflictCount = -3,
                messageLatencyMs = -4,
            ),
            log = (0..150).map {
                WatchDiagnosticLogEntry(it.toLong(), "SYNC", "ENTRY_$it")
            },
            androidAppVersion = "test",
            generatedAt = 500L,
        )

        val json = Json.parseToJsonElement(payload).jsonObject
        assertEquals(0, json.getValue("unacknowledgedEventCount").jsonPrimitive.content.toInt())
        assertEquals(0, json.getValue("queueSize").jsonPrimitive.content.toInt())
        assertEquals(0, json.getValue("conflictCount").jsonPrimitive.content.toInt())
        assertEquals(0, json.getValue("messageLatencyMs").jsonPrimitive.content.toLong())
        assertEquals(100, json.getValue("log").jsonArray.size)
    }
}
