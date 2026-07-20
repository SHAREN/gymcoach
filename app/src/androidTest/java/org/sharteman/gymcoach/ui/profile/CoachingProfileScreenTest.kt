package org.sharteman.gymcoach.ui.profile

import android.content.res.Configuration
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertContentDescriptionEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import java.util.Locale
import kotlinx.coroutines.CompletableDeferred
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.sharteman.gymcoach.R
import org.sharteman.gymcoach.data.model.CoachingFieldDto
import org.sharteman.gymcoach.data.model.CoachingLimitationsValueDto
import org.sharteman.gymcoach.data.model.CoachingLimitationDto
import org.sharteman.gymcoach.data.model.CoachingOutsideActivityDto
import org.sharteman.gymcoach.data.model.CoachingProfileDto
import org.sharteman.gymcoach.data.model.CoachingProfilePatchInput
import org.sharteman.gymcoach.data.profile.CoachingProfileDataSource
import org.sharteman.gymcoach.data.profile.CoachingProfileLoadResult
import org.sharteman.gymcoach.data.profile.CoachingProfileSaveResult
import org.sharteman.gymcoach.data.settings.SettingsErrorKind
import org.sharteman.gymcoach.data.settings.SettingsException
import org.sharteman.gymcoach.ui.theme.GymCoachTheme

class CoachingProfileScreenTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun rendersEverySectionAndMedicalBlockOnNarrowScreen() {
        val source = FakeProfileSource(fullProfile())
        composeRule.setContent {
            GymCoachTheme(darkTheme = true) {
                Box(Modifier.width(320.dp)) {
                    CoachingProfileScreen(
                        initialProfile = fullProfile(),
                        onBack = {},
                        onAuthenticationRequired = {},
                        repository = source,
                    )
                }
            }
        }

