package org.sharteman.gymcoach.ui.programs

import java.time.Instant
import java.time.ZoneId

internal fun exerciseTrainingDayCount(
    trainingDates: List<String>,
    zoneId: ZoneId = ZoneId.systemDefault(),
): Int = trainingDates.mapNotNull { value ->
    runCatching { Instant.parse(value).atZone(zoneId).toLocalDate() }.getOrNull()
}.toSet().size
