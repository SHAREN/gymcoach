package org.sharteman.gymcoach.watch.simulator

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import org.sharteman.gymcoach.watch.data.WatchWorkoutProtocolCodec
import org.sharteman.gymcoach.watch.domain.WatchEventType
import org.sharteman.gymcoach.watch.domain.WatchWorkoutPhase

class DebugWatchWorkoutSimulatorTest {
    @Test
    fun `off wrist batch queues during disconnect and replays after reconnect`() = runTest {
        val codec = WatchWorkoutProtocolCodec()
        val transport = DebugWatchSimulatorTransport(nowEpochMs = { 1_000L })
        val delivered = mutableListOf<Pair<org.sharteman.gymcoach.watch.domain.WatchEventEnvelopeDto, org.sharteman.gymcoach.watch.domain.WatchSensorBatchDto>>()
        var nextId = 1L
        val simulator = DebugWatchWorkoutSimulator(
            transport = transport,
            codec = codec,
            nowEpochMs = { 2_000L },
            newUuid = { "80000000-0000-0000-0000-${(nextId++).toString().padStart(12, '0')}" },
            sensorBatchConsumer = { event, batch -> delivered += event to batch },
        )
        simulator.sendSnapshot(
            codec.decodeSyncSnapshot(resource("sync-snapshot.json").encodeToByteArray()),
        )

        transport.connect()
        transport.disconnect()
        simulator.recordOffWristSample(
            exerciseSessionId = simulator.snapshot.value!!.exerciseSessions.first().exerciseSessionId,
            setId = simulator.snapshot.value!!.setRecords.first().setId,
            phase = WatchWorkoutPhase.REST,
            timestampEpochMs = 3_000L,
        )

        assertEquals(1, simulator.diagnostics.value.pendingDeliveryCount)
        assertEquals(1, simulator.diagnostics.value.invalidHeartRateSampleCount)
        assertEquals(0, delivered.size)

        transport.connect()
        simulator.replayPendingDeliveries()

        assertEquals(1, delivered.size)
        assertEquals(WatchEventType.SENSOR_BATCH_RECORDED, delivered.single().first.type)
        assertFalse(delivered.single().second.samples.single().valid)
        assertEquals("OFF_WRIST", delivered.single().second.samples.single().quality)
        assertEquals("null", delivered.single().second.samples.single().value.toString())
        assertEquals(0, simulator.diagnostics.value.pendingDeliveryCount)
        assertEquals(1, simulator.diagnostics.value.replayedDeliveryCount)
    }

    private fun resource(name: String): String = requireNotNull(javaClass.classLoader?.getResource(name)).readText()
}
