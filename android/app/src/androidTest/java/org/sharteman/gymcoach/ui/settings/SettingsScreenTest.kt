package org.sharteman.gymcoach.ui.settings

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import androidx.test.platform.app.InstrumentationRegistry
import android.content.res.Configuration
import java.util.Locale
import org.sharteman.gymcoach.R
import org.sharteman.gymcoach.data.network.ServerEndpointResolver
import org.sharteman.gymcoach.data.network.ServerReachabilityProbe
import org.sharteman.gymcoach.data.security.SecureAccountStore
import org.sharteman.gymcoach.data.settings.AndroidReleaseDto
import org.sharteman.gymcoach.data.settings.SettingsDataSource
import org.sharteman.gymcoach.data.settings.SettingsBarbellFamilyDto
import org.sharteman.gymcoach.data.settings.SettingsBarbellSystemProfileDto
import org.sharteman.gymcoach.data.settings.SettingsBarbellSystemProfileInput
import org.sharteman.gymcoach.data.settings.SettingsDumbbellsSystemProfileDto
import org.sharteman.gymcoach.data.settings.SettingsDumbbellsSystemProfileInput
import org.sharteman.gymcoach.data.settings.SettingsErrorKind
import org.sharteman.gymcoach.data.settings.SettingsException
import org.sharteman.gymcoach.data.settings.SettingsGymDto
import org.sharteman.gymcoach.data.settings.SettingsEquipmentImageDto
import org.sharteman.gymcoach.data.settings.SettingsGymEquipmentDto
import org.sharteman.gymcoach.data.settings.SettingsGymEquipmentInput
import org.sharteman.gymcoach.data.settings.SettingsGymInventoryDto
import org.sharteman.gymcoach.data.settings.SettingsGymPlateInventoryItemDto
import org.sharteman.gymcoach.data.settings.SettingsGymPlatePoolDto
import org.sharteman.gymcoach.data.settings.SettingsGymInput
import org.sharteman.gymcoach.data.settings.SettingsGymUpdateInput
import org.sharteman.gymcoach.data.settings.SettingsGymListDto
import org.sharteman.gymcoach.data.settings.SettingsImportFormat
import org.sharteman.gymcoach.data.settings.SettingsImportPreview
import org.sharteman.gymcoach.data.settings.SettingsProfileDto
import org.sharteman.gymcoach.data.settings.SettingsProfileInput
import org.sharteman.gymcoach.data.settings.SettingsRepository
import org.sharteman.gymcoach.data.settings.SettingsSection
import org.sharteman.gymcoach.data.settings.SettingsSectionFailure
import org.sharteman.gymcoach.data.settings.SettingsSessionValidation
import org.sharteman.gymcoach.data.settings.SettingsSessionValidator
import org.sharteman.gymcoach.data.settings.SettingsSnapshot
import org.sharteman.gymcoach.data.settings.SettingsSystemProfilesDto
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
                    onAuthenticationRequired = {},
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
    fun opensDebugWatchDiagnosticsFromSettings() {
        var opened = false
        composeRule.setContent {
            GymCoachTheme(darkTheme = true) {
                SettingsScreen(
                    onBack = {},
                    onOpenWebPath = {},
                    onAuthenticationRequired = {},
                    repository = FakeSettingsSource(),
                    watchDiagnosticsLabel = "Watch diagnostics test",
                    onOpenWatchDiagnostics = { opened = true },
                )
            }
        }

        composeRule.waitUntil(timeoutMillis = 10_000) {
            runCatching {
                composeRule.onNodeWithTag("settings-watch-diagnostics").performScrollTo()
            }.isSuccess
        }
        composeRule.onNodeWithTag("settings-watch-diagnostics").performClick()
        composeRule.runOnIdle { assertTrue(opened) }
    }

    @Test
    fun opensNativeCoachingProfileFromSettings() {
        var opened = false
        composeRule.setContent {
            GymCoachTheme(darkTheme = true) {
                SettingsScreen(
                    onBack = {},
                    onOpenWebPath = {},
                    onAuthenticationRequired = {},
                    onOpenCoachingProfile = { opened = true },
                    repository = FakeSettingsSource(),
                )
            }
        }

        composeRule.waitUntil(timeoutMillis = 10_000) {
            runCatching { composeRule.onNodeWithTag("settings-native-screen").assertIsDisplayed() }.isSuccess
        }
        composeRule.onNodeWithTag("settings-native-screen")
            .performScrollToNode(hasTestTag("settings-open-coaching-profile"))
        composeRule.onNodeWithTag("settings-open-coaching-profile").performClick()
        composeRule.runOnIdle { assertTrue(opened) }
    }

    @Test
    fun retryableFailureStaysOnSettingsAndRetryLoadsContent() {
        val source = RetryableSettingsSource()
        var authenticationRequired = false
        composeRule.setContent {
            GymCoachTheme(darkTheme = true) {
                SettingsScreen(
                    onBack = {},
                    onOpenWebPath = {},
                    onAuthenticationRequired = { authenticationRequired = true },
                    repository = source,
                )
            }
        }

        composeRule.waitUntil(timeoutMillis = 10_000) {
            runCatching {
                composeRule.onNodeWithTag("settings-retry-load").assertIsDisplayed()
            }.isSuccess
        }
        composeRule.runOnIdle { assertFalse(authenticationRequired) }
        composeRule.onNodeWithTag("settings-retry-load").performClick()
        composeRule.waitUntil(timeoutMillis = 10_000) {
            runCatching {
                composeRule.onNodeWithTag("settings-native-screen").assertIsDisplayed()
            }.isSuccess
        }
        composeRule.runOnIdle { assertFalse(authenticationRequired) }
    }

    @Test
    fun routeSpecificAuthenticationFailurePreservesSessionAndShowsRetry() {
        val accountStore = SecureAccountStore(
            InstrumentationRegistry.getInstrumentation().targetContext,
        )
        accountStore.clearAccount()
        accountStore.setAccessToken(STALE_TOKEN)
        var authenticationRequired = false

        try {
            composeRule.setContent {
                GymCoachTheme(darkTheme = true) {
                    SettingsScreen(
                        onBack = {},
                        onOpenWebPath = {},
                        onAuthenticationRequired = { authenticationRequired = true },
                        repository = testSettingsRepository(
                            accountStore = accountStore,
                            expectedToken = STALE_TOKEN,
                            validation = SettingsSessionValidation.VALID,
                        ) {
                            throw SettingsException(
                                SettingsErrorKind.AUTHENTICATION,
                                statusCode = 401,
                            )
                        },
                    )
                }
            }

            composeRule.waitUntil(timeoutMillis = 10_000) {
                runCatching {
                    composeRule.onNodeWithTag("settings-retry-load").assertIsDisplayed()
                }.isSuccess
            }
            composeRule.runOnIdle { assertFalse(authenticationRequired) }
            assertEquals(STALE_TOKEN, accountStore.getAccessToken())
        } finally {
            accountStore.clearAccount()
        }
    }

    @Test
    fun confirmedAuthenticationFailureReturnsToLoginAndSettingsLoadAfterReauthentication() {
        val accountStore = SecureAccountStore(
            InstrumentationRegistry.getInstrumentation().targetContext,
        )
        accountStore.clearAccount()
        accountStore.setAccessToken(STALE_TOKEN)
        val staleRepository = testSettingsRepository(
            accountStore,
            STALE_TOKEN,
            SettingsSessionValidation.INVALID,
        ) {
            throw SettingsException(SettingsErrorKind.AUTHENTICATION, statusCode = 401)
        }

        try {
            composeRule.setContent {
                var authenticated by remember { mutableStateOf(true) }
                var repository by remember { mutableStateOf<SettingsDataSource>(staleRepository) }
                GymCoachTheme(darkTheme = true) {
                    if (authenticated) {
                        SettingsScreen(
                            onBack = {},
                            onOpenWebPath = {},
                            onAuthenticationRequired = { authenticated = false },
                            repository = repository,
                        )
                    } else {
                        Column {
                            Text("Login required", Modifier.testTag("settings-login-flow"))
                            Button(
                                onClick = {
                                    accountStore.setAccessToken(FRESH_TOKEN)
                                    repository = testSettingsRepository(accountStore, FRESH_TOKEN) {
                                        FakeSettingsSource().snapshot()
                                    }
                                    authenticated = true
                                },
                                modifier = Modifier.testTag("settings-complete-login"),
                            ) {
                                Text("Sign in")
                            }
                        }
                    }
                }
            }

            composeRule.waitUntil(timeoutMillis = 10_000) {
                runCatching {
                    composeRule.onNodeWithTag("settings-login-flow").assertIsDisplayed()
                }.isSuccess
            }
            assertEquals(null, accountStore.getAccessToken())
            composeRule.onNodeWithTag("settings-complete-login").performClick()
            composeRule.waitUntil(timeoutMillis = 10_000) {
                runCatching {
                    composeRule.onNodeWithTag("settings-native-screen").assertIsDisplayed()
                }.isSuccess
            }
            assertEquals(FRESH_TOKEN, accountStore.getAccessToken())
            composeRule.onNodeWithTag("settings-profile-display-name")
                .performScrollTo()
                .assertTextContains("Android")
            composeRule.onNodeWithTag("settings-native-screen")
                .performScrollToNode(hasTestTag("settings-equipment-card-equipment-1"))
            composeRule.onNodeWithTag("settings-equipment-card-equipment-1").assertIsDisplayed()
        } finally {
            accountStore.clearAccount()
        }
    }

    @Test
    fun diagnosticsActionsRemainAvailableWhenSettingsContentCannotLoad() {
        val unavailable = object : FakeSettingsSource() {
            override suspend fun load(): SettingsSnapshot {
                throw SettingsException(
                    kind = SettingsErrorKind.DNS,
                    correlationId = "settings-profile-dns",
                    subrequest = "profile",
                )
            }
        }
        composeRule.setContent {
            GymCoachTheme(darkTheme = true) {
                SettingsScreen(
                    onBack = {},
                    onOpenWebPath = {},
                    onAuthenticationRequired = {},
                    repository = unavailable,
                )
            }
        }

        composeRule.waitUntil(timeoutMillis = 10_000) {
            runCatching {
                composeRule.onNodeWithTag("settings-retry-load").assertIsDisplayed()
            }.isSuccess
        }
        composeRule.onNodeWithTag("settings-diagnostics-copy").assertIsDisplayed().assertIsEnabled()
        composeRule.onNodeWithTag("settings-diagnostics-export").assertIsDisplayed().assertIsEnabled()
        composeRule.onNodeWithTag("settings-diagnostics-clear").assertIsDisplayed().assertIsEnabled()
    }

    @Test
    fun partialSectionFailureKeepsProfileAndShowsExactRetryState() {
        val partial = object : FakeSettingsSource() {
            override suspend fun load(): SettingsSnapshot = snapshot().copy(
                sectionFailures = listOf(
                    SettingsSectionFailure(
                        section = SettingsSection.EXERCISES,
                        kind = SettingsErrorKind.INVALID_RESPONSE,
                        correlationId = "settings-exercises-schema",
                    ),
                ),
            )
        }
        composeRule.setContent {
            GymCoachTheme(darkTheme = true) {
                SettingsScreen(
                    onBack = {},
                    onOpenWebPath = {},
                    onAuthenticationRequired = {},
                    repository = partial,
                )
            }
        }

        composeRule.waitUntil(timeoutMillis = 10_000) {
            runCatching {
                composeRule.onNodeWithTag("settings-native-screen").assertIsDisplayed()
            }.isSuccess
        }
        composeRule.onNodeWithTag("settings-native-screen")
            .performScrollToNode(hasTestTag("settings-section-failure-exercises"))
        composeRule.onNodeWithTag("settings-section-failure-exercises")
            .assertIsDisplayed()
        val expectedCorrelation = InstrumentationRegistry.getInstrumentation().targetContext
            .getString(R.string.settings_partial_correlation, "settings-exercises-schema")
        composeRule.onNodeWithTag("settings-section-correlation-exercises")
            .assertTextEquals(expectedCorrelation)
        composeRule.onNodeWithTag("settings-section-retry").assertIsDisplayed().assertIsEnabled()
        composeRule.onNodeWithTag("settings-profile-display-name")
            .performScrollTo()
            .assertTextContains("Android")
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

    @Test
    fun rendersExactlyTwoSystemProfilesAndHidesManagedBarsFromCustomEquipment() {
        composeRule.setContent {
            GymCoachTheme(darkTheme = true) {
                SettingsScreen(
                    onBack = {},
                    onOpenWebPath = {},
                    onAuthenticationRequired = {},
                    repository = FakeSettingsSource(),
                )
            }
        }

        composeRule.waitUntil(timeoutMillis = 10_000) {
            runCatching {
                composeRule.onNodeWithTag("settings-native-screen").assertIsDisplayed()
            }.isSuccess
        }
        composeRule.onNodeWithTag("settings-native-screen")
            .performScrollToNode(hasTestTag("settings-system-profile-dumbbells"))
        composeRule.onNodeWithTag("settings-system-profile-dumbbells").assertIsDisplayed()
        composeRule.onNodeWithTag("settings-system-profile-barbell").assertIsDisplayed()
        val editDescription = InstrumentationRegistry.getInstrumentation().targetContext
            .getString(R.string.settings_system_dumbbells_edit)
        composeRule.onNodeWithContentDescription(editDescription).assertIsDisplayed()
        composeRule.onAllNodesWithTag("settings-equipment-card-large-12").assertCountEquals(0)
        composeRule.onAllNodesWithTag("settings-equipment-card-small-6").assertCountEquals(0)
        composeRule.onNodeWithTag("settings-native-screen")
            .performScrollToNode(hasTestTag("settings-equipment-card-equipment-1"))
        composeRule.onNodeWithTag("settings-equipment-card-equipment-1").assertIsDisplayed()

        composeRule.onNodeWithTag("settings-system-profile-barbell-edit").performClick()
        composeRule.onNodeWithTag("settings-barbell-profile-editor").assertIsDisplayed()
        composeRule.onNodeWithTag("settings-barbell-family-LARGE").assertIsDisplayed()
        composeRule.onNodeWithTag("settings-barbell-family-SMALL").performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithTag("settings-bar-LARGE-1-weight").assertTextContains("12")
        composeRule.onNodeWithTag("settings-bar-SMALL-1-weight").performScrollTo().assertTextContains("6")
    }

    @Test
    fun retriesSystemProfileSaveWithTheSameStablePayloadAfterConflict() {
        val source = RetryableSystemProfileSource()
        composeRule.setContent {
            GymCoachTheme(darkTheme = true) {
                SettingsScreen(
                    onBack = {},
                    onOpenWebPath = {},
                    onAuthenticationRequired = {},
                    repository = source,
                )
            }
        }

        composeRule.waitUntil(timeoutMillis = 10_000) {
            runCatching {
                composeRule.onNodeWithTag("settings-native-screen").assertIsDisplayed()
            }.isSuccess
        }
        composeRule.onNodeWithTag("settings-native-screen")
            .performScrollToNode(hasTestTag("settings-system-profile-dumbbells-edit"))
        composeRule.onNodeWithTag("settings-system-profile-dumbbells-edit").performClick()
        composeRule.onNodeWithTag("settings-save-dumbbells-profile").performClick()
        composeRule.waitUntil(timeoutMillis = 10_000) {
            runCatching {
                composeRule.onNodeWithTag("settings-system-profile-error").assertIsDisplayed()
            }.isSuccess
        }
        composeRule.onNodeWithTag("settings-save-dumbbells-profile").performClick()
        composeRule.waitUntil(timeoutMillis = 10_000) {
            runCatching {
                composeRule.onAllNodesWithTag("settings-dumbbells-profile-editor").assertCountEquals(0)
            }.isSuccess
        }
        composeRule.runOnIdle {
            assertEquals(2, source.inputs.size)
            assertEquals(source.inputs[0], source.inputs[1])
        }
    }

    @Test
    fun rendersBothSystemProfilesAtNarrowWidth() {
        val snapshot = FakeSettingsSource().snapshot()
        composeRule.setContent {
            GymCoachTheme(darkTheme = true) {
                Box(Modifier.width(320.dp)) {
                    SystemEquipmentProfilesSection(
                        snapshot = snapshot,
                        gymId = "gym-1",
                        dumbbellsEditor = null,
                        barbellEditor = null,
                        busy = false,
                        error = null,
                        onEditDumbbells = {},
                        onEditBarbell = {},
                        onDumbbellsChange = {},
                        onBarbellChange = {},
                        onDismissEditor = {},
                        onSaveDumbbells = {},
                        onSaveBarbell = {},
                    )
                }
            }
        }

        composeRule.onNodeWithTag("settings-system-profile-dumbbells").assertIsDisplayed()
        composeRule.onNodeWithTag("settings-system-profile-barbell").assertIsDisplayed()
    }

    @Test
    fun providesRussianSystemProfileCopy() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val configuration = Configuration(context.resources.configuration).apply {
            setLocale(Locale.forLanguageTag("ru"))
        }
        val russian = context.createConfigurationContext(configuration)

        assertEquals("Гантели", russian.getString(R.string.settings_system_dumbbells_title))
        assertEquals("Штанга", russian.getString(R.string.settings_system_barbell_title))
        assertTrue(russian.getString(R.string.settings_system_profile_non_removable).isNotBlank())
    }
}

