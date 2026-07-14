package org.sharteman.gymcoach.ui.settings

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import kotlinx.serialization.json.JsonObject
import org.junit.Rule
import org.junit.Test
import org.sharteman.gymcoach.data.settings.AndroidReleaseDto
import org.sharteman.gymcoach.data.settings.SettingsDataSource
import org.sharteman.gymcoach.data.settings.SettingsGymDto
import org.sharteman.gymcoach.data.settings.SettingsGymInput
import org.sharteman.gymcoach.data.settings.SettingsGymListDto
import org.sharteman.gymcoach.data.settings.SettingsImportFormat
import org.sharteman.gymcoach.data.settings.SettingsImportPreview
import org.sharteman.gymcoach.data.settings.SettingsProfileDto
import org.sharteman.gymcoach.data.settings.SettingsProfileInput
import org.sharteman.gymcoach.data.settings.SettingsSnapshot
import org.sharteman.gymcoach.ui.theme.GymCoachTheme

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
        composeRule.onNodeWithTag("settings-check-update").performClick()
        composeRule.waitUntil(timeoutMillis = 10_000) {
            runCatching {
                composeRule.onNodeWithTag("settings-download-apk").assertIsDisplayed()
            }.isSuccess
        }
    }
}

private class FakeSettingsSource : SettingsDataSource {
    override suspend fun load(): SettingsSnapshot = SettingsSnapshot(
        profile = SettingsProfileDto(email = "android@test.dev", displayName = "Android"),
        gymList = SettingsGymListDto(
            activeGymId = "gym-1",
            gyms = listOf(SettingsGymDto(id = "gym-1", name = "Basement")),
        ),
        exercises = emptyList(),
    )

    override suspend fun saveProfile(input: SettingsProfileInput) =
        SettingsProfileDto(email = "android@test.dev", displayName = input.displayName)

    override suspend fun createGym(input: SettingsGymInput) = SettingsGymDto("gym-2", input.name)
    override suspend fun updateGym(id: String, input: SettingsGymInput) = SettingsGymDto(id, input.name)
    override suspend fun activateGym(id: String) = Unit
    override suspend fun deleteGym(id: String) = Unit
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
