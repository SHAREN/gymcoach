package org.sharteman.gymcoach.ui.settings

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import kotlinx.serialization.json.JsonObject
import org.junit.Rule
import org.junit.Test
import org.sharteman.gymcoach.data.settings.AndroidReleaseDto
import org.sharteman.gymcoach.data.settings.SettingsDataSource
import org.sharteman.gymcoach.data.settings.SettingsGymDto
import org.sharteman.gymcoach.data.settings.SettingsEquipmentImageDto
import org.sharteman.gymcoach.data.settings.SettingsGymEquipmentDto
import org.sharteman.gymcoach.data.settings.SettingsGymEquipmentInput
import org.sharteman.gymcoach.data.settings.SettingsGymInventoryDto
import org.sharteman.gymcoach.data.settings.SettingsGymInput
import org.sharteman.gymcoach.data.settings.SettingsGymListDto
import org.sharteman.gymcoach.data.settings.SettingsImportFormat
import org.sharteman.gymcoach.data.settings.SettingsImportPreview
import org.sharteman.gymcoach.data.settings.SettingsProfileDto
import org.sharteman.gymcoach.data.settings.SettingsProfileInput
import org.sharteman.gymcoach.data.settings.SettingsSnapshot
import org.sharteman.gymcoach.ui.theme.GymCoachTheme
import org.sharteman.gymcoach.data.model.ExerciseDto

class SettingsScreenTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun rendersNativeSettingsAndChecksRelease() {
        composeRule.setContent {
            GymCoachTheme(darkTheme = true) {
                SettingsScreen(
                    onBack = {},
                    onOpenWebPath = {},
                    repository = FakeSettingsSource(),
                )
            }
        }

        composeRule.waitUntil(timeoutMillis = 10_000) {
            runCatching {
                composeRule.onNodeWithTag("settings-native-screen").assertIsDisplayed()
            }.isSuccess
        }
        composeRule.onNodeWithTag("settings-primary-server").assertIsDisplayed()
        composeRule.onNodeWithTag("settings-fallback-server").assertIsDisplayed()
        composeRule.onNodeWithTag("settings-profile-display-name")
            .performScrollTo()
            .assertTextContains("Android")
        composeRule.onNodeWithTag("settings-profile-bodyweight").assertTextContains("82.5")
        composeRule.onNodeWithTag("settings-profile-height").assertTextContains("181")
        composeRule.onNodeWithTag("settings-profile-frequency").assertTextContains("4")
        composeRule.onNodeWithTag("settings-check-update").performScrollTo().performClick()
        composeRule.waitUntil(timeoutMillis = 10_000) {
            runCatching {
                composeRule.onNodeWithTag("settings-download-apk").assertIsDisplayed()
            }.isSuccess
        }
    }

    @Test
    fun showsRetryInsteadOfEmptyProfileWhenLoadingFails() {
        composeRule.setContent {
            GymCoachTheme(darkTheme = true) {
                SettingsScreen(
                    onBack = {},
                    onOpenWebPath = {},
                    repository = FailingSettingsSource(),
                )
            }
        }

        composeRule.waitUntil(timeoutMillis = 10_000) {
            runCatching {
                composeRule.onNodeWithTag("settings-retry-load").assertIsDisplayed()
            }.isSuccess
        }
    }

    @Test
    fun rendersEquipmentThumbnailAndOpensNativeEditor() {
        val snapshot = FakeSettingsSource().snapshot()
        composeRule.setContent {
            var editor by remember { mutableStateOf<GymEquipmentDraft?>(null) }
            GymCoachTheme(darkTheme = true) {
                GymEquipmentSection(
                    snapshot = snapshot,
                    gymId = "gym-1",
                    editor = editor,
                    busy = false,
                    imageAuthorization = "Bearer test-token",
                    onNew = { editor = GymEquipmentDraft() },
                    onEdit = { editor = it.toDraft() },
                    onEditorChange = { editor = it },
                    onDismissEditor = { editor = null },
                    onSave = {},
                    onDelete = {},
                    onUploadImage = {},
                    onSetImageUrl = {},
                    onClearImage = {},
                )
            }
        }

        composeRule.onNodeWithTag("settings-equipment-card-equipment-1").assertIsDisplayed()
        composeRule.onNodeWithTag("settings-add-equipment").performClick()
        composeRule.onNodeWithTag("settings-equipment-editor").assertIsDisplayed()
    }
}

