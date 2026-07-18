package org.sharteman.gymcoach.data.settings

import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.sharteman.gymcoach.data.model.ExerciseDto

class SystemProfileNormalizationTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `older inventory payload decodes and creates both stable profile identities`() {
        val decoded = json.decodeFromString<SettingsGymInventoryResponse>(
            """
            {
              "gym": {
                "id": "gym-1",
                "name": "Olymp",
                "equipment": []
              }
            }
            """.trimIndent(),
        )
        val dumbbell = exercise("dumbbell", "Dumbbell press", "OTHER")
        val barbell = exercise("barbell", "Barbell squat", "OTHER")
        val normalized = decoded.gym.normalizeSystemProfiles(
            legacyGym = SettingsGymDto(
                id = "gym-1",
                name = "Olymp",
                dumbbellWeights = listOf(20.0, 10.0, 10.0),
                exerciseConfigs = listOf(
                    SettingsGymExerciseConfigDto(
                        exerciseId = barbell.id,
                        systemProfileSupported = false,
                    ),
                ),
            ),
            exercises = listOf(dumbbell, barbell),
        )

        assertEquals("system-profile-dumbbells-gym-1", normalized.systemProfiles?.dumbbells?.id)
        assertEquals("system-profile-barbell-gym-1", normalized.systemProfiles?.barbell?.id)
        assertEquals(listOf(10.0, 20.0), normalized.systemProfiles?.dumbbells?.weightsKg)
        assertEquals(listOf(dumbbell.id), normalized.systemProfiles?.dumbbells?.exerciseLinks?.map { it.id })
        assertTrue(normalized.systemProfiles?.barbell?.exerciseLinks.orEmpty().isEmpty())
        assertEquals(
            listOf("LARGE", "SMALL"),
            normalized.systemProfiles?.barbell?.families?.map { it.family },
        )
    }

    @Test
    fun `normalization preserves Olymp facts stable ids and rejects cross family members`() {
        val largePool = pool(
            id = "large-pool",
            family = "LARGE",
            weights = listOf(1.25, 2.5, 5.0, 10.0, 15.0, 20.0),
        )
        val smallPool = pool(
            id = "small-pool",
            family = "SMALL",
            weights = listOf(1.25, 2.5, 3.5, 5.0),
        )
        val largeBars = listOf(12.0, 17.5, 20.0).map { weight ->
            bar("large-$weight", weight, "LARGE", largePool.id)
        }
        val smallBar = bar("small-6", 6.0, "SMALL", smallPool.id)
        val customCable = SettingsGymEquipmentDto(
            id = "custom-cable",
            gymId = "gym-1",
            name = "Custom cable",
            equipmentType = "CABLE",
        )
        val inventory = SettingsGymInventoryDto(
            id = "gym-1",
            name = "Olymp",
            platePools = listOf(largePool, smallPool),
            equipment = largeBars + smallBar + customCable,
            systemProfiles = SettingsSystemProfilesDto(
                dumbbells = SettingsDumbbellsSystemProfileDto(
                    id = "system-profile-dumbbells-gym-1",
                    weightsKg = listOf(10.0, 12.5, 20.0),
                ),
                barbell = SettingsBarbellSystemProfileDto(
                    id = "system-profile-barbell-gym-1",
                    families = listOf(
                        SettingsBarbellFamilyDto(
                            family = "LARGE",
                            pool = largePool,
                            bars = largeBars + smallBar,
                        ),
                        SettingsBarbellFamilyDto(
                            family = "SMALL",
                            pool = smallPool,
                            bars = listOf(smallBar),
                        ),
                    ),
                ),
            ),
        ).normalizeSystemProfiles()

        val families = inventory.systemProfiles!!.barbell.families.associateBy { it.family }
        assertEquals(listOf(12.0, 17.5, 20.0), families.getValue("LARGE").bars.map { it.baseLoadKg })
        assertEquals(listOf(6.0), families.getValue("SMALL").bars.map { it.baseLoadKg })
        assertEquals(listOf(1.25, 2.5, 3.5, 5.0), families.getValue("SMALL").pool.plates.map { it.weightKg })
        assertEquals(listOf("custom-cable"), inventory.customEquipment().map { it.id })
        assertEquals("large-12.0", families.getValue("LARGE").bars.first().id)
        assertEquals("small-6", families.getValue("SMALL").bars.single().id)
    }

    private fun exercise(id: String, name: String, type: String) = ExerciseDto(
        id = id,
        name = name,
        muscleGroup = "CHEST",
        category = "COMPOUND",
        equipmentType = type,
    )

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
            loadingSides = 2,
            systemBarbellFamily = family,
        )
}