private open class FakeSettingsSource : SettingsDataSource {
    fun snapshot(): SettingsSnapshot {
        val dumbbellExercise = ExerciseDto(
            id = "exercise-dumbbell",
            name = "Dumbbell press",
            muscleGroup = "CHEST",
            category = "COMPOUND",
            equipmentType = "DUMBBELL",
        )
        val barbellExercise = ExerciseDto(
            id = "exercise-barbell",
            name = "Barbell squat",
            muscleGroup = "QUADS",
            category = "COMPOUND",
            equipmentType = "BARBELL",
        )
        val cableExercise = ExerciseDto(
            id = "exercise-1",
            name = "Cable row",
            muscleGroup = "BACK_THICKNESS",
            category = "COMPOUND",
            equipmentType = "CABLE",
        )
        val largePool = SettingsGymPlatePoolDto(
            id = "large-pool",
            name = "Large plates",
            compatibilityKey = "system_barbell_large",
            systemBarbellFamily = "LARGE",
            plates = listOf(1.25, 2.5, 5.0, 10.0, 15.0, 20.0).map {
                SettingsGymPlateInventoryItemDto(weightKg = it, quantity = null)
            },
        )
        val smallPool = SettingsGymPlatePoolDto(
            id = "small-pool",
            name = "Small plates",
            compatibilityKey = "system_barbell_small",
            systemBarbellFamily = "SMALL",
            plates = listOf(1.25, 2.5, 3.5, 5.0).map {
                SettingsGymPlateInventoryItemDto(weightKg = it, quantity = null)
            },
        )
        fun bar(id: String, weight: Double, family: String, pool: SettingsGymPlatePoolDto) =
            SettingsGymEquipmentDto(
                id = id,
                gymId = "gym-1",
                name = "$weight kg bar",
                equipmentType = "BARBELL",
                loadType = "PLATE_LOADED",
                baseLoadKg = weight,
                platePoolId = pool.id,
                loadingSides = 2,
                systemBarbellFamily = family,
                platePool = pool,
                exerciseLinks = listOf(barbellExercise),
            )
        val largeBars = listOf(
            bar("large-12", 12.0, "LARGE", largePool),
            bar("large-17.5", 17.5, "LARGE", largePool),
            bar("large-20", 20.0, "LARGE", largePool),
        )
        val smallBar = bar("small-6", 6.0, "SMALL", smallPool)
        return SettingsSnapshot(
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
        exercises = listOf(dumbbellExercise, barbellExercise, cableExercise),
        gymInventories = mapOf(
            "gym-1" to SettingsGymInventoryDto(
                id = "gym-1",
                name = "Basement",
                platePools = listOf(largePool, smallPool),
                equipment = largeBars + smallBar + listOf(
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
                systemProfiles = SettingsSystemProfilesDto(
                    dumbbells = SettingsDumbbellsSystemProfileDto(
                        id = "system-profile-dumbbells-gym-1",
                        weightsKg = listOf(10.0, 12.5, 20.0),
                        exerciseLinks = listOf(dumbbellExercise),
                    ),
                    barbell = SettingsBarbellSystemProfileDto(
                        id = "system-profile-barbell-gym-1",
                        exerciseLinks = listOf(barbellExercise),
                        families = listOf(
                            SettingsBarbellFamilyDto("LARGE", largePool, largeBars, 2),
                            SettingsBarbellFamilyDto("SMALL", smallPool, listOf(smallBar), 2),
                        ),
                    ),
                ),
                exerciseCoverage = listOf(dumbbellExercise, barbellExercise, cableExercise),
            ),
        ),
    )
    }

    override suspend fun load(): SettingsSnapshot = snapshot()

    override suspend fun saveProfile(input: SettingsProfileInput) =
        SettingsProfileDto(email = "android@test.dev", displayName = input.displayName)

    override suspend fun createGym(input: SettingsGymInput) = SettingsGymDto("gym-2", input.name)
    override suspend fun updateGym(id: String, input: SettingsGymUpdateInput) =
        SettingsGymDto(id, input.name)
    override suspend fun activateGym(id: String) = Unit
    override suspend fun deleteGym(id: String) = Unit
    override suspend fun loadGymInventory(gymId: String) = snapshot().gymInventories.getValue(gymId)
    override suspend fun saveGymEquipment(
        gymId: String,
        equipmentId: String?,
        input: SettingsGymEquipmentInput,
    ) = Unit
    override suspend fun saveDumbbellsSystemProfile(
        gymId: String,
        input: SettingsDumbbellsSystemProfileInput,
    ) = Unit
    override suspend fun saveBarbellSystemProfile(
        gymId: String,
        input: SettingsBarbellSystemProfileInput,
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

private class RetryableSystemProfileSource : FakeSettingsSource() {
    val inputs = mutableListOf<SettingsDumbbellsSystemProfileInput>()

    override suspend fun saveDumbbellsSystemProfile(
        gymId: String,
        input: SettingsDumbbellsSystemProfileInput,
    ) {
        inputs += input
        if (inputs.size == 1) {
            throw SettingsException(
                kind = SettingsErrorKind.INVALID_DATA,
                statusCode = 409,
                serverMessage = "System equipment profiles cannot be deleted.",
            )
        }
    }
}

private class RetryableSettingsSource(
    private val delegate: FakeSettingsSource = FakeSettingsSource(),
) : SettingsDataSource by delegate {
    private var attempts = 0

    override suspend fun load(): SettingsSnapshot {
        attempts += 1
        if (attempts == 1) error("Settings are unavailable")
        return delegate.snapshot()
    }
}

private fun testSettingsRepository(
    accountStore: SecureAccountStore,
    expectedToken: String,
    validation: SettingsSessionValidation = SettingsSessionValidation.VALID,
    loadSnapshot: suspend () -> SettingsSnapshot,
): SettingsRepository = SettingsRepository.failover(
    accountStore = accountStore,
    token = expectedToken,
    endpointResolver = ServerEndpointResolver(accountStore, ServerReachabilityProbe { true }),
    sessionValidator = SettingsSessionValidator { baseUrl, accessToken ->
        assertEquals(accountStore.sessionServerUrl, baseUrl)
        assertEquals(expectedToken, accessToken)
        validation
    },
    remoteFactory = { _, accessToken ->
        object : SettingsDataSource by FakeSettingsSource() {
            override fun withDiagnosticAttempt(attemptId: String): SettingsDataSource = this

            override suspend fun load(): SettingsSnapshot {
                assertEquals(expectedToken, accessToken)
                return loadSnapshot()
            }

            override suspend fun loadProfile() = loadSnapshot().profile

            override suspend fun loadGyms() = loadSnapshot().gymList

            override suspend fun loadExercises() = loadSnapshot().exercises

            override suspend fun loadGymInventory(gymId: String) =
                loadSnapshot().gymInventories.getValue(gymId)
        }
    },
)

private const val STALE_TOKEN = "stale-test-token"
private const val FRESH_TOKEN = "fresh-test-token"
