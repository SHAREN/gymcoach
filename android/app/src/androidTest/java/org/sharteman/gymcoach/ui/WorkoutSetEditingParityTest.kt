package org.sharteman.gymcoach.ui

import android.content.res.Configuration
import androidx.compose.material3.Button
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.click
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeUp
import java.util.Locale
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import org.junit.Rule
import org.junit.Assert.assertEquals
import org.junit.Test
import org.sharteman.gymcoach.data.local.LocalSetEntity
import org.sharteman.gymcoach.ui.theme.GymCoachTheme

class WorkoutSetEditingParityTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun editsCompletedSetInlineAndPersistsTheDraft() {
        setWorkoutContent()

        composeRule.onNodeWithTag("completed-set-1-edit").performClick()
        composeRule.onNodeWithTag("completed-set-1-weight-editor").assertIsDisplayed()
        composeRule.onNodeWithTag("completed-set-1-reps-editor").assertIsDisplayed()
        composeRule.onNodeWithTag("completed-set-1-rir-editor").assertIsDisplayed()

        composeRule.onNodeWithTag("completed-set-1-weight-editor").performClick()
        composeRule.onNodeWithTag("set-value-option-WEIGHT-102.5").performClick()
        composeRule.waitUntil(5_000) {
            composeRule.onAllNodesWithTag("completed-set-1-weight-editor")
                .fetchSemanticsNodes().isEmpty()
        }
        composeRule.onNodeWithTag("completed-set-1-weight").assertTextContains("102.5")
    }

    @Test
    fun scrollingCompletedWeightOnlyChangesTheDialogPreviewUntilConfirmed() {
        setWorkoutContent()

        composeRule.onNodeWithTag("completed-set-1-edit").performClick()
        composeRule.onNodeWithTag("completed-set-1-weight-editor").performClick()
        composeRule.onNodeWithTag("weight-picker-list").performTouchInput { swipeUp() }
        composeRule.waitUntil(5_000) {
            composeRule.onNodeWithTag("weight-picker-pointer")
                .fetchSemanticsNode().config[SemanticsProperties.StateDescription] != "100"
        }
        composeRule.onNodeWithTag("set-value-cancel").performClick()

        composeRule.onNodeWithTag("completed-set-1-weight-editor").assertTextContains("100")
    }

    @Test
    fun reappliesWeightRepsAndRirWithoutOpeningSetCount() {
        setWorkoutContent()

        chooseActiveValue("active-weight-picker", "set-value-option-WEIGHT-100")
        chooseActiveValue("active-reps-picker", "set-value-option-REPS-12")
        chooseActiveValue("active-rir-picker", "set-value-option-RIR-4")

        composeRule.onNodeWithTag("active-weight-picker").assertTextContains("100")
        composeRule.onNodeWithTag("active-reps-picker").assertTextContains("12")
        composeRule.onNodeWithTag("active-rir-picker").assertTextContains("4")
        composeRule.onNodeWithTag("apply-set-recommendation").performClick()

        composeRule.onNodeWithTag("active-weight-picker").assertTextContains("97.5")
        composeRule.onNodeWithTag("active-reps-picker").assertTextContains("10")
        composeRule.onNodeWithTag("active-rir-picker").assertTextContains("2")
        composeRule.onNodeWithTag("set-recommendation-dot").assertDoesNotExist()
        composeRule.onNodeWithTag("set-count-dialog").assertDoesNotExist()

        composeRule.onNodeWithTag("set-count-button").performClick()
        composeRule.onNodeWithTag("set-count-dialog").assertIsDisplayed()
    }

    @Test
    fun completedSetRepsAndBlankRirUseTheSharedPicker() {
        setWorkoutContent()

        composeRule.onNodeWithTag("completed-set-1-edit").performClick()
        composeRule.onNodeWithTag("completed-set-1-reps-editor").performClick()
        composeRule.onNodeWithTag("reps-picker-pointer-left").assertIsDisplayed()
        composeRule.onNodeWithTag("set-value-option-REPS-12").performClick()
        composeRule.waitUntil(5_000) {
            composeRule.onAllNodesWithTag("completed-set-1-reps-editor")
                .fetchSemanticsNodes().isEmpty()
        }
        composeRule.onNodeWithTag("completed-set-1-reps").assertTextContains("12")

        composeRule.onNodeWithTag("completed-set-1-edit").performClick()
        composeRule.onNodeWithTag("completed-set-1-rir-editor").performClick()
        composeRule.onNodeWithTag("rir-picker-pointer-left").assertIsDisplayed()
        composeRule.onNodeWithTag("set-value-option-RIR-none").performClick()
        composeRule.waitUntil(5_000) {
            composeRule.onAllNodesWithTag("completed-set-1-rir-editor")
                .fetchSemanticsNodes().isEmpty()
        }
        composeRule.onNodeWithTag("completed-set-1-rir").assertTextContains("–")
    }

    @Test
    fun rapidConfirmTapsInvokePersistenceExactlyOnce() {
        val release = CompletableDeferred<Unit>()
        val calls = AtomicInteger(0)
        setWorkoutContent(
            onConfirmSet = {
                calls.incrementAndGet()
                release.await()
                true
            },
        )

        composeRule.onNodeWithTag("active-set-confirm").performTouchInput {
            click()
            click()
        }
        composeRule.waitUntil(5_000) { calls.get() == 1 }
        release.complete(Unit)
        composeRule.waitForIdle()

        assertEquals(1, calls.get())
    }

    @Test
    fun deleteTargetsOneImmutableRowAndRenumbersTheRemainingDisplay() {
        var deletedId: String? = null
        setWorkoutContent(
            initialSets = listOf(
                displaySet("set-a", 1, "2026-07-15T10:00:00Z"),
                displaySet("set-b", 1, "2026-07-15T10:01:00Z"),
                displaySet("set-c", 7, "2026-07-15T10:02:00Z"),
            ),
            onDeleteSet = { set ->
                deletedId = set.id
                true
            },
        )

        composeRule.onNodeWithTag("completed-set-2-delete").performClick()
        composeRule.waitUntil(5_000) { deletedId != null }

        assertEquals("set-b", deletedId)
        composeRule.onNodeWithTag("completed-set-1").assertIsDisplayed()
        composeRule.onNodeWithTag("completed-set-2").assertIsDisplayed()
        composeRule.onNodeWithTag("completed-set-3").assertDoesNotExist()
    }

    @Test
    fun mutationExceptionShowsRecoverableSnackbarFeedback() {
        composeRule.setContent {
            val snackbar = remember { SnackbarHostState() }
            val scope = rememberCoroutineScope()
            Scaffold(snackbarHost = { SnackbarHost(snackbar) }) { padding ->
                Button(
                    modifier = Modifier.testTag("trigger-mutation-error"),
                    onClick = {
                        scope.launch {
                            runWorkoutSetMutation(snackbar, "Recoverable mutation error") {
                                error("database unavailable")
                            }
                        }
                    },
                    contentPadding = padding,
                ) {
                    Text("Trigger")
                }
            }
        }

        composeRule.onNodeWithTag("trigger-mutation-error").performClick()
        composeRule.onNodeWithText("Recoverable mutation error").assertIsDisplayed()
    }

    private fun chooseActiveValue(
        fieldTag: String,
        optionTag: String,
    ) {
        composeRule.onNodeWithTag(fieldTag).performClick()
        composeRule.onNodeWithTag(optionTag).performClick()
    }

    private fun setWorkoutContent(
        initialSets: List<LocalSetEntity>? = null,
        onDeleteSet: (suspend (LocalSetEntity) -> Boolean)? = null,
        onConfirmSet: (suspend () -> Boolean)? = null,
    ) {
        composeRule.setContent {
            val baseContext = LocalContext.current
            val baseConfiguration = LocalConfiguration.current
            val configuration = remember(baseConfiguration) {
                Configuration(baseConfiguration).apply { setLocale(Locale("ru")) }
            }
            val localizedContext = remember(baseContext, configuration) {
                baseContext.createConfigurationContext(configuration)
            }
            CompositionLocalProvider(
                LocalContext provides localizedContext,
                LocalConfiguration provides configuration,
            ) {
                GymCoachTheme(darkTheme = true) {
                    WorkoutScreenPreview(
                        initialSets = initialSets,
                        onDeleteSet = onDeleteSet,
                        onConfirmSet = onConfirmSet,
                    )
                }
            }
        }
    }

    private fun displaySet(id: String, setNumber: Int, completedAt: String) = LocalSetEntity(
        id = id,
        sessionId = "preview-session",
        exerciseId = "romanian-deadlift",
        setNumber = setNumber,
        weight = 100.0,
        reps = 10,
        rir = 2,
        completedAt = completedAt,
    )
}
