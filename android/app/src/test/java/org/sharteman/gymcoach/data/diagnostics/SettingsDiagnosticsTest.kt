package org.sharteman.gymcoach.data.diagnostics

import java.nio.file.Files
import java.time.Instant
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.sharteman.gymcoach.data.settings.AndroidReleaseDto

class SettingsDiagnosticsTest {
    @Test
    fun `persistent store rotates by age count and size across restarts`() {
        val directory = Files.createTempDirectory("settings-diagnostics").toFile()
        var now = 10_000L
        val policy = SettingsDiagnosticRetentionPolicy(
            maxEvents = 3,
            maxBytes = 2_500,
            maxAgeMs = 1_000,
        )
        val store = FileSettingsDiagnosticEventStore(directory, policy) { now }
        store.append(event("old", 8_000))
        listOf("one", "two", "three", "four").forEachIndexed { index, id ->
            store.append(event(id, 9_500L + index))
        }

        val rotated = store.snapshot()

        assertEquals(listOf("two", "three", "four"), rotated.map { it.correlationId })
        assertTrue(directory.resolve("events-v1.jsonl").length() <= policy.maxBytes)

        val restarted = FileSettingsDiagnosticEventStore(directory, policy) { now }
        assertEquals(rotated, restarted.snapshot())
        assertTrue(restarted.clear())
        assertTrue(restarted.snapshot().isEmpty())
    }

    @Test
    fun `adversarial values are redacted before persistence`() {
        val directory = Files.createTempDirectory("settings-redaction").toFile()
        val store = FileSettingsDiagnosticEventStore(directory) { 10_000L }
        val tokenHash = "a".repeat(64)
        val privateEquipmentId = "cly9h7k2w0001u6w8m4v3n2pq"
        val unsafe = event(tokenHash, 10_000).copy(
            app = APP.copy(packageName = "private@example.invalid"),
            attemptId = "gma_${"b".repeat(43)}",
            origin = "https://example.test/private?token=secret",
            path = "/api/gym-equipment/$privateEquipmentId/image?password=secret",
            category = "private@example.invalid",
            errorCode = "Bearer secret-token",
            exceptionClass = "C:\\Users\\Private\\secret.txt",
            lifecycleMarker = "cookie=session-secret",
        )

        assertTrue(store.append(unsafe))
        val stored = store.snapshot().single()
        val encoded = Json.encodeToString(stored)

        assertNull(stored.correlationId)
        assertNull(stored.attemptId)
        assertEquals("unknown-package", stored.app.packageName)
        assertEquals("https://example.test", stored.origin)
        assertEquals("/api/gym-equipment/:equipmentId/image", stored.path)
        assertEquals("redacted", stored.category)
        assertNull(stored.errorCode)
        assertNull(stored.exceptionClass)
        assertNull(stored.lifecycleMarker)
        assertFalse(encoded.contains("secret-token"))
        assertFalse(encoded.contains("private@example.invalid"))
        assertFalse(encoded.contains("password=secret"))
        assertFalse(encoded.contains("C:\\Users"))
        assertFalse(encoded.contains(tokenHash))
        assertFalse(encoded.contains(privateEquipmentId))
    }

    @Test
    fun `copy and zip exports contain bounded state and verifiable integrity only`() {
        val event = event("settings-profile-1", 10_000).copy(
            origin = "https://example.test/path?token=secret",
            path = "/api/gyms/cly9h7k2w0001u6w8m4v3n2pq/equipment?email=private@example.invalid",
        )
        val exportState = SettingsDiagnosticExportState(
            databaseSchemaVersion = 9,
            queueCounts = SettingsDiagnosticQueueCounts(sync = 2, offline = 3),
            latestRelease = AndroidReleaseDto(
                versionCode = 41,
                versionName = "0.4.31",
                sha256 = "c".repeat(64),
                sizeBytes = 123_456,
                publishedAt = "2026-07-23T12:00:00Z",
                apkFile = "gymcoach-41-${"c".repeat(12)}.apk",
                downloadUrl = "https://example.test/download?token=secret",
            ),
        )
        val account = SettingsDiagnosticAccountState(
            loggedIn = true,
            selectedAuthority = "https://example.test",
            primaryAuthority = "https://example.test",
            fallbackAuthority = "http://192.168.0.119:3030",
            sessionAuthority = "https://example.test",
        )
        val policy = SettingsDiagnosticRetentionPolicy(maxEvents = 10, maxBytes = 10_000)

        val copy = buildSettingsDiagnosticCopyForTest(
            events = listOf(event),
            appInfo = APP,
            accountState = account,
            policy = policy,
            state = exportState,
            nowEpochMs = 20_000,
        )
        val archive = buildSettingsDiagnosticArchiveForTest(
            events = listOf(event),
            appInfo = APP,
            accountState = account,
            policy = policy,
            state = exportState,
            nowEpochMs = 20_000,
        )

        assertTrue(verifySettingsDiagnosticArchive(archive))
        assertTrue(copy.contains("\"manifest\""))
        assertTrue(copy.contains("\"databaseSchemaVersion\": 9"))
        assertTrue(copy.contains("\"sync\": 2"))
        assertTrue(copy.contains("\"offline\": 3"))
        assertTrue(copy.contains("\"aggregateSha256\""))
        assertTrue(copy.contains("\"versionCode\": 41"))
        assertFalse(copy.contains("private@example.invalid"))
        assertFalse(copy.contains("token=secret"))
        assertFalse(copy.contains("download?"))
        assertFalse(copy.contains("cly9h7k2w0001u6w8m4v3n2pq"))
        assertTrue(copy.contains("/api/gyms/:gymId/equipment"))
    }

    private fun event(correlationId: String, timestamp: Long) = SettingsDiagnosticEvent(
        eventId = "event-$correlationId".take(64),
        utcTimestamp = Instant.ofEpochMilli(timestamp).toString(),
        deviceEpochMs = timestamp,
        elapsedRealtimeMs = timestamp,
        kind = "settings-request",
        app = APP,
        attemptId = "attempt-1",
        correlationId = correlationId,
        subrequest = "profile",
        origin = "https://example.test",
        path = "/api/profile",
        method = "GET",
        statusCode = 200,
        category = "ok",
        durationMs = 12,
        retryDecision = "none",
        networkClass = "wifi",
        appState = "foreground",
    )

    private companion object {
        val APP = SettingsDiagnosticAppInfo(
            packageName = "org.sharteman.gymcoach",
            versionName = "0.4.31",
            versionCode = 41,
            buildType = "debug",
            commit = "52761c53502f",
        )
    }
}
