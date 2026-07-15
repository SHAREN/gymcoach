package org.sharteman.gymcoach.watch.sync

import java.util.UUID
import kotlinx.coroutines.CoroutineScope
import kotlinx.serialization.json.put
import org.sharteman.gymcoach.data.local.GymCoachDao
import org.sharteman.gymcoach.data.local.LocalSetEntity
import org.sharteman.gymcoach.data.repository.GymCoachRepository
import org.sharteman.gymcoach.watch.data.GymCoachWatchWorkoutRepository
import org.sharteman.gymcoach.watch.data.InMemoryProcessedWatchControlMessageStore
import org.sharteman.gymcoach.watch.data.InMemoryProcessedWatchEventStore
import org.sharteman.gymcoach.watch.data.PersistentWatchWorkoutGateway
import org.sharteman.gymcoach.watch.domain.ActiveExerciseChangedPayloadDto
import org.sharteman.gymcoach.watch.domain.RestFinishedPayloadDto
import org.sharteman.gymcoach.watch.domain.RestHeartRateSummaryDto
import org.sharteman.gymcoach.watch.domain.RestSkippedPayloadDto
import org.sharteman.gymcoach.watch.domain.RestStartedPayloadDto
import org.sharteman.gymcoach.watch.domain.RestUpdatedPayloadDto
import org.sharteman.gymcoach.watch.domain.SetDeletedPayloadDto
import org.sharteman.gymcoach.watch.domain.WatchConnectionStatus
import org.sharteman.gymcoach.watch.domain.WatchControlMessageDto
import org.sharteman.gymcoach.watch.domain.WatchControlMessageType
import org.sharteman.gymcoach.watch.domain.WatchEventEnvelopeDto
import org.sharteman.gymcoach.watch.domain.WatchEventSource
import org.sharteman.gymcoach.watch.domain.WatchProtocol
import org.sharteman.gymcoach.watch.domain.WatchSyncAckDto
import org.sharteman.gymcoach.watch.domain.WatchSyncSnapshotDto
import org.sharteman.gymcoach.watch.transport.WatchTransport