private class FakeSettingsSource : SettingsDataSource {
    fun snapshot(): SettingsSnapshot = SettingsSnapshot(
        profile = SettingsProfileDto(
            email = "android@test.dev",
            displayName = "Android",
            bodyweight = 82.5,
            sex = "MALE",
            heightCm = 181,
            goal = "STRENGTH",
            weeklyFrequency = 4,
        ),
        gymList = SettingsGymListDto(
            activeGymId = "gym-1",
            gyms = listOf(SettingsGymDto(id = "gym-1", name = "Basement")),
        ),
        exercises = listOf(
            ExerciseDto(
                id = "exercise-1",
                name = "Cable row",
                muscleGroup = "BACK_THICKNESS",
                category = "COMPOUND",
                equipmentType = "CABLE",
            ),
        ),
        gymInventories = mapOf(
            "gym-1" to SettingsGymInventoryDto(
                id = "gym-1",
                name = "Basement",
                equipment = listOf(
                    SettingsGymEquipmentDto(
                        id = "equipment-1",
                        gymId = "gym-1",
                        name = "Cable station",
                        equipmentType = "CABLE",
                        image = SettingsEquipmentImageDto(
                            kind = "external",
                            url = "https://images.example.test/cable.jpg",
                        ),
                    ),
                ),
            ),
        ),
    )

    override suspend fun load(): SettingsSnapshot = snapshot()

    override suspend fun saveProfile(input: SettingsProfileInput) =
        SettingsProfileDto(email = "android@test.dev", displayName = input.displayName)

    override suspend fun createGym(input: SettingsGymInput) = SettingsGymDto("gym-2", input.name)
    override suspend fun updateGym(id: String, input: SettingsGymInput) = SettingsGymDto(id, input.name)
    override suspend fun activateGym(id: String) = Unit
    override suspend fun deleteGym(id: String) = Unit
    override suspend fun loadGymInventory(gymId: String) = snapshot().gymInventories.getValue(gymId)
    override suspend fun saveGymEquipment(
        gymId: String,
        equipmentId: String?,
        input: SettingsGymEquipmentInput,
    ) = Unit
    override suspend fun deleteGymEquipment(equipmentId: String) = Unit
    override suspend fun setGymEquipmentImageUrl(equipmentId: String, imageUrl: String) = Unit
    override suspend fun uploadGymEquipmentImage(
        equipmentId: String,
        imageBase64: String,
        mimeType: String,
    ) = Unit
    override suspend fun clearGymEquipmentImage(equipmentId: String) = Unit
    override suspend fun latestRelease() = AndroidReleaseDto(
        versionCode = 999,
        versionName = "99.0.0",
        sha256 = "a".repeat(64),
        sizeBytes = 20_162_676,
        publishedAt = "2026-07-14T00:00:00.000Z",
        apkFile = "gymcoach.apk",
        downloadUrl = "/api/android/download",
    )

    override fun releaseDownloadUrl(release: AndroidReleaseDto) =
        "https://gymcoach7.sharteman.duckdns.org/api/android/download"

    override suspend fun exportBackup() = "{}"
    override suspend fun restoreBackup(payload: String) = Unit
    override suspend fun previewImport(
        format: SettingsImportFormat,
        fileName: String,
        payload: String,
        unit: String,
    ) = SettingsImportPreview(format, fileName, payload, unit, JsonObject(emptyMap()))

    override suspend fun confirmImport(preview: SettingsImportPreview) = JsonObject(emptyMap())
}

private class FailingSettingsSource : SettingsDataSource by FakeSettingsSource() {
    override suspend fun load(): SettingsSnapshot = error("Settings are unavailable")
}
