package org.sharteman.gymcoach.ui.coach

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import org.junit.Rule
import org.junit.Test
import org.sharteman.gymcoach.data.coach.ChatMessage
import org.sharteman.gymcoach.data.coach.ChatRole
import org.sharteman.gymcoach.data.coach.CoachConditioningDto
import org.sharteman.gymcoach.data.coach.CoachContextDto
import org.sharteman.gymcoach.data.coach.CoachDebriefDto
import org.sharteman.gymcoach.data.coach.CoachOverviewDto
import org.sharteman.gymcoach.data.coach.CoachProviderDto
import org.sharteman.gymcoach.data.coach.ProgramExerciseDefaultsDto
import org.sharteman.gymcoach.ui.theme.GymCoachTheme

class CoachScreensTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun coachContentShowsContextMarkdownAndRequiresApplyAction() {
        val overview = overview()
        val state = CoachUiState(
            loading = false,
            overview = overview,
            activeDebriefId = "debrief_1",
            note = "Busy week",
            savedNote = "Busy week",
            selectedAdjustments = setOf(0),
        )
        var applyRequested = false
        compose.setContent {
            GymCoachTheme {
                CoachScreenContent(
                    state = state,
                    onBack = {},
                    onOpenChat = {},
                    onRetry = {},
                    onNoteChange = {},
                    onSaveNote = {},
                    onClearNote = {},
                    onRequestDebrief = {},
                    onSelectDebrief = {},
                    onToggleAdjustment = { _, _ -> },
                    onApplySelected = { applyRequested = true },
                )
            }
        }

        compose.onNodeWithTag("coach-context").assertIsDisplayed()
        compose.onNodeWithText("Weekly review").assertExists()
        compose.onNodeWithTag("coach-apply-selected").performScrollTo().performClick()
        compose.runOnIdle { check(applyRequested) }
    }

    @Test
    fun chatContentRendersStructuredAssistantMarkdownAndLiveSessionBanner() {
        compose.setContent {
            GymCoachTheme {
                ChatScreenContent(
                    state = ChatUiState(
                        loading = false,
                        provider = CoachProviderDto(true, "Demo", ""),
                        messages = listOf(
                            ChatMessage(ChatRole.USER, "What now?"),
                            ChatMessage(ChatRole.ASSISTANT, "# Plan\n- Keep the load"),
                        ),
                    ),
                    sessionId = "session_1",
                    onBack = {},
                    onNewConversation = {},
                    onOpenConversation = {},
                    onInputChange = {},
                    onSend = {},
                )
            }
        }

        compose.onNodeWithText("Plan").assertExists()
        compose.onNodeWithText("Keep the load").assertExists()
        compose.onNodeWithTag("coach-chat-input").assertIsDisplayed()
    }

    @Test
    fun applyingAdjustmentsRequiresAnExplicitConfirmationClick() {
        var confirmed = false
        compose.setContent {
            GymCoachTheme {
                CoachApplyConfirmationDialog(
                    selectedCount = 1,
                    applying = false,
                    onConfirm = { confirmed = true },
                    onDismiss = {},
                )
            }
        }

        compose.onNodeWithTag("coach-confirm-apply").assertIsDisplayed().performClick()
        compose.runOnIdle { check(confirmed) }
    }

    private fun overview() = CoachOverviewDto(
        context = CoachContextDto(
            conditioning = CoachConditioningDto(0, 0.0, 0, 150),
            weeksOfHistory = 2,
            exercisesTracked = 1,
        ),
        coachNote = "Busy week",
        provider = CoachProviderDto(true, "Demo", ""),
        history = listOf(
            CoachDebriefDto(
                id = "debrief_1",
                weekStart = "2026-07-13T00:00:00Z",
                weekEnd = "2026-07-20T00:00:00Z",
                response = """
                    # Weekly review
                    Keep the productive work.
                    <adjustments>
                    [{"exerciseName":"Bench Press","summary":"Hold technique","suggestedSets":3}]
                    </adjustments>
                """.trimIndent(),
                createdAt = "2026-07-14T10:00:00Z",
            ),
        ),
        programDefaults = mapOf(
            "Bench Press" to ProgramExerciseDefaultsDto(8, 12, 3, 2, 120),
        ),
    )
}
