package org.sharteman.gymcoach.data.diagnostics

import java.io.ByteArrayOutputStream
import java.io.File
import java.security.MessageDigest
import java.time.Instant
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.sharteman.gymcoach.data.settings.AndroidReleaseDto

@Serializable
data class SettingsDiagnosticQueueCounts(
    val sync: Int,
    val offline: Int,
)

data class SettingsDiagnosticExportState(
    val databaseSchemaVersion: Int,
    val queueCounts: SettingsDiagnosticQueueCounts,
    val latestRelease: AndroidReleaseDto?,
)

@Serializable
data class SettingsDiagnosticReleaseState(
    val versionName: String,
    val versionCode: Int,
    val sizeBytes: Long,
    val sha256: String,
    val publishedAt: String,
    val apkFile: String,
)

@Serializable
data class SettingsDiagnosticArchiveState(
    val account: SettingsDiagnosticAccountState,
    val latestRelease: SettingsDiagnosticReleaseState?,
    val databaseSchemaVersion: Int,
    val queueCounts: SettingsDiagnosticQueueCounts,
)

@Serializable
data class SettingsDiagnosticArchiveManifest(
    val schemaVersion: Int = 1,
    val generatedAt: String,
    val app: SettingsDiagnosticAppInfo,
    val eventCount: Int,
    val retention: SettingsDiagnosticRetentionManifest,
    val entries: List<String>,
    val integrityEntry: String,
)

@Serializable
data class SettingsDiagnosticRetentionManifest(
    val maxEvents: Int,
    val maxBytes: Int,
    val maxAgeMs: Long,
)

@Serializable
data class SettingsDiagnosticFileIntegrity(
    val name: String,
    val sizeBytes: Int,
    val sha256: String,
)

@Serializable
data class SettingsDiagnosticArchiveIntegrity(
    val algorithm: String = "SHA-256",
    val files: List<SettingsDiagnosticFileIntegrity>,
    val aggregateSha256: String,
)

@Serializable
private data class SettingsDiagnosticCopyPayload(
    val manifest: SettingsDiagnosticArchiveManifest,
    val state: SettingsDiagnosticArchiveState,
    val events: List<SettingsDiagnosticEvent>,
    val integrity: SettingsDiagnosticArchiveIntegrity,
)

private val archiveJson = Json {
    encodeDefaults = true
    explicitNulls = true
    prettyPrint = true
}

fun SettingsDiagnostics.buildCopyPayload(
    state: SettingsDiagnosticExportState,
    nowEpochMs: Long = System.currentTimeMillis(),
): String {
    val payload = diagnosticPayload(state, nowEpochMs)
    return archiveJson.encodeToString(
        SettingsDiagnosticCopyPayload(
            manifest = payload.manifest,
            state = payload.state,
            events = payload.events,
            integrity = payload.integrity,
        ),
    )
}

fun SettingsDiagnostics.buildArchive(
    state: SettingsDiagnosticExportState,
    nowEpochMs: Long = System.currentTimeMillis(),
): ByteArray {
    val payload = diagnosticPayload(state, nowEpochMs)
    return buildArchiveBytes(payload, nowEpochMs)
}

internal fun buildSettingsDiagnosticArchiveForTest(
    events: List<SettingsDiagnosticEvent>,
    appInfo: SettingsDiagnosticAppInfo,
    accountState: SettingsDiagnosticAccountState,
    policy: SettingsDiagnosticRetentionPolicy,
    state: SettingsDiagnosticExportState,
    nowEpochMs: Long,
): ByteArray = buildArchiveBytes(
    prepareDiagnosticPayload(events, appInfo, accountState, policy, state, nowEpochMs),
    nowEpochMs,
)

internal fun buildSettingsDiagnosticCopyForTest(
    events: List<SettingsDiagnosticEvent>,
    appInfo: SettingsDiagnosticAppInfo,
    accountState: SettingsDiagnosticAccountState,
    policy: SettingsDiagnosticRetentionPolicy,
    state: SettingsDiagnosticExportState,
    nowEpochMs: Long,
): String {
    val payload = prepareDiagnosticPayload(events, appInfo, accountState, policy, state, nowEpochMs)
    return archiveJson.encodeToString(
        SettingsDiagnosticCopyPayload(
            manifest = payload.manifest,
            state = payload.state,
            events = payload.events,
            integrity = payload.integrity,
        ),
    )
}

private fun buildArchiveBytes(
    payload: PreparedDiagnosticPayload,
    nowEpochMs: Long,
): ByteArray {
    return ByteArrayOutputStream().use { buffer ->
        ZipOutputStream(buffer).use { zip ->
            payload.files.forEach { (name, bytes) ->
                zip.putNextEntry(ZipEntry(name).apply { time = nowEpochMs })
                zip.write(bytes)
                zip.closeEntry()
            }
            zip.putNextEntry(ZipEntry(INTEGRITY_ENTRY).apply { time = nowEpochMs })
            zip.write(archiveJson.encodeToString(payload.integrity).toByteArray(Charsets.UTF_8))
            zip.closeEntry()
        }
        buffer.toByteArray()
    }
}