        waitForScreen()
        composeRule.onNodeWithTag("coaching-profile-clearance-block")
            .performScrollTo()
            .assertIsDisplayed()
            .assertContentDescriptionEquals(
                InstrumentationRegistry.getInstrumentation().targetContext.getString(
                    R.string.coaching_profile_clearance_block,
                ),
            )
        assertEquals(
            LiveRegionMode.Assertive,
            composeRule.onNodeWithTag("coaching-profile-clearance-block")
                .fetchSemanticsNode()
                .config[SemanticsProperties.LiveRegion],
        )
        listOf(
            "coaching-profile-safety",
            "coaching-profile-limitations",
            "coaching-profile-preferences",
            "coaching-profile-recovery",
        ).forEach { tag ->
            composeRule.onNodeWithTag("coaching-profile-screen").performScrollToNode(hasTestTag(tag))
            composeRule.onNodeWithTag(tag).assertIsDisplayed()
        }
        composeRule.onNodeWithTag("coaching-profile-save-recovery").performScrollTo().assertIsDisplayed()
    }

    @Test
    fun validatesKnownDurationThenSendsOnlySafetySectionFields() {
        val source = FakeProfileSource(fullProfile())
        composeRule.setContent {
            GymCoachTheme(darkTheme = true) {
                CoachingProfileScreen(
                    initialProfile = fullProfile(),
                    onBack = {},
                    onAuthenticationRequired = {},
                    repository = source,
                )
            }
        }

        waitForScreen()
        composeRule.onNodeWithTag("coaching-profile-save-safety").performScrollTo().performClick()
        composeRule.waitUntil(10_000) { source.saved.size == 1 }
        val patch = source.saved.single()
        assertEquals(75, patch.maximumSessionDurationMin?.value)
        assertTrue(patch.healthStatus != null)
        assertTrue(patch.trainingLevel != null)
        assertTrue(patch.availableWeekdays != null)
        assertEquals(null, patch.limitations)
        assertEquals(null, patch.outsideActivities)
        assertEquals(null, patch.averageSleepHours)

        composeRule.onNodeWithTag("coaching-profile-duration").performScrollTo().performTextClearance()
        composeRule.onNodeWithTag("coaching-profile-save-safety").performClick()
        composeRule.runOnIdle { assertEquals(1, source.saved.size) }
    }

    @Test
    fun showsOfflinePendingStateAndRetriesWithoutLeavingScreen() {
        val source = FakeProfileSource(CoachingProfileDto()).apply { queueSaves = true }
        composeRule.setContent {
            GymCoachTheme(darkTheme = true) {
                CoachingProfileScreen(
                    initialProfile = CoachingProfileDto(),
                    onBack = {},
                    onAuthenticationRequired = {},
                    repository = source,
                )
            }
        }

        waitForScreen()
        composeRule.onNodeWithTag("coaching-profile-save-safety").performScrollTo().performClick()
        composeRule.waitUntil(10_000) {
            runCatching {
                composeRule.onNodeWithTag("coaching-profile-retry-save").assertIsDisplayed()
            }.isSuccess
        }
        composeRule.onNodeWithTag("coaching-profile-retry-save").performClick()
        composeRule.waitUntil(10_000) { source.retryCalls == 1 }
        composeRule.onNodeWithTag("coaching-profile-screen").assertIsDisplayed()
    }

    @Test
    fun loadErrorRetriesWithoutLeavingProfile() {
        val retrySource = FakeProfileSource(CoachingProfileDto()).apply {
            loadFailures += SettingsException(SettingsErrorKind.SERVER_UNAVAILABLE)
        }
        composeRule.setContent {
            GymCoachTheme(darkTheme = true) {
                CoachingProfileScreen(
                    onBack = {},
                    onAuthenticationRequired = {},
                    repository = retrySource,
                )
            }
        }
        composeRule.waitUntil(10_000) {
            runCatching { composeRule.onNodeWithTag("coaching-profile-retry-load").assertIsDisplayed() }.isSuccess
        }
        composeRule.onNodeWithTag("coaching-profile-retry-load").performClick()
        waitForScreen()
    }

    @Test
    fun authenticationExpiryReturnsToLogin() {
        var authenticationRequired = false
        val authSource = FakeProfileSource(CoachingProfileDto()).apply {
            loadFailures += SettingsException(SettingsErrorKind.AUTHENTICATION, statusCode = 401)
        }
        composeRule.setContent {
            GymCoachTheme(darkTheme = true) {
                CoachingProfileScreen(
                    onBack = {},
                    onAuthenticationRequired = { authenticationRequired = true },
                    repository = authSource,
                )
            }
        }
        composeRule.waitUntil(10_000) { authenticationRequired }
        composeRule.runOnIdle { assertTrue(authenticationRequired) }
    }

    @Test
    fun providesCompleteRussianCoachingCopy() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val configuration = Configuration(context.resources.configuration).apply {
            setLocale(Locale.forLanguageTag("ru"))
        }
        val russian = context.createConfigurationContext(configuration)

        assertEquals("Профиль для тренера", russian.getString(R.string.coaching_profile_title))
        assertTrue(russian.getString(R.string.coaching_profile_clearance_block).contains("квалифицированный"))
        assertTrue(russian.getString(R.string.coaching_profile_pending).isNotBlank())
        assertTrue(russian.getString(R.string.coaching_profile_recovery_help).isNotBlank())
    }

    @Test
    fun preservesUnsavedDraftAcrossActivityStateRestoration() {
        val source = FakeProfileSource(fullProfile())
        val restoration = StateRestorationTester(composeRule)
        restoration.setContent {
            GymCoachTheme(darkTheme = true) {
                CoachingProfileScreen(
                    initialProfile = fullProfile(),
                    onBack = {},
                    onAuthenticationRequired = {},
                    repository = source,
                )
            }
        }
        waitForScreen()
        composeRule.onNodeWithTag("coaching-profile-duration").performScrollTo().performTextClearance()

        restoration.emulateSavedInstanceStateRestore()

        val restoredDuration = composeRule.onNodeWithTag("coaching-profile-duration")
            .performScrollTo()
            .fetchSemanticsNode()
            .config[SemanticsProperties.EditableText]
        assertEquals("", restoredDuration.text)
        composeRule.runOnIdle { assertEquals(1, source.loadCalls) }
    }

    @Test
    fun preservesLoadErrorAcrossActivityStateRestoration() {
        val source = FakeProfileSource(CoachingProfileDto()).apply {
            loadFailures += SettingsException(SettingsErrorKind.SERVER_UNAVAILABLE)
        }
        val restoration = StateRestorationTester(composeRule)
        restoration.setContent {
            GymCoachTheme(darkTheme = true) {
                CoachingProfileScreen(
                    onBack = {},
                    onAuthenticationRequired = {},
                    repository = source,
                )
            }
        }
        composeRule.waitUntil(10_000) {
            runCatching { composeRule.onNodeWithTag("coaching-profile-retry-load").assertIsDisplayed() }.isSuccess
        }

        restoration.emulateSavedInstanceStateRestore()

        composeRule.onNodeWithTag("coaching-profile-retry-load").assertIsDisplayed()
        composeRule.runOnIdle { assertEquals(1, source.loadCalls) }
    }

    @Test
    fun preservesQueuedSaveAcrossActivityStateRestoration() {
        val source = FakeProfileSource(fullProfile()).apply { queueSaves = true }
        val restoration = StateRestorationTester(composeRule)
        restoration.setContent {
            GymCoachTheme(darkTheme = true) {
                CoachingProfileScreen(
                    initialProfile = fullProfile(),
                    onBack = {},
                    onAuthenticationRequired = {},
                    repository = source,
                )
            }
        }
        waitForScreen()
        composeRule.onNodeWithTag("coaching-profile-save-safety").performScrollTo().performClick()
        composeRule.waitUntil(10_000) { source.saved.size == 1 }
        composeRule.onNodeWithTag("coaching-profile-screen")
            .performScrollToNode(hasTestTag("coaching-profile-pending"))
        composeRule.onNodeWithTag("coaching-profile-pending").assertIsDisplayed()

        restoration.emulateSavedInstanceStateRestore()

        composeRule.onNodeWithTag("coaching-profile-screen")
            .performScrollToNode(hasTestTag("coaching-profile-pending"))
        composeRule.onNodeWithTag("coaching-profile-pending").assertIsDisplayed()
        composeRule.onNodeWithTag("coaching-profile-retry-save").assertIsDisplayed()
        composeRule.runOnIdle { assertEquals(1, source.loadCalls) }
    }

    @Test
    fun selectedUnknownChipDoesNotClearUnsupportedFutureValue() {
        val futureProfile = fullProfile().copy(
            healthStatus = CoachingFieldDto("KNOWN", "FUTURE_HEALTH_STATUS", T),
        )
        val source = FakeProfileSource(futureProfile)
        composeRule.setContent {
            GymCoachTheme(darkTheme = true) {
                CoachingProfileScreen(
                    initialProfile = futureProfile,
                    onBack = {},
                    onAuthenticationRequired = {},
                    repository = source,
                )
            }
        }
        waitForScreen()
        composeRule.onNodeWithTag("coaching-profile-health-state-UNKNOWN").performClick()
        composeRule.onNodeWithTag("coaching-profile-save-safety").performScrollTo().performClick()
        composeRule.waitUntil(10_000) { source.saved.size == 1 }

        assertNull(source.saved.single().healthStatus)
    }

    @Test
    fun distinguishesCachedReadFailureFromQueuedWrite() {
        val source = FakeProfileSource(fullProfile()).apply {
            loadRetryableError = SettingsErrorKind.SERVER_UNAVAILABLE
        }
        composeRule.setContent {
            GymCoachTheme(darkTheme = true) {
                CoachingProfileScreen(
                    initialProfile = fullProfile(),
                    onBack = {},
                    onAuthenticationRequired = {},
                    repository = source,
                )
            }
        }
        waitForScreen()

        composeRule.onNodeWithTag("coaching-profile-stale-cache").assertIsDisplayed()
        composeRule.onNodeWithTag("coaching-profile-pending").assertDoesNotExist()
    }

    @Test
    fun refreshUsesTheLatestLoadedProfileAsItsOfflineFallback() {
        val staleBootstrap = fullProfile()
        val freshProfile = fullProfile().copy(updatedAt = FRESH_T)
        val source = FakeProfileSource(freshProfile)
        composeRule.setContent {
            GymCoachTheme(darkTheme = true) {
                CoachingProfileScreen(
                    initialProfile = staleBootstrap,
                    onBack = {},
                    onAuthenticationRequired = {},
                    repository = source,
                )
            }
        }
        waitForScreen()
        composeRule.onNodeWithTag("coaching-profile-refresh").performClick()
        composeRule.waitUntil(10_000) { source.loadCalls == 2 }

        composeRule.runOnIdle {
            assertEquals(staleBootstrap, source.loadInputs.first())
            assertEquals(freshProfile, source.loadInputs.last())
        }
    }

    @Test
    fun refreshDoesNotDiscardEditsMadeWhileTheRequestIsRunning() {
        val refreshedProfile = fullProfile().copy(
            updatedAt = FRESH_T,
            maximumSessionDurationMin = CoachingFieldDto("KNOWN", 90, FRESH_T),
        )
        val source = FakeProfileSource(refreshedProfile)
        composeRule.setContent {
            GymCoachTheme(darkTheme = true) {
                CoachingProfileScreen(
                    initialProfile = fullProfile(),
                    onBack = {},
                    onAuthenticationRequired = {},
                    repository = source,
                )
            }
        }
        waitForScreen()
        val gate = CompletableDeferred<Unit>()
        source.loadGate = gate
        composeRule.onNodeWithTag("coaching-profile-refresh").performClick()
        composeRule.waitUntil(10_000) { source.loadCalls == 2 }
        val durationField = composeRule.onNodeWithTag("coaching-profile-duration")
        durationField.performScrollTo()
        durationField.performTextClearance()
        durationField.performTextInput("80")

        gate.complete(Unit)
        composeRule.waitUntil(10_000) { source.loadCompletions == 2 }
        composeRule.waitForIdle()

        val duration = composeRule.onNodeWithTag("coaching-profile-duration")
            .fetchSemanticsNode()
            .config[SemanticsProperties.EditableText]
        assertEquals("80", duration.text)
    }

    private fun waitForScreen() {
        composeRule.waitUntil(10_000) {
            runCatching { composeRule.onNodeWithTag("coaching-profile-screen").assertIsDisplayed() }.isSuccess
        }
    }

    private class FakeProfileSource(
        private val loadedProfile: CoachingProfileDto,
    ) : CoachingProfileDataSource {
        val loadFailures = ArrayDeque<SettingsException>()
        val saved = mutableListOf<CoachingProfilePatchInput>()
        var queueSaves = false
        var retryCalls = 0
        var loadCalls = 0
        var loadCompletions = 0
        val loadInputs = mutableListOf<CoachingProfileDto?>()
        var loadRetryableError: SettingsErrorKind? = null
        var loadGate: CompletableDeferred<Unit>? = null

        override suspend fun load(initialProfile: CoachingProfileDto?): CoachingProfileLoadResult {
            loadCalls += 1
            loadInputs += initialProfile
            if (loadFailures.isNotEmpty()) throw loadFailures.removeFirst()
            loadGate?.await()
            loadCompletions += 1
            return CoachingProfileLoadResult(loadedProfile, retryableError = loadRetryableError)
        }

        override suspend fun save(
            currentProfile: CoachingProfileDto,
            patch: CoachingProfilePatchInput,
        ): CoachingProfileSaveResult {
            saved += patch
            return CoachingProfileSaveResult(currentProfile, pending = queueSaves)
        }

        override suspend fun retryPending(currentProfile: CoachingProfileDto): CoachingProfileSaveResult {
            retryCalls += 1
            queueSaves = false
            return CoachingProfileSaveResult(currentProfile)
        }
    }

    private fun fullProfile() = CoachingProfileDto(
        updatedAt = T,
        healthStatus = CoachingFieldDto("KNOWN", "MEDICAL_CLEARANCE_REQUIRED", T),
        trainingLevel = CoachingFieldDto("KNOWN", "INTERMEDIATE", T),
        availableWeekdays = CoachingFieldDto("KNOWN", listOf(1, 3, 5), T),
        limitations = CoachingFieldDto(
            "KNOWN",
            CoachingLimitationsValueDto(
                listOf(CoachingLimitationDto("PAIN", "Pressing", listOf("Bench press"))),
            ),
            T,
        ),
        maximumSessionDurationMin = CoachingFieldDto("KNOWN", 75, T),
        priorityMuscles = CoachingFieldDto("KNOWN", listOf("CHEST"), T),
        priorityStrengthMovements = CoachingFieldDto("KNOWN", listOf("Bench press"), T),
        outsideActivities = CoachingFieldDto(
            "KNOWN",
            listOf(CoachingOutsideActivityDto("CARDIO", "Cycling", minutesPerWeek = 90)),
            T,
        ),
        likedExercises = CoachingFieldDto("KNOWN", listOf("Pull-up"), T),
        dislikedExercises = CoachingFieldDto("NOT_APPLICABLE", null, T),
        averageSleepHours = CoachingFieldDto("KNOWN", 7.5, T),
        baselineStress = CoachingFieldDto("KNOWN", 3, T),
        generalRecovery = CoachingFieldDto("KNOWN", 4, T),
    )

    private companion object {
        const val T = "2026-07-18T10:00:00.000Z"
        const val FRESH_T = "2026-07-18T10:01:00.000Z"
    }
}