class WatchCompanionRuntime private constructor(
    val transport: WatchTransport,
    val connectionCoordinator: WatchConnectionCoordinator,
    val workoutCoordinator: WatchWorkoutCoordinator,
    val inboundEventRouter: WatchInboundEventRouter,
    val fileTransferCoordinator: WatchFileTransferCoordinator,
    val persistence: WatchSyncPersistence,
    val workoutGateway: PersistentWatchWorkoutGateway,
    val phoneCommands: WatchPhoneCommandPublisher,
    val transportConfigured: Boolean,
    private val latestRuntimeProvider: suspend () -> org.sharteman.gymcoach.data.local.ActiveWorkoutRuntimeEntity?,
) : AutoCloseable {
    val state = connectionCoordinator.state

    fun start() = connectionCoordinator.start()

    suspend fun connect() {
        check(transportConfigured) { "Official Huawei Wear Engine transport is unavailable" }
        connectionCoordinator.connect()
    }

    suspend fun disconnect() = connectionCoordinator.disconnect()

    suspend fun forceSync() {
        val runtime = latestRuntimeProvider() ?: return
        if (state.value.connectionStatus != WatchConnectionStatus.CONNECTED) connect()
        workoutCoordinator.replayPending(runtime.sessionId)
    }

    override fun close() = connectionCoordinator.stop()

    companion object {
        fun create(
            phoneDeviceId: String,
            watchDeviceId: String,
            dao: GymCoachDao,
            repository: GymCoachRepository,
            transport: WatchTransport,
            scope: CoroutineScope,
            transportConfigured: Boolean,
            nowEpochMs: () -> Long = System::currentTimeMillis,
            newUuid: () -> String = { UUID.randomUUID().toString() },
        ): WatchCompanionRuntime {
            val persistence = RoomWatchSyncPersistence(dao, nowEpochMs, newUuid)
            val workoutRepository = GymCoachWatchWorkoutRepository(repository)
            val gateway = PersistentWatchWorkoutGateway(
                repository = workoutRepository,
                phoneDeviceId = phoneDeviceId,
                nowEpochMs = nowEpochMs,
                newUuid = newUuid,
            )
            val dispatch = CoordinatorDispatch(phoneDeviceId, nowEpochMs, newUuid)
            val workoutCoordinator = WatchWorkoutCoordinator(
                gateway = gateway,
                sink = dispatch,
                phoneDeviceId = phoneDeviceId,
                nowEpochMs = nowEpochMs,
                newUuid = newUuid,
                syncPersistence = persistence,
            )
            val fileCoordinator = WatchFileTransferCoordinator(persistence)
            val router = WatchInboundEventRouter(persistence, workoutCoordinator, fileCoordinator)
            val reconnect = WatchReconnectReplayCoordinator(
                persistence = persistence,
                sink = dispatch,
                snapshotProvider = gateway::buildSnapshot,
                nowEpochMs = nowEpochMs,
            )
            val connection = WatchConnectionCoordinator(
                phoneDeviceId = phoneDeviceId,
                transport = transport,
                processedEventStore = InMemoryProcessedWatchEventStore(),
                processedControlMessageStore = InMemoryProcessedWatchControlMessageStore(),
                scope = scope,
                eventConsumer = router,
                ackConsumer = reconnect,
                fileConsumer = router,
                lifecycleConsumer = WatchConnectionLifecycleConsumer { status ->
                    if (status == WatchConnectionStatus.CONNECTED) {
                        repository.latestActiveWorkoutRuntime()?.let { runtime ->
                            reconnect.reconnect(runtime.sessionId, watchDeviceId, runtime.revision)
                        }
                    }
                },
                nowEpochMs = nowEpochMs,
                newId = newUuid,
            )
            dispatch.attach(connection)
            val integration = WatchIntegrationRuntime(
                phoneDeviceId = phoneDeviceId,
                persistence = persistence,
                dispatch = dispatch,
                snapshotProvider = gateway::buildSnapshot,
                nowEpochMs = nowEpochMs,
                newUuid = newUuid,
            )
            val publisher = RuntimeWatchPhoneCommandPublisher(integration, gateway)
            return WatchCompanionRuntime(
                transport = transport,
                connectionCoordinator = connection,
                workoutCoordinator = workoutCoordinator,
                inboundEventRouter = router,
                fileTransferCoordinator = fileCoordinator,
                persistence = persistence,
                workoutGateway = gateway,
                phoneCommands = publisher,
                transportConfigured = transportConfigured,
                latestRuntimeProvider = repository::latestActiveWorkoutRuntime,
            )
        }
    }
}

private class CoordinatorDispatch(
    private val phoneDeviceId: String,
    private val nowEpochMs: () -> Long,
    private val newUuid: () -> String,
) : WatchWorkoutResponseSink, WatchIntegrationDispatch, WatchReplaySink {
    private lateinit var connection: WatchConnectionCoordinator

    fun attach(connection: WatchConnectionCoordinator) {
        this.connection = connection
    }

    override suspend fun sendEvent(event: WatchEventEnvelopeDto) = connection.sendEvent(event)
    override suspend fun sendSnapshot(snapshot: WatchSyncSnapshotDto) = connection.sendSnapshot(snapshot)
    override suspend fun sendAck(ack: WatchSyncAckDto) = connection.sendAck(ack)

    override suspend fun requestSnapshot(sessionId: String, knownRevision: Long) {
        connection.sendControlMessage(
            WatchControlMessageDto(
                protocolVersion = WatchProtocol.VERSION,
                schemaVersion = WatchProtocol.SCHEMA_VERSION,
                messageId = newUuid(),
                type = WatchControlMessageType.SYNC_REQUESTED,
                timestamp = nowEpochMs(),
                source = WatchEventSource.PHONE,
                deviceId = phoneDeviceId,
                replyTo = null,
                payload = kotlinx.serialization.json.buildJsonObject {
                    put("sessionId", sessionId)
                    put("knownRevision", knownRevision)
                },
            ),
        )
    }
}

