package org.sharteman.gymcoach.ui

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import org.junit.Rule
import org.junit.Test
import org.sharteman.gymcoach.data.local.LocalSetEntity
import org.sharteman.gymcoach.data.model.ExerciseDto
import org.sharteman.gymcoach.data.model.ProgramExerciseDto
import org.sharteman.gymcoach.data.model.ReturnRecommendationDto
import org.sharteman.gymcoach.training.LoadConstraints
import org.sharteman.gymcoach.training.recommendNextSetFromSharedContract
import org.sharteman.gymcoach.ui.theme.GymCoachTheme

class NextSetRecommendationUiTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun returnRecommendationRendersSharedWeightRepsAndRir() {
        val recommendation = requireNotNull(
            recommendNextSetFromSharedContract(
                programExercise = programExercise(),
                returnRecommendation = returnRecommendation(),
                completedSets = listOf(completedSet()),
                recoverySec = 120,
                constraints = LoadConstraints(
                    equipmentType = "DUMBBELL",
                    dumbbellWeights = listOf(30.0, 32.5, 35.0),
                ),
            ),
        )

        composeRule.setContent {
            GymCoachTheme(darkTheme = true) {
                RestTimerCard(
                    remainingSec = 90,
                    totalSec = 120,
                    recommendation = recommendation,
                    unit = "KG",
                    onAdd30 = {},
                    onSkip = {},
                )
            }
        }

        composeRule.onNodeWithText("32.5 kg × 10\nRIR 4").assertIsDisplayed()
    }

    private fun programExercise() = ProgramExerciseDto(
        id = "pe_parity",
        workoutId = "workout_parity",
        exerciseId = "exercise_parity",
        order = 1,
        targetSets = 3,
        targetRepsMin = 10,
        targetRepsMax = 10,
        targetRIR = 2,
        restSec = 120,
        autoregulationMode = "PRESERVE_RIR",
        fatigueRate = 0.5,
        loadAdjustmentPct = 3.0,
        exercise = ExerciseDto(
            id = "exercise_parity",
            name = "Parity dumbbell curl",
            muscleGroup = "BICEPS",
            category = "ISOLATION",
            equipmentType = "DUMBBELL",
        ),
    )

    private fun returnRecommendation() = ReturnRecommendationDto(
        mode = "muscle-reintro",
        exerciseGapDays = 60,
        returnGapDays = 60,
        muscleGapDays = 60,
        targetSets = 1,
        targetRIR = 4,
        suggestedWeight = 32.5,
        weightCeiling = 32.5,
        calibrationRequired = true,
        historySessionCount = 3,
        recentHistorySessionCount = 1,
        longTermHistorySessionCount = 2,
        historyBasis = "recent-and-long-term",
        confidence = "medium",
    )

    private fun completedSet() = LocalSetEntity(
        id = "set_parity",
        sessionId = "session_parity",
        exerciseId = "exercise_parity",
        setNumber = 1,
        weight = 32.5,
        reps = 12,
        rir = 2,
        completedAt = "2026-07-27T10:00:00Z",
    )
}
