package org.sharteman.gymcoach.watch.sync

import java.util.UUID
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.sharteman.gymcoach.data.local.GymCoachDao
import org.sharteman.gymcoach.data.local.WatchAckJournalEntity
import org.sharteman.gymcoach.data.local.WatchConflictEntity
import org.sharteman.gymcoach.data.local.WatchFileTransferEntity
import org.sharteman.gymcoach.data.local.WatchInboxEventEntity
import org.sharteman.gymcoach.data.local.WatchOutboxEventEntity
import org.sharteman.gymcoach.data.local.WatchPeerEntity
import org.sharteman.gymcoach.watch.data.CanonicalJson
import org.sharteman.gymcoach.watch.domain.WatchEventEnvelopeDto
import org.sharteman.gymcoach.watch.domain.WatchFileTransferEnvelopeDto
import org.sharteman.gymcoach.watch.domain.WatchProtocol
import org.sharteman.gymcoach.watch.domain.WatchSyncAckDto
import org.sharteman.gymcoach.watch.domain.WatchSyncAckStatus

enum class WatchInboxRegistration {
    NEW,
    DUPLICATE,
    EVENT_ID_REUSE,
}

data class WatchInboxRecordResult(
    val registration: WatchInboxRegistration,
    val existing: WatchInboxEventEntity? = null,
)

interface WatchSyncPersistence {
    suspend fun recordIncoming(event: WatchEventEnvelopeDto): WatchInboxRecordResult
    suspend fun finishIncoming(
        eventId: String,
        status: WatchSyncAckStatus,
        revision: Long,
        errorCode: String?,
    )

    suspend fun enqueue(event: WatchEventEnvelopeDto, relatedTransferId: String? = null): Boolean
    suspend fun replayable(sessionId: String? = null): List<WatchOutboxEventEntity>
    suspend fun markAttempt(eventId: String)
    suspend fun applyAck(ack: WatchSyncAckDto): Boolean
    suspend fun peer(deviceId: String): WatchPeerEntity?
    suspend fun savePeer(peer: WatchPeerEntity)
    suspend fun conflicts(sessionId: String): List<WatchConflictEntity>
    suspend fun saveFile(envelope: WatchFileTransferEnvelopeDto, direction: String, status: String, error: String? = null)
    suspend fun filesForEvent(eventId: String): List<WatchFileTransferEntity>
    suspend fun filesForTransfer(transferId: String): List<WatchFileTransferEntity>
}

