package org.sharteman.gymcoach.data.diagnostics

import java.io.File
import java.io.FileOutputStream
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import kotlinx.serialization.SerializationException
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

internal class FileSettingsDiagnosticEventStore(
    directory: File,
    private val policy: SettingsDiagnosticRetentionPolicy = SettingsDiagnosticRetentionPolicy(),
    private val nowEpochMs: () -> Long = System::currentTimeMillis,
) {
    private val file = File(directory, "events-v1.jsonl")
    private val temporaryFile = File(directory, "events-v1.tmp")
    private val json = Json {
        ignoreUnknownKeys = false
        encodeDefaults = true
        explicitNulls = false
    }

    fun append(event: SettingsDiagnosticEvent): Boolean = synchronized(FILE_LOCK) {
        runCatching {
            val events = readUnsafe().toMutableList()
            events += event.sanitizedForPersistence()
            writeUnsafe(bound(events))
            true
        }.getOrDefault(false)
    }

    fun snapshot(): List<SettingsDiagnosticEvent> = synchronized(FILE_LOCK) {
        runCatching {
            val current = readUnsafe()
            val bounded = bound(current)
            if (bounded != current) writeUnsafe(bounded)
            bounded
        }.getOrDefault(emptyList())
    }

    fun clear(): Boolean = synchronized(FILE_LOCK) {
        runCatching {
            Files.deleteIfExists(file.toPath())
            Files.deleteIfExists(temporaryFile.toPath())
            true
        }.getOrDefault(false)
    }

    fun policy(): SettingsDiagnosticRetentionPolicy = policy

    private fun readUnsafe(): List<SettingsDiagnosticEvent> {
        if (!file.isFile) return emptyList()
        return file.useLines(Charsets.UTF_8) { lines ->
            lines.mapNotNull { line ->
                if (line.isBlank() || line.toByteArray().size > MAX_EVENT_BYTES) {
                    null
                } else {
                    try {
                        json.decodeFromString<SettingsDiagnosticEvent>(line)
                            .sanitizedForPersistence()
                    } catch (_: SerializationException) {
                        null
                    } catch (_: IllegalArgumentException) {
                        null
                    }
                }
            }.toList()
        }
    }

    private fun bound(input: List<SettingsDiagnosticEvent>): List<SettingsDiagnosticEvent> {
        val cutoff = nowEpochMs() - policy.maxAgeMs
        val events = input
            .filter { it.schemaVersion == 1 && it.deviceEpochMs >= cutoff }
            .takeLast(policy.maxEvents)
            .toMutableList()
        while (events.isNotEmpty() && encodedSize(events) > policy.maxBytes) {
            events.removeAt(0)
        }
        return events
    }

    private fun encodedSize(events: List<SettingsDiagnosticEvent>): Int =
        events.sumOf { json.encodeToString(it).toByteArray(Charsets.UTF_8).size + 1 }

    private fun writeUnsafe(events: List<SettingsDiagnosticEvent>) {
        file.parentFile?.mkdirs()
        FileOutputStream(temporaryFile).use { output ->
            events.forEach { event ->
                output.write(json.encodeToString(event).toByteArray(Charsets.UTF_8))
                output.write('\n'.code)
            }
            output.fd.sync()
        }
        runCatching {
            Files.move(
                temporaryFile.toPath(),
                file.toPath(),
                StandardCopyOption.ATOMIC_MOVE,
                StandardCopyOption.REPLACE_EXISTING,
            )
        }.recoverCatching {
            Files.move(
                temporaryFile.toPath(),
                file.toPath(),
                StandardCopyOption.REPLACE_EXISTING,
            )
        }.getOrThrow()
    }

    private companion object {
        val FILE_LOCK = Any()
        const val MAX_EVENT_BYTES = 16 * 1024
    }
}
