package org.sharteman.gymcoach.ui.settings

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import org.sharteman.gymcoach.data.settings.SettingsBarbellFamilyDto
import org.sharteman.gymcoach.data.settings.SettingsBarbellSystemProfileDto
import org.sharteman.gymcoach.data.settings.SettingsDumbbellsSystemProfileDto
import org.sharteman.gymcoach.data.settings.SettingsGymEquipmentDto
import org.sharteman.gymcoach.data.settings.SettingsGymPlateInventoryItemDto
import org.sharteman.gymcoach.data.settings.SettingsGymPlatePoolDto

class SystemEquipmentProfileUiModelsTest {
    @Test
    fun `dumbbell input sorts weights but rejects rounded duplicates`() {
        val profile = SettingsDumbbellsSystemProfileDto(
            id = "system-profile-dumbbells-gym-1",
            weightsKg = listOf(20.0, 10.0, 12.5),
        )
        val valid = profile.toDraft().copy(
            weights = "20; 10; 12.5",
            exerciseIds = setOf("exercise-2", "exercise-1"),
        ).toInputOrNull()

        assertEquals(listOf(10.0, 12.5, 20.0), valid?.weightsKg)
        assertEquals(listOf("exercise-1", "exercise-2"), valid?.exerciseIds)
        assertNull(profile.toDraft().copy(weights = "10; 10.004").toInputOrNull())
        assertNull(profile.toDraft().copy(weights = "0").toInputOrNull())
    }

    @Test
    fun `barbell input preserves Olymp ids families quantities and retry payload`() {
        val draft = olympProfile().toDraft()
        val first = draft.toInputOrNull()
        val retry = draft.toInputOrNull()

        assertNotNull(first)
        assertEquals(first, retry)
        val families = first!!.families.associateBy { it.family }
        assertEquals(listOf(12.0, 17.5, 20.0), families.getValue("LARGE").bars.map { it.weightKg })
        assertEquals(
            listOf("large-12", "large-17.5", "large-20"),
            families.getValue("LARGE").bars.map { it.equipmentId },
        )
        assertEquals(listOf(6.0), families.getValue("SMALL").bars.map { it.weightKg })
        assertEquals("small-6", families.getValue("SMALL").bars.single().equipmentId)
        assertEquals(
            listOf(1.25, 2.5, 3.5, 5.0),
            families.getValue("SMALL").plates.map { it.weightKg },
        )
        assertEquals(null, families.getValue("SMALL").plates.first().quantity)
    }

    @Test
    fun `barbell input rejects cross family stable id duplicate weights and missing bars`() {
        val original = olympProfile().toDraft()
        val large = original.families.first { it.family == "LARGE" }
        val small = original.families.first { it.family == "SMALL" }
        val movedSmallId = large.copy(
            bars = large.bars + small.bars.single().copy(key = 99),
        )
        assertNull(
            original.copy(
                families = listOf(
                    movedSmallId,
                    small.copy(bars = listOf(SystemBarDraft(1, weight = "6"))),
                ),
            )
                .toInputOrNull(),
        )
        assertNull(
            original.copy(
                families = original.families.map { family ->
                    if (family.family == "LARGE") {
                        family.copy(bars = family.bars + SystemBarDraft(99, weight = "12.004"))
                    } else family
                },
            ).toInputOrNull(),
        )
        assertNull(
            original.copy(
                families = original.families.map { family ->
                    if (family.family == "SMALL") family.copy(bars = emptyList()) else family
                },
            ).toInputOrNull(),
        )
    }

    private fun olympProfile(): SettingsBarbellSystemProfileDto {
        val largePool = pool("large-pool", "LARGE", listOf(1.25, 2.5, 5.0, 10.0, 15.0, 20.0))
        val smallPool = pool("small-pool", "SMALL", listOf(1.25, 2.5, 3.5, 5.0))
        return SettingsBarbellSystemProfileDto(
            id = "system-profile-barbell-gym-1",
            families = listOf(
                SettingsBarbellFamilyDto(
                    family = "LARGE",
                    pool = largePool,
                    bars = listOf(
                        bar("large-12", 12.0, "LARGE", largePool.id),
                        bar("large-17.5", 17.5, "LARGE", largePool.id),
                        bar("large-20", 20.0, "LARGE", largePool.id),
                    ),
                    loadingSides = 2,
                ),
                SettingsBarbellFamilyDto(
                    family = "SMALL",
                    pool = smallPool,
                    bars = listOf(bar("small-6", 6.0, "SMALL", smallPool.id)),
                    loadingSides = 2,
                ),
            ),
        )
    }

    private fun pool(id: String, family: String, weights: List<Double>) =
        SettingsGymPlatePoolDto(
            id = id,
            name = "$family plates",
            compatibilityKey = "${family.lowercase()}_diameter",
            systemBarbellFamily = family,
            plates = weights.map { SettingsGymPlateInventoryItemDto(weightKg = it, quantity = null) },
        )

    private fun bar(id: String, weight: Double, family: String, poolId: String) =
        SettingsGymEquipmentDto(
            id = id,
            gymId = "gym-1",
            name = "$weight kg bar",
            equipmentType = "BARBELL",
            loadType = "PLATE_LOADED",
            baseLoadKg = weight,
            platePoolId = poolId,
            systemBarbellFamily = family,
        )
}
