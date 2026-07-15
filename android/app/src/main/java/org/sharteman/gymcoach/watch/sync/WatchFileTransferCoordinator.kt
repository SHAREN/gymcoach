package org.sharteman.gymcoach.watch.sync

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.sharteman.gymcoach.watch.data.WatchFileTransferCodec
import org.sharteman.gymcoach.watch.data.WatchWorkoutProtocolCodec
import org.sharteman.gymcoach.watch.domain.SensorBatchRecordedPayloadDto
import org.sharteman.gymcoach.watch.domain.WatchEventEnvelopeDto
import org.sharteman.gymcoach.watch.domain.WatchEventType
import org.sharteman.gymcoach.watch.domain.WatchFilePayloadType
import org.sharteman.gymcoach.watch.domain.WatchProtocolErrorCode
import org.sharteman.gymcoach.watch.domain.WatchProtocolException
import org.sharteman.gymcoach.watch.domain.WatchSensorBatchDto
import org.sharteman.gymcoach.watch.transport.WatchTransportFile

data class WatchFileReceiveResult(
    val accepted: Boolean,
    val transferId: String? = null,
    val sequence: Int? = null,
    val errorCode: String? = null,
)

class WatchFileTransferCoordinator(
    private val persistence: WatchSyncPersistence,
    private val fileCodec: WatchFileTransferCodec = WatchFileTransferCodec(),
    private val workoutCodec: WatchWorkoutProtocolCodec = WatchWorkoutProtocolCodec(),
) : WatchFileConsumer {
    private val json = Json { ignoreUnknownKeys = false; isLenient = false }

    override suspend fun onFile(file: WatchTransportFile) {
        receive(file.bytes)
    }

    suspend fun receive(bytes: ByteArray): WatchFileReceiveResult = try {
        val validated = fileCodec.decode(bytes)
        persistence.saveFile(validated.envelope, direction = "INCOMING", status = "RECEIVED")
        WatchFileReceiveResult(
            accepted = true,
            transferId = validated.envelope.transferId,
            sequence = validated.envelope.sequence,
        )
    } catch (error: WatchProtocolException) {
        WatchFileReceiveResult(accepted = false, errorCode = error.code.name)
    }

    suspend fun sensorBatchForEvent(event: WatchEventEnvelopeDto): WatchSensorBatchDto {
        if (event.type != WatchEventType.SENSOR_BATCH_RECORDED) {
            throw WatchProtocolException(WatchProtocolErrorCode.FILE_PAIR_MISMATCH)
        }
        val manifest = workoutCodec.decodeSensorBatchRecordedPayload(event.payload)
        val eventFiles = persistence.filesForEvent(event.eventId)
        val part = eventFiles.singleOrNull {
            it.payloadId == manifest.batchId &&
                it.sequence == manifest.sequence &&
                it.totalSequences == manifest.totalSequences &&
                it.payloadType == WatchFilePayloadType.SENSOR_BATCH.name &&
                it.sessionId == event.sessionId &&
                it.source == event.source.name &&
                it.deviceId == event.deviceId &&
                it.status == "RECEIVED"
        } ?: throw WatchProtocolException(
            if (eventFiles.isEmpty()) WatchProtocolErrorCode.FILE_SEQUENCE_GAP else WatchProtocolErrorCode.FILE_PAIR_MISMATCH,
        )
        val allParts = persistence.filesForTransfer(part.transferId)
        validateCompleteSequence(allParts.map { it.sequence }, manifest)
        if (allParts.any {
                it.totalSequences != manifest.totalSequences ||
                    it.payloadId != manifest.batchId ||
                    it.payloadType != WatchFilePayloadType.SENSOR_BATCH.name ||
                    it.sessionId != event.sessionId ||
                    it.status != "RECEIVED"
            }
        ) throw WatchProtocolException(WatchProtocolErrorCode.FILE_PAIR_MISMATCH)
        val payloadJson = part.canonicalPayloadJson
            ?: throw WatchProtocolException(WatchProtocolErrorCode.FILE_PAIR_MISMATCH)
        val payload = json.parseToJsonElement(payloadJson).jsonObject
        val batch = workoutCodec.decodeSensorBatch(payload.toString().encodeToByteArray())
        if (
            batch.batchId != manifest.batchId ||
            batch.sequence != manifest.sequence ||
            batch.totalSequences != manifest.totalSequences ||
            batch.sampleCount != manifest.sampleCount
        ) throw WatchProtocolException(WatchProtocolErrorCode.FILE_PAIR_MISMATCH)
        return batch
    }

    suspend fun applySensorBatchFile(
        event: WatchEventEnvelopeDto,
        coordinator: WatchWorkoutCoordinator,
    ) {
        coordinator.onSensorBatch(event, sensorBatchForEvent(event))
    }

    private fun validateCompleteSequence(sequences: List<Int>, manifest: SensorBatchRecordedPayloadDto) {
        if (sequences.distinct().sorted() != (1..manifest.totalSequences).toList()) {
            throw WatchProtocolException(WatchProtocolErrorCode.FILE_SEQUENCE_GAP)
        }
    }
}
