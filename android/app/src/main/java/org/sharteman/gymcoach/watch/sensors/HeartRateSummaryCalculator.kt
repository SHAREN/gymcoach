package org.sharteman.gymcoach.watch.sensors

import kotlin.math.abs
import org.sharteman.gymcoach.watch.domain.RestHeartRateSummaryDto

data class HeartRateObservation(
    val sampleId: String,
    val timestampEpochMs: Long,
    val sensorType: String,
    val value: Double?,
    val valid: Boolean,
)

data class HeartRateWindowSummary(
    val start: Double?,
    val end: Double?,
    val min: Double?,
    val max: Double?,
    val average: Double?,
    val sampleCount: Int,
)

object HeartRateSummaryCalculator {
    fun setSummary(
        samples: List<HeartRateObservation>,
        startedAtEpochMs: Long,
        finishedAtEpochMs: Long,
    ): HeartRateWindowSummary {
        val valid = validSamples(samples, startedAtEpochMs, finishedAtEpochMs)
        return HeartRateWindowSummary(
            start = valid.nearest(startedAtEpochMs)?.value,
            end = valid.nearest(finishedAtEpochMs)?.value,
            min = valid.minOfOrNull { it.value },
            max = valid.maxOfOrNull { it.value },
            average = valid.takeIf { it.isNotEmpty() }?.map { it.value }?.average(),
            sampleCount = valid.size,
        )
    }

    fun restSummary(
        samples: List<HeartRateObservation>,
        startedAtEpochMs: Long,
        finishedAtEpochMs: Long,
    ): RestHeartRateSummaryDto {
        val valid = validSamples(samples, startedAtEpochMs, finishedAtEpochMs)
        val start = valid.nearest(startedAtEpochMs)?.value
        val at30 = valid.nearest(startedAtEpochMs + 30_000L)?.value
        val at60 = valid.nearest(startedAtEpochMs + 60_000L)?.value
        return RestHeartRateSummaryDto(
            startedAt = startedAtEpochMs,
            finishedAt = finishedAtEpochMs,
            start = start,
            min = valid.minOfOrNull { it.value },
            average = valid.takeIf { it.isNotEmpty() }?.map { it.value }?.average(),
            at30Seconds = at30,
            at60Seconds = at60,
            drop30Seconds = if (start != null && at30 != null) start - at30 else null,
            drop60Seconds = if (start != null && at60 != null) start - at60 else null,
            sampleCount = valid.size,
        )
    }

    private fun validSamples(
        samples: List<HeartRateObservation>,
        startedAtEpochMs: Long,
        finishedAtEpochMs: Long,
    ): List<ValidHeartRate> {
        require(startedAtEpochMs <= finishedAtEpochMs)
        return samples.mapNotNull { sample ->
            val value = sample.value
            if (
                sample.sensorType != HEART_RATE ||
                !sample.valid ||
                value == null ||
                !value.isFinite() ||
                value <= 0.0 ||
                sample.timestampEpochMs !in startedAtEpochMs..finishedAtEpochMs
            ) {
                null
            } else {
                ValidHeartRate(sample.sampleId, sample.timestampEpochMs, value)
            }
        }.sortedWith(compareBy(ValidHeartRate::timestampEpochMs, ValidHeartRate::sampleId))
    }

    private fun List<ValidHeartRate>.nearest(targetEpochMs: Long): ValidHeartRate? = minWithOrNull(
        compareBy<ValidHeartRate>(
            { absDistance(it.timestampEpochMs, targetEpochMs) },
            { it.timestampEpochMs },
            { it.sampleId },
        ),
    )

    private fun absDistance(left: Long, right: Long): Long = when {
        left >= right -> left - right
        else -> right - left
    }.let { if (it < 0) Long.MAX_VALUE else abs(it) }

    private data class ValidHeartRate(
        val sampleId: String,
        val timestampEpochMs: Long,
        val value: Double,
    )

    private const val HEART_RATE = "HEART_RATE"
}