class RoomWatchSyncPersistence(
    private val dao: GymCoachDao,
    private val nowEpochMs: () -> Long = System::currentTimeMillis,
    private val newUuid: () -> String = { UUID.randomUUID().toString() },
) : WatchSyncPersistence {
    private val json = Json { explicitNulls = true; encodeDefaults = true }

    override suspend fun recordIncoming(event: WatchEventEnvelopeDto): WatchInboxRecordResult {
        val canonical = CanonicalJson.event(event)
        val entity = WatchInboxEventEntity(
            eventId = event.eventId,
            sessionId = event.sessionId,
            revision = event.revision,
            timestampEpochMs = event.timestamp,
            canonicalEventHash = canonical.sha256,
            envelopeJson = canonical.json,
            receivedAtEpochMs = nowEpochMs(),
        )
        if (dao.insertWatchInboxEvent(entity) != -1L) return WatchInboxRecordResult(WatchInboxRegistration.NEW)
        val existing = dao.getWatchInboxEvent(event.eventId)
        return WatchInboxRecordResult(
            registration = when {
                existing?.canonicalEventHash != canonical.sha256 -> WatchInboxRegistration.EVENT_ID_REUSE
                existing.status == "PROCESSED" -> WatchInboxRegistration.DUPLICATE
                else -> WatchInboxRegistration.NEW
            },
            existing = existing,
        )
    }

    override suspend fun finishIncoming(
        eventId: String,
        status: WatchSyncAckStatus,
        revision: Long,
        errorCode: String?,
    ) = dao.finishWatchInboxEvent(
        eventId = eventId,
        status = "PROCESSED",
        resultStatus = status.name,
        resultRevision = revision,
        errorCode = errorCode,
        processedAtEpochMs = nowEpochMs(),
    )

    override suspend fun enqueue(event: WatchEventEnvelopeDto, relatedTransferId: String?): Boolean {
        val canonical = CanonicalJson.event(event)
        return dao.insertWatchOutboxEvent(
            WatchOutboxEventEntity(
                eventId = event.eventId,
                sessionId = event.sessionId,
                revision = event.revision,
                timestampEpochMs = event.timestamp,
                eventType = event.type.name,
                canonicalEventHash = canonical.sha256,
                envelopeJson = canonical.json,
                relatedTransferId = relatedTransferId,
                createdAtEpochMs = nowEpochMs(),
            ),
        ) != -1L
    }

    override suspend fun replayable(sessionId: String?) = if (sessionId == null) {
        dao.getReplayableWatchOutboxEvents()
    } else {
        dao.getReplayableWatchOutboxEvents(sessionId)
    }

    override suspend fun markAttempt(eventId: String) = dao.markWatchOutboxAttempt(eventId, nowEpochMs())

    override suspend fun applyAck(ack: WatchSyncAckDto): Boolean {
        val acknowledgedAt = nowEpochMs()
        val outboxEvents = ack.eventIds.mapNotNull { dao.getWatchOutboxEvent(it) }
        val outboxStatus = when (ack.status) {
            WatchSyncAckStatus.APPLIED, WatchSyncAckStatus.DUPLICATE -> "ACKNOWLEDGED"
            WatchSyncAckStatus.CONFLICT -> "CONFLICT"
            WatchSyncAckStatus.STALE, WatchSyncAckStatus.REJECTED -> "FAILED"
        }
        val conflicts = if (ack.status == WatchSyncAckStatus.CONFLICT) {
            outboxEvents.map { event ->
                WatchConflictEntity(
                    conflictId = newUuid(),
                    sessionId = ack.sessionId,
                    eventId = event.eventId,
                    entityType = event.eventType,
                    entityId = event.eventId,
                    localRevision = event.revision,
                    remoteRevision = ack.revision,
                    localEventJson = event.envelopeJson,
                    remoteEventJson = "",
                    status = "UNRESOLVED",
                    errorCode = ack.errorCode,
                    detectedAtEpochMs = acknowledgedAt,
                )
            }
        } else {
            emptyList()
        }
        val inserted = dao.applyWatchAcknowledgement(
            journal = WatchAckJournalEntity(
                ackId = ack.ackId,
                sessionId = ack.sessionId,
                eventIdsJson = json.encodeToString(ack.eventIds),
                status = ack.status.name,
                revision = ack.revision,
                errorCode = ack.errorCode,
                source = ack.source.name,
                deviceId = ack.deviceId,
                receivedAtEpochMs = acknowledgedAt,
            ),
            eventIds = outboxEvents.map { it.eventId },
            outboxStatus = outboxStatus,
            ackStatus = ack.status.name,
            errorCode = ack.errorCode,
            acknowledgedAtEpochMs = acknowledgedAt,
            conflicts = conflicts,
        )
        if (!inserted) return false
        val existingPeer = dao.getWatchPeer(ack.deviceId)
        dao.saveWatchPeer(
            (existingPeer ?: WatchPeerEntity(
                deviceId = ack.deviceId,
                sessionId = ack.sessionId,
                protocolVersion = WatchProtocol.VERSION,
                schemaVersion = WatchProtocol.SCHEMA_VERSION,
                updatedAtEpochMs = nowEpochMs(),
            )).copy(
                sessionId = ack.sessionId,
                lastRevision = maxOf(existingPeer?.lastRevision ?: 0, ack.revision),
                lastSyncAtEpochMs = nowEpochMs(),
                lastError = ack.errorCode,
                updatedAtEpochMs = nowEpochMs(),
            ),
        )
        return true
    }

    override suspend fun peer(deviceId: String) = dao.getWatchPeer(deviceId)
    override suspend fun savePeer(peer: WatchPeerEntity) = dao.saveWatchPeer(peer)
    override suspend fun conflicts(sessionId: String) = dao.getWatchConflicts(sessionId)

    override suspend fun saveFile(
        envelope: WatchFileTransferEnvelopeDto,
        direction: String,
        status: String,
        error: String?,
    ) = dao.saveWatchFileTransfer(envelope.toEntity(direction, status, error, nowEpochMs()))

    override suspend fun filesForEvent(eventId: String) = dao.getWatchFileTransfersForEvent(eventId)
    override suspend fun filesForTransfer(transferId: String) = dao.getWatchFileTransferParts(transferId)
}

