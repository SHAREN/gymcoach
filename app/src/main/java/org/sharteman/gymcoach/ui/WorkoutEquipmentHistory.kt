package org.sharteman.gymcoach.ui

import org.sharteman.gymcoach.data.model.EquipmentReturnRecommendationDto
import org.sharteman.gymcoach.data.model.LastPerformanceDto
import org.sharteman.gymcoach.data.model.ReturnRecommendationDto

internal fun sameEquipmentIdentity(first: String?, second: String?): Boolean = first == second

internal fun selectLastPerformanceForEquipment(
    performances: List<LastPerformanceDto>?,
    fallback: LastPerformanceDto?,
    gymEquipmentId: String?,
): LastPerformanceDto? = performances
    ?.firstOrNull { performance ->
        sameEquipmentIdentity(performance.gymEquipmentId, gymEquipmentId)
    }
    ?: fallback?.takeIf { performance ->
        sameEquipmentIdentity(performance.gymEquipmentId, gymEquipmentId)
    }

internal fun selectReturnRecommendationForEquipment(
    recommendations: List<EquipmentReturnRecommendationDto>?,
    fallback: ReturnRecommendationDto?,
    fallbackPerformance: LastPerformanceDto?,
    gymEquipmentId: String?,
): ReturnRecommendationDto? = recommendations
    ?.firstOrNull { item -> sameEquipmentIdentity(item.gymEquipmentId, gymEquipmentId) }
    ?.recommendation
    ?: fallback?.takeIf {
        sameEquipmentIdentity(fallbackPerformance?.gymEquipmentId, gymEquipmentId)
    }