internal fun verifySettingsDiagnosticArchive(bytes: ByteArray): Boolean = runCatching {
    val entries = linkedMapOf<String, ByteArray>()
    ZipInputStream(bytes.inputStream()).use { zip ->
        while (true) {
            val entry = zip.nextEntry ?: break
            entries[entry.name] = zip.readBytes()
            zip.closeEntry()
        }
    }
    val integrityBytes = entries.remove(INTEGRITY_ENTRY) ?: return@runCatching false
    val integrity = archiveJson.decodeFromString<SettingsDiagnosticArchiveIntegrity>(
        integrityBytes.toString(Charsets.UTF_8),
    )
    val actual = entries.map { (name, content) ->
        SettingsDiagnosticFileIntegrity(name, content.size, sha256(content))
    }
    integrity.algorithm == "SHA-256" &&
        integrity.files == actual &&
        integrity.aggregateSha256 == aggregateChecksum(actual)
}.getOrDefault(false)

private data class PreparedDiagnosticPayload(
    val manifest: SettingsDiagnosticArchiveManifest,
    val state: SettingsDiagnosticArchiveState,
    val events: List<SettingsDiagnosticEvent>,
    val integrity: SettingsDiagnosticArchiveIntegrity,
    val files: LinkedHashMap<String, ByteArray>,
)

private fun SettingsDiagnostics.diagnosticPayload(
    state: SettingsDiagnosticExportState,
    nowEpochMs: Long,
): PreparedDiagnosticPayload = prepareDiagnosticPayload(
    events = snapshot(),
    appInfo = appInfo(),
    accountState = accountState(),
    policy = retentionPolicy(),
    state = state,
    nowEpochMs = nowEpochMs,
)

private fun prepareDiagnosticPayload(
    events: List<SettingsDiagnosticEvent>,
    appInfo: SettingsDiagnosticAppInfo,
    accountState: SettingsDiagnosticAccountState,
    policy: SettingsDiagnosticRetentionPolicy,
    state: SettingsDiagnosticExportState,
    nowEpochMs: Long,
): PreparedDiagnosticPayload {
    val sanitizedEvents = events.map { it.sanitizedForPersistence() }
    val archiveState = SettingsDiagnosticArchiveState(
        account = accountState,
        latestRelease = state.latestRelease?.toDiagnosticReleaseState(),
        databaseSchemaVersion = state.databaseSchemaVersion.coerceAtLeast(0),
        queueCounts = SettingsDiagnosticQueueCounts(
            sync = state.queueCounts.sync.coerceAtLeast(0),
            offline = state.queueCounts.offline.coerceAtLeast(0),
        ),
    )
    val manifest = SettingsDiagnosticArchiveManifest(
        generatedAt = Instant.ofEpochMilli(nowEpochMs).toString(),
        app = appInfo,
        eventCount = sanitizedEvents.size,
        retention = SettingsDiagnosticRetentionManifest(
            maxEvents = policy.maxEvents,
            maxBytes = policy.maxBytes,
            maxAgeMs = policy.maxAgeMs,
        ),
        entries = listOf(MANIFEST_ENTRY, STATE_ENTRY, EVENTS_ENTRY),
        integrityEntry = INTEGRITY_ENTRY,
    )
    val files = linkedMapOf(
        MANIFEST_ENTRY to archiveJson.encodeToString(manifest).toByteArray(Charsets.UTF_8),
        STATE_ENTRY to archiveJson.encodeToString(archiveState).toByteArray(Charsets.UTF_8),
        EVENTS_ENTRY to archiveJson.encodeToString(sanitizedEvents).toByteArray(Charsets.UTF_8),
    )
    val fileIntegrity = files.map { (name, bytes) ->
        SettingsDiagnosticFileIntegrity(name, bytes.size, sha256(bytes))
    }
    val integrity = SettingsDiagnosticArchiveIntegrity(
        files = fileIntegrity,
        aggregateSha256 = aggregateChecksum(fileIntegrity),
    )
    return PreparedDiagnosticPayload(manifest, archiveState, sanitizedEvents, integrity, files)
}

private fun AndroidReleaseDto.toDiagnosticReleaseState(): SettingsDiagnosticReleaseState? {
    val checksum = sha256.lowercase().takeIf { SHA256_PATTERN.matches(it) } ?: return null
    return SettingsDiagnosticReleaseState(
        versionName = safeDiagnosticLabel(versionName, "unknown") ?: "unknown",
        versionCode = versionCode.coerceAtLeast(0),
        sizeBytes = sizeBytes.coerceAtLeast(0),
        sha256 = checksum,
        publishedAt = runCatching { Instant.parse(publishedAt).toString() }.getOrDefault("unknown"),
        apkFile = File(apkFile).name.takeIf { SAFE_APK_FILE.matches(it) } ?: "redacted.apk",
    )
}

private fun aggregateChecksum(files: List<SettingsDiagnosticFileIntegrity>): String = sha256(
    files.joinToString("\n") { "${it.name}:${it.sizeBytes}:${it.sha256}" }
        .toByteArray(Charsets.UTF_8),
)

private fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256")
    .digest(bytes)
    .joinToString("") { byte -> "%02x".format(byte) }

private val SHA256_PATTERN = Regex("^[a-f0-9]{64}$")
private val SAFE_APK_FILE = Regex("^[A-Za-z0-9._-]{1,120}\\.apk$")
private const val MANIFEST_ENTRY = "manifest.json"
private const val STATE_ENTRY = "state.json"
private const val EVENTS_ENTRY = "events.json"
private const val INTEGRITY_ENTRY = "integrity.json"
