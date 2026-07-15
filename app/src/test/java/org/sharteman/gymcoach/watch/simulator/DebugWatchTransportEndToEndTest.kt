package org.sharteman.gymcoach.watch.simulator

import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.sharteman.gymcoach.watch.data.InMemoryProcessedWatchControlMessageStore
import org.sharteman.gymcoach.watch.data.InMemoryProcessedWatchEventStore
import org.sharteman.gymcoach.watch.domain.WatchEventEnvelopeDto
import org.sharteman.gymcoach.watch.domain.WatchEventSource
import org.sharteman.gymcoach.watch.domain.WatchEventType
import org.sharteman.gymcoach.watch.domain.WatchProtocol
import org.sharteman.gymcoach.watch.domain.WatchSyncAckDto
import org.sharteman.gymcoach.watch.sync.WatchAckConsumer
import org.sharteman.gymcoach.watch.sync.WatchConnectionCoordinator
import org.sharteman.gymcoach.watch.sync.WatchEventConsumer
import org.sharteman.gymcoach.watch.sync.WatchFileConsumer
import org.sharteman.gymcoach.watch.transport.WatchTransportFile

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class DebugWatchTransportEndToEndTest {
    @Test
    fun `debug transport carries phone and watch events acknowledgements and files`() = runTest {
        val transport = DebugWatchSimulatorTransport()
        val watchEvents = mutableListOf<WatchEventEnvelopeDto>()
        val acknowledgements = mutableListOf<WatchSyncAckDto>()
        val files = mutableListOf<WatchTransportFile>()
        val coordinator = WatchConnectionCoordinator(
            phoneDeviceId = "phone-debug-e2e",
            transport = transport,
            processedEventStore = InMemoryProcessedWatchEventStore(),
            processedControlMessageStore = InMemoryProcessedWatchControlMessageStore(),
            scope = this,
            eventConsumer = WatchEventConsumer { watchEvents += it },
            ackConsumer = WatchAckConsumer { acknowledgements += it },
            fileConsumer = WatchFileConsumer { files += it },
        )
        coordinator.connect()
        runCurrent()

        val phoneEvent = event(PHONE_EVENT_ID, WatchEventSource.PHONE, 1)
        coordinator.sendEvent(phoneEvent)
        val watchEvent = event(WATCH_EVENT_ID, WatchEventSource.WATCH, 2)
        transport.sendFromWatch(watchEvent)
        val watchFile = WatchTransportFile(FILE_ID, "watch-file".encodeToByteArray())
        transport.sendFileFromWatch(watchFile)
        advanceUntilIdle()

        assertEquals(listOf(phoneEvent), synchronized(transport.receivedPhoneEvents) {
            transport.receivedPhoneEvents.toList()
        })
        assertEquals(listOf(phoneEvent.eventId), acknowledgements.single().eventIds)
        assertEquals(listOf(watchEvent), watchEvents)
        assertEquals(FILE_ID, files.single().transferId)
        assertTrue(files.single().bytes.contentEquals(watchFile.bytes))
        coordinator.stop()
    }

    private fun event(eventId: String, source: WatchEventSource, revision: Long) = WatchEventEnvelopeDto(
        protocolVersion = WatchProtocol.VERSION,
        schemaVersion = WatchProtocol.SCHEMA_VERSION,
        eventId = eventId,
        sessionId = "mob_session_debug_e2e",
        type = WatchEventType.ACTIVE_EXERCISE_CHANGED,
        timestamp = 1_000 + revision,
        source = source,
        deviceId = if (source == WatchEventSource.PHONE) "phone-debug-e2e" else "watch-debug-e2e",
        revision = revision,
        payload = buildJsonObject { put("exerciseId", "exercise_$revision") },
    )

    private companion object {
        const val PHONE_EVENT_ID = "81000000-0000-0000-0000-000000000001"
        const val WATCH_EVENT_ID = "81000000-0000-0000-0000-000000000002"
        const val FILE_ID = "81000000-0000-0000-0000-000000000003"
    }
}