private class RuntimeWatchPhoneCommandPublisher(
    private val runtime: WatchIntegrationRuntime,
    private val gateway: PersistentWatchWorkoutGateway,
) : WatchPhoneCommandPublisher {
    override suspend fun workoutStarted(sessionId: String, revision: Long, startedAtEpochMs: Long) {
        runtime.startWorkout(sessionId, revision, startedAtEpochMs)
    }

    override suspend fun activeExerciseChanged(
        sessionId: String,
        exerciseId: String,
        revision: Long,
        changedAtEpochMs: Long,
    ) {
        val exercise = requireNotNull(gateway.buildSnapshot(sessionId))
            .exerciseSessions.first { it.exerciseId == exerciseId }
        runtime.changeExercise(
            sessionId,
            revision,
            ActiveExerciseChangedPayloadDto(exercise.exerciseId, exercise.exerciseSessionId, exercise.order),
            changedAtEpochMs,
        )
    }

    override suspend fun setCompleted(set: LocalSetEntity, revision: Long) {
        runtime.completeSet(set.sessionId, revision, setRecord(set, revision))
    }

    override suspend fun setUpdated(set: LocalSetEntity, revision: Long) {
        runtime.editSet(set.sessionId, revision, setRecord(set, revision))
    }

    override suspend fun setDeleted(
        sessionId: String,
        setId: String,
        revision: Long,
        baseRevision: Long,
        deletedAtEpochMs: Long,
    ) {
        runtime.deleteSet(
            sessionId,
            revision,
            SetDeletedPayloadDto(setId, deletedAtEpochMs, baseRevision),
            deletedAtEpochMs,
        )
    }

    override suspend fun restStarted(
        sessionId: String,
        setId: String,
        revision: Long,
        startedAtEpochMs: Long,
        endsAtEpochMs: Long,
    ) {
        runtime.startRest(
            sessionId,
            revision,
            RestStartedPayloadDto(setId, startedAtEpochMs, endsAtEpochMs),
            startedAtEpochMs,
        )
    }

    override suspend fun restUpdated(
        sessionId: String,
        revision: Long,
        endsAtEpochMs: Long,
        reason: String,
        changedAtEpochMs: Long,
    ) {
        runtime.updateRest(sessionId, revision, RestUpdatedPayloadDto(endsAtEpochMs, reason), changedAtEpochMs)
    }

    override suspend fun restFinished(
        sessionId: String,
        revision: Long,
        startedAtEpochMs: Long,
        finishedAtEpochMs: Long,
    ) {
        runtime.finishRest(
            sessionId,
            revision,
            RestFinishedPayloadDto(
                finishedAt = finishedAtEpochMs,
                summary = RestHeartRateSummaryDto(
                    startedAt = startedAtEpochMs,
                    finishedAt = finishedAtEpochMs,
                    start = null,
                    min = null,
                    average = null,
                    at30Seconds = null,
                    at60Seconds = null,
                    drop30Seconds = null,
                    drop60Seconds = null,
                    sampleCount = 0,
                ),
            ),
            finishedAtEpochMs,
        )
    }

    override suspend fun restSkipped(sessionId: String, revision: Long, skippedAtEpochMs: Long) {
        runtime.skipRest(sessionId, revision, RestSkippedPayloadDto(skippedAtEpochMs), skippedAtEpochMs)
    }

    override suspend fun workoutFinished(sessionId: String, revision: Long, finishedAtEpochMs: Long) {
        runtime.finishWorkout(sessionId, revision, finishedAtEpochMs)
    }

    private suspend fun setRecord(set: LocalSetEntity, revision: Long) =
        requireNotNull(gateway.buildSnapshot(set.sessionId))
            .setRecords.first { it.setId == set.id }
            .copy(revision = revision, source = WatchEventSource.PHONE)
}