class InMemoryWatchSyncPersistence(
    private val nowEpochMs: () -> Long = System::currentTimeMillis,
    private val newUuid: () -> String = { UUID.randomUUID().toString() },
) : WatchSyncPersistence {
    private val mutex = Mutex()
    private val inbox = linkedMapOf<String, WatchInboxEventEntity>()
    private val outbox = linkedMapOf<String, WatchOutboxEventEntity>()
    private val acks = mutableSetOf<String>()
    private val peers = mutableMapOf<String, WatchPeerEntity>()
    private val conflictRecords = mutableListOf<WatchConflictEntity>()
    private val files = mutableMapOf<Pair<String, Int>, WatchFileTransferEntity>()

    override suspend fun recordIncoming(event: WatchEventEnvelopeDto) = mutex.withLock {
        val canonical = CanonicalJson.event(event)
        val existing = inbox[event.eventId]
        if (existing != null) {
            return@withLock WatchInboxRecordResult(
                when {
                    existing.canonicalEventHash != canonical.sha256 -> WatchInboxRegistration.EVENT_ID_REUSE
                    existing.status == "PROCESSED" -> WatchInboxRegistration.DUPLICATE
                    else -> WatchInboxRegistration.NEW
                },
                existing,
            )
        }
        inbox[event.eventId] = WatchInboxEventEntity(
            event.eventId, event.sessionId, event.revision, event.timestamp, canonical.sha256,
            canonical.json, receivedAtEpochMs = nowEpochMs(),
        )
        WatchInboxRecordResult(WatchInboxRegistration.NEW)
    }

    override suspend fun finishIncoming(eventId: String, status: WatchSyncAckStatus, revision: Long, errorCode: String?) {
        mutex.withLock {
            inbox[eventId]?.let {
                inbox[eventId] = it.copy(
                    status = "PROCESSED", resultStatus = status.name, resultRevision = revision,
                    errorCode = errorCode, processedAtEpochMs = nowEpochMs(),
                )
            }
        }
    }

    override suspend fun enqueue(event: WatchEventEnvelopeDto, relatedTransferId: String?) = mutex.withLock {
        if (outbox.containsKey(event.eventId)) return@withLock false
        val canonical = CanonicalJson.event(event)
        outbox[event.eventId] = WatchOutboxEventEntity(
            event.eventId, event.sessionId, event.revision, event.timestamp, event.type.name,
            canonical.sha256, canonical.json, relatedTransferId = relatedTransferId,
            createdAtEpochMs = nowEpochMs(),
        )
        true
    }

    override suspend fun replayable(sessionId: String?) = mutex.withLock {
        outbox.values.filter { it.status == "PENDING" || it.status == "SENT" }
            .filter { sessionId == null || it.sessionId == sessionId }
            .sortedWith(compareBy<WatchOutboxEventEntity> { it.revision }.thenBy { it.timestampEpochMs }.thenBy { it.eventId })
    }

    override suspend fun markAttempt(eventId: String) {
        mutex.withLock {
            outbox[eventId]?.let {
                outbox[eventId] = it.copy(status = "SENT", attempts = it.attempts + 1, lastAttemptAtEpochMs = nowEpochMs())
            }
        }
    }

    override suspend fun applyAck(ack: WatchSyncAckDto) = mutex.withLock {
        if (!acks.add(ack.ackId)) return@withLock false
        ack.eventIds.forEach { eventId ->
            val event = outbox[eventId] ?: return@forEach
            val status = when (ack.status) {
                WatchSyncAckStatus.APPLIED, WatchSyncAckStatus.DUPLICATE -> "ACKNOWLEDGED"
                WatchSyncAckStatus.CONFLICT -> "CONFLICT"
                else -> "FAILED"
            }
            outbox[eventId] = event.copy(
                status = status, ackStatus = ack.status.name, errorCode = ack.errorCode,
                acknowledgedAtEpochMs = nowEpochMs(),
            )
            if (ack.status == WatchSyncAckStatus.CONFLICT) {
                conflictRecords += WatchConflictEntity(
                    newUuid(), ack.sessionId, eventId, event.eventType, eventId, event.revision,
                    ack.revision, event.envelopeJson, "", "UNRESOLVED", ack.errorCode, nowEpochMs(),
                )
            }
        }
        val peer = peers[ack.deviceId]
        peers[ack.deviceId] = (peer ?: WatchPeerEntity(
            ack.deviceId, ack.sessionId, WatchProtocol.VERSION, WatchProtocol.SCHEMA_VERSION,
            updatedAtEpochMs = nowEpochMs(),
        )).copy(
            sessionId = ack.sessionId,
            lastRevision = maxOf(peer?.lastRevision ?: 0, ack.revision),
            lastSyncAtEpochMs = nowEpochMs(), lastError = ack.errorCode, updatedAtEpochMs = nowEpochMs(),
        )
        true
    }

    override suspend fun peer(deviceId: String) = mutex.withLock { peers[deviceId] }
    override suspend fun savePeer(peer: WatchPeerEntity) { mutex.withLock { peers[peer.deviceId] = peer } }
    override suspend fun conflicts(sessionId: String) = mutex.withLock { conflictRecords.filter { it.sessionId == sessionId } }

    override suspend fun saveFile(envelope: WatchFileTransferEnvelopeDto, direction: String, status: String, error: String?) {
        mutex.withLock { files[envelope.transferId to envelope.sequence] = envelope.toEntity(direction, status, error, nowEpochMs()) }
    }

    override suspend fun filesForEvent(eventId: String) = mutex.withLock {
        files.values.filter { it.relatedEventId == eventId }.sortedBy { it.sequence }
    }

    override suspend fun filesForTransfer(transferId: String) = mutex.withLock {
        files.values.filter { it.transferId == transferId }.sortedBy { it.sequence }
    }
}

private fun WatchFileTransferEnvelopeDto.toEntity(
    direction: String,
    status: String,
    error: String?,
    nowEpochMs: Long,
) = WatchFileTransferEntity(
    transferId = transferId,
    sequence = sequence,
    sessionId = sessionId,
    relatedEventId = relatedEventId,
    payloadType = payloadType.name,
    payloadId = payloadId,
    totalSequences = totalSequences,
    byteLength = byteLength,
    sha256 = sha256,
    source = source.name,
    deviceId = deviceId,
    direction = direction,
    status = status,
    canonicalPayloadJson = CanonicalJson.value(payload).json,
    errorCode = error,
    createdAtEpochMs = createdAt,
    updatedAtEpochMs = nowEpochMs,
)
