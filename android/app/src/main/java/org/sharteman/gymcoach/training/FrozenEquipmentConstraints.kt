package org.sharteman.gymcoach.training

import kotlin.math.round
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import org.sharteman.gymcoach.data.local.LocalSetEntity
import org.sharteman.gymcoach.data.model.MobileFrozenEquipmentLoadSnapshot

private val frozenSnapshotJson = Json { ignoreUnknownKeys = true }

fun frozenEquipmentLoadConstraints(set: LocalSetEntity): LoadConstraints? {
    val snapshot = runCatching {
        set.equipmentLoadSnapshotJson?.let {
            frozenSnapshotJson.decodeFromString<MobileFrozenEquipmentLoadSnapshot>(it)
        }
    }.getOrNull() ?: return null
    if (snapshot.version != 2 || snapshot.gymEquipmentId != set.gymEquipmentId) return null

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
    return LoadConstraints(
        equipmentType = snapshot.equipmentType,
        isAvailable = true,
        equipmentId = snapshot.gymEquipmentId,
        equipmentOptions = listOf(profile),
    )
}

private fun roundFrozenLoad(value: Double): Double = round(value * 100.0) / 100.0
