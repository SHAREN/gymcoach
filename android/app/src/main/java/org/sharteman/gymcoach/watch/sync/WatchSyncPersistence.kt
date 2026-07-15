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
    suspend fun incoming(eventId: String): WatchInboxEventEntity?
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

    override suspend fun incoming(eventId: String) = dao.getWatchInboxEvent(eventId)

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
        val mismatchedEvents = outboxEvents.filter { it.sessionId != ack.sessionId }
        val validatesAppliedRevision = ack.status == WatchSyncAckStatus.APPLIED ||
            ack.status == WatchSyncAckStatus.DUPLICATE
        val regressedEvents = outboxEvents.filter { validatesAppliedRevision && ack.revision < it.revision }
        val invalidEvents = (mismatchedEvents + regressedEvents).distinctBy { it.eventId }
        if (invalidEvents.isNotEmpty()) {
            val validationError = if (mismatchedEvents.isNotEmpty()) {
                ACK_SESSION_MISMATCH
            } else {
                ACK_REVISION_REGRESSION
            }
            val remoteAckJson = Json.encodeToString(ack)
            return dao.applyWatchAcknowledgement(
                journal = ack.toJournal(
                    receivedAtEpochMs = acknowledgedAt,
                    status = WatchSyncAckStatus.REJECTED.name,
                    errorCode = validationError,
                ),
                eventIds = emptyList(),
                deleteAcknowledgedEvents = false,
                outboxStatus = "CONFLICT",
                ackStatus = WatchSyncAckStatus.REJECTED.name,
                errorCode = validationError,
                acknowledgedAtEpochMs = acknowledgedAt,
                conflicts = invalidEvents.map { event ->
                    WatchConflictEntity(
                        conflictId = newUuid(),
                        sessionId = event.sessionId,
                        eventId = event.eventId,
                        entityType = event.eventType,
                        entityId = event.eventId,
                        localRevision = event.revision,
                        remoteRevision = ack.revision,
                        localEventJson = event.envelopeJson,
                        remoteEventJson = remoteAckJson,
                        status = "UNRESOLVED",
                        errorCode = validationError,
                        detectedAtEpochMs = acknowledgedAt,
                    )
                },
                peer = null,
            )
        }
        val successful = ack.status == WatchSyncAckStatus.APPLIED ||
            ack.status == WatchSyncAckStatus.DUPLICATE
        val replayableSyncGap = ack.status == WatchSyncAckStatus.REJECTED &&
            ack.errorCode == "SYNC_REQUIRED"
        val outboxStatus = if (replayableSyncGap) {
            "PENDING"
        } else {
            when (ack.status) {
                WatchSyncAckStatus.APPLIED, WatchSyncAckStatus.DUPLICATE -> "ACKNOWLEDGED"
                WatchSyncAckStatus.CONFLICT -> "CONFLICT"
                WatchSyncAckStatus.STALE, WatchSyncAckStatus.REJECTED -> "FAILED"
            }
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
            journal = ack.toJournal(acknowledgedAt),
            eventIds = outboxEvents.map { it.eventId },
            deleteAcknowledgedEvents = successful,
            outboxStatus = outboxStatus,
            ackStatus = ack.status.name,
            errorCode = ack.errorCode,
            acknowledgedAtEpochMs = acknowledgedAt,
            conflicts = conflicts,
            peer = outboxEvents.takeIf { it.isNotEmpty() }?.let {
                WatchPeerEntity(
                    deviceId = ack.deviceId,
                    sessionId = ack.sessionId,
                    protocolVersion = WatchProtocol.VERSION,
                    schemaVersion = WatchProtocol.SCHEMA_VERSION,
                    lastRevision = ack.revision,
                    lastSyncAtEpochMs = acknowledgedAt,
                    lastError = ack.errorCode,
                    updatedAtEpochMs = acknowledgedAt,
                )
            },
        )
        return inserted
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

    override suspend fun incoming(eventId: String) = mutex.withLock { inbox[eventId] }

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
        val acknowledgedEvents = ack.eventIds.mapNotNull(outbox::get)
        val mismatchedEvents = acknowledgedEvents.filter { it.sessionId != ack.sessionId }
        val validatesAppliedRevision = ack.status == WatchSyncAckStatus.APPLIED ||
            ack.status == WatchSyncAckStatus.DUPLICATE
        val regressedEvents = acknowledgedEvents.filter { validatesAppliedRevision && ack.revision < it.revision }
        val invalidEvents = (mismatchedEvents + regressedEvents).distinctBy { it.eventId }
        if (invalidEvents.isNotEmpty()) {
            val validationError = if (mismatchedEvents.isNotEmpty()) {
                ACK_SESSION_MISMATCH
            } else {
                ACK_REVISION_REGRESSION
            }
            val remoteAckJson = Json.encodeToString(ack)
            invalidEvents.forEach { event ->
                conflictRecords += WatchConflictEntity(
                    newUuid(), event.sessionId, event.eventId, event.eventType, event.eventId,
                    event.revision, ack.revision, event.envelopeJson, remoteAckJson,
                    "UNRESOLVED", validationError, nowEpochMs(),
                )
            }
            return@withLock true
        }
        ack.eventIds.forEach { eventId ->
            val event = outbox[eventId] ?: return@forEach
            if (ack.status == WatchSyncAckStatus.APPLIED || ack.status == WatchSyncAckStatus.DUPLICATE) {
                outbox.remove(eventId)
                return@forEach
            }
            val status = if (ack.status == WatchSyncAckStatus.REJECTED && ack.errorCode == "SYNC_REQUIRED") {
                "PENDING"
            } else {
                when (ack.status) {
                    WatchSyncAckStatus.APPLIED, WatchSyncAckStatus.DUPLICATE -> error("Handled above")
                    WatchSyncAckStatus.CONFLICT -> "CONFLICT"
                    else -> "FAILED"
                }
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
        if (acknowledgedEvents.isNotEmpty()) {
            val peer = peers[ack.deviceId]
            peers[ack.deviceId] = if (peer?.sessionId == ack.sessionId) {
                peer.copy(
                    lastRevision = maxOf(peer.lastRevision, ack.revision),
                    lastSyncAtEpochMs = maxOf(peer.lastSyncAtEpochMs ?: 0, nowEpochMs()),
                    lastError = ack.errorCode,
                    updatedAtEpochMs = maxOf(peer.updatedAtEpochMs, nowEpochMs()),
                )
            } else if (peer == null) {
                WatchPeerEntity(
                    ack.deviceId, ack.sessionId, WatchProtocol.VERSION, WatchProtocol.SCHEMA_VERSION,
                    lastRevision = ack.revision, lastSyncAtEpochMs = nowEpochMs(),
                    lastError = ack.errorCode, updatedAtEpochMs = nowEpochMs(),
                )
            } else {
                peer
            }
        }
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

private fun WatchSyncAckDto.toJournal(
    receivedAtEpochMs: Long,
    status: String = this.status.name,
    errorCode: String? = this.errorCode,
) = WatchAckJournalEntity(
    ackId = ackId,
    sessionId = sessionId,
    eventIdsJson = Json.encodeToString(eventIds),
    status = status,
    revision = revision,
    errorCode = errorCode,
    source = source.name,
    deviceId = deviceId,
    receivedAtEpochMs = receivedAtEpochMs,
)

private const val ACK_SESSION_MISMATCH = "ACK_SESSION_MISMATCH"
private const val ACK_REVISION_REGRESSION = "ACK_REVISION_REGRESSION"

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
