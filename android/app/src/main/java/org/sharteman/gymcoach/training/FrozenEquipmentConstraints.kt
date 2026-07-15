package org.sharteman.gymcoach.training

import kotlin.math.round
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import org.sharteman.gymcoach.data.local.LocalSetEntity
import org.sharteman.gymcoach.data.model.MobileFrozenEquipmentLoadSnapshot

private val frozenSnapshotJson = Json { ignoreUnknownKeys = true }

sealed interface FrozenEquipmentLoadState {
    data object NoSnapshot : FrozenEquipmentLoadState
    data object Invalid : FrozenEquipmentLoadState
    data class Supported(val constraints: LoadConstraints) : FrozenEquipmentLoadState
}

fun frozenEquipmentLoadState(set: LocalSetEntity): FrozenEquipmentLoadState {
    if (set.equipmentLoadSnapshotJson == null) return FrozenEquipmentLoadState.NoSnapshot
    val snapshot = runCatching {
        frozenSnapshotJson.decodeFromString<MobileFrozenEquipmentLoadSnapshot>(
            set.equipmentLoadSnapshotJson,
        )
    }.getOrNull() ?: return FrozenEquipmentLoadState.Invalid
    if (
        snapshot.version != 2 ||
        snapshot.revisionId.isBlank() ||
        snapshot.gymEquipmentId.isBlank() ||
        snapshot.loadType !in setOf("NONE", "FIXED", "SELECTORIZED", "PLATE_LOADED") ||
        (set.gymEquipmentId != null && snapshot.gymEquipmentId != set.gymEquipmentId)
    ) {
        return FrozenEquipmentLoadState.Invalid
    }

    val plates = snapshot.platePool?.plates.orEmpty().map { plate ->
        PlateInventoryItem(weightKg = plate.weightKg, quantity = plate.quantity)
    }
    val attainableLoads = when (snapshot.loadType) {
        "PLATE_LOADED" -> constructiblePlateLoadedWeights(
            baseLoadKg = snapshot.baseLoadKg,
            loadingSides = snapshot.loadingSides,
            plates = plates,
            targetCeiling = 500.0,
        ).first
        "FIXED", "SELECTORIZED" -> snapshot.weightOptions
            .filter { it.isFinite() && it > 0.0 }
            .map(::roundFrozenLoad)
            .distinct()
            .sorted()
        else -> emptyList()
    }
    if (snapshot.loadType != "NONE" && attainableLoads.isEmpty()) {
        return FrozenEquipmentLoadState.Invalid
    }
    val profile = ResolvedEquipmentLoadProfile(
        equipmentId = snapshot.gymEquipmentId,
        equipmentName = set.equipmentNameSnapshot.orEmpty(),
        equipmentType = snapshot.equipmentType,
        loadType = snapshot.loadType,
        weightOptions = snapshot.weightOptions,
        selectedLoadMultiplier = snapshot.selectedLoadMultiplier,
        baseLoadKg = snapshot.baseLoadKg,
        loadingSides = snapshot.loadingSides,
        platePoolId = snapshot.platePool?.id,
        platePoolName = snapshot.platePool?.name,
        plates = plates,
        attainableLoads = attainableLoads,
        inventoryPrecision = "FROZEN",
    )
    return FrozenEquipmentLoadState.Supported(
        LoadConstraints(
            equipmentType = snapshot.equipmentType,
            isAvailable = true,
            equipmentId = snapshot.gymEquipmentId,
            equipmentOptions = listOf(profile),
        ),
    )
}

fun frozenEquipmentLoadConstraints(set: LocalSetEntity): LoadConstraints? =
    (frozenEquipmentLoadState(set) as? FrozenEquipmentLoadState.Supported)?.constraints

private fun roundFrozenLoad(value: Double): Double = round(value * 100.0) / 100.0
