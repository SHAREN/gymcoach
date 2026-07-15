package org.sharteman.gymcoach.watch.sync

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.sharteman.gymcoach.data.local.WatchPeerEntity
import org.sharteman.gymcoach.watch.data.WatchProtocolCodec
import org.sharteman.gymcoach.watch.domain.WatchEventEnvelopeDto
import org.sharteman.gymcoach.watch.domain.WatchProtocol
import org.sharteman.gymcoach.watch.domain.WatchSyncAckDto
import org.sharteman.gymcoach.watch.domain.WatchSyncSnapshotDto

interface WatchReplaySink {
    suspend fun sendEvent(event: WatchEventEnvelopeDto)
    suspend fun sendSnapshot(snapshot: WatchSyncSnapshotDto)
    suspend fun requestSnapshot(sessionId: String, knownRevision: Long)
}

class WatchReconnectReplayCoordinator(
    private val persistence: WatchSyncPersistence,
    private val sink: WatchReplaySink,
    private val snapshotProvider: suspend (String) -> WatchSyncSnapshotDto?,
    private val codec: WatchProtocolCodec = WatchProtocolCodec(),
    private val nowEpochMs: () -> Long = System::currentTimeMillis,
) : WatchAckConsumer {
    private val mutex = Mutex()

    suspend fun reconnect(sessionId: String, watchDeviceId: String, localRevision: Long) = mutex.withLock {
        val peer = persistence.peer(watchDeviceId)
        val pending = persistence.replayable(sessionId)
        val peerRevision = peer?.lastRevision ?: 0
        when {
            peerRevision > localRevision -> sink.requestSnapshot(sessionId, localRevision)
            pending.isNotEmpty() && pending.first().revision > peerRevision + 1 -> {
                snapshotProvider(sessionId)?.let { sink.sendSnapshot(it) }
            }
            peerRevision < localRevision && pending.isEmpty() -> {
                snapshotProvider(sessionId)?.let { sink.sendSnapshot(it) }
            }
        }
        pending.forEach { queued ->
            val event = codec.decodeEvent(queued.envelopeJson.encodeToByteArray())
            persistence.markAttempt(event.eventId)
            sink.sendEvent(event)
        }
        persistence.savePeer(
            (peer ?: WatchPeerEntity(
                deviceId = watchDeviceId,
                sessionId = sessionId,
                protocolVersion = WatchProtocol.VERSION,
                schemaVersion = WatchProtocol.SCHEMA_VERSION,
                updatedAtEpochMs = nowEpochMs(),
            )).copy(
                sessionId = sessionId,
                lastError = null,
                updatedAtEpochMs = nowEpochMs(),
            ),
        )
    }

    suspend fun observeRemoteRevision(sessionId: String, watchDeviceId: String, revision: Long) = mutex.withLock {
        val peer = persistence.peer(watchDeviceId)
        val known = peer?.lastRevision ?: 0
        if (revision > known + 1) sink.requestSnapshot(sessionId, known)
        persistence.savePeer(
            (peer ?: WatchPeerEntity(
                deviceId = watchDeviceId,
                sessionId = sessionId,
                protocolVersion = WatchProtocol.VERSION,
                schemaVersion = WatchProtocol.SCHEMA_VERSION,
                updatedAtEpochMs = nowEpochMs(),
            )).copy(
                sessionId = sessionId,
                lastRevision = maxOf(known, revision),
                lastSyncAtEpochMs = nowEpochMs(),
                updatedAtEpochMs = nowEpochMs(),
            ),
        )
    }

    override suspend fun onAck(ack: WatchSyncAckDto) {
        persistence.applyAck(ack)
    }
}
