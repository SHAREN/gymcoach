package org.sharteman.gymcoach.ui

import android.content.ContentValues
import android.graphics.Bitmap
import android.os.Environment
import android.provider.MediaStore
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import androidx.test.platform.app.InstrumentationRegistry
import org.sharteman.gymcoach.data.model.ExerciseDto
import org.sharteman.gymcoach.data.model.ProgramExerciseDto
import org.sharteman.gymcoach.data.model.WorkoutStructureDraft
import org.sharteman.gymcoach.data.model.WorkoutStructureSnapshotDto

class WorkoutProgramDecisionUiTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun completedWorkoutShowsHumanReadableDiffAndBothExplicitChoices() {
        var applied = false
        val draft = draft()
        composeRule.setContent {
            MaterialTheme {
                WorkoutProgramDecisionDialog(
                    draft = draft,
                    busy = false,
                    onApply = { applied = true },
                    onKeepForSession = {},
                    onLater = {},
                )
            }
        }

        composeRule.onNodeWithTag("workout-program-decision-dialog").assertIsDisplayed()
        composeRule.onNodeWithText("Bench press", substring = true).assertIsDisplayed()
        saveScreenshot("gymcoach-idh-program-decision.png")
        composeRule.onNodeWithTag("save-structure-to-program")
            .assertIsDisplayed()
            .performClick()
        assertTrue(applied)
        composeRule.onNodeWithTag("keep-structure-for-session").assertIsDisplayed()
    }

    private fun saveScreenshot(name: String) {
        if (InstrumentationRegistry.getArguments().getString("captureScreenshots") != "true") return
        val targetContext = InstrumentationRegistry.getInstrumentation().targetContext
        val values = ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, name)
            put(MediaStore.Images.Media.MIME_TYPE, "image/png")
            put(
                MediaStore.Images.Media.RELATIVE_PATH,
                "${Environment.DIRECTORY_PICTURES}/GymCoachTests",
            )
        }
        val uri = requireNotNull(
            targetContext.contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values),
        )
        targetContext.contentResolver.openOutputStream(uri).use { output ->
            requireNotNull(output)
            InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
                .compress(Bitmap.CompressFormat.PNG, 100, output)
        }
    }

    private fun draft(): WorkoutStructureDraft {
        val exercise = ExerciseDto(
            id = "exercise_1",
            name = "Bench press",
            muscleGroup = "CHEST",
            category = "COMPOUND",
        )
        val baseline = ProgramExerciseDto(
            id = "program_exercise_1",
            workoutId = "workout_1",
            exerciseId = exercise.id,
            order = 0,
            targetSets = 3,
            targetRepsMin = 8,
            targetRepsMax = 12,
            targetRIR = 2,
            restSec = 120,
            exercise = exercise,
        )
        return WorkoutStructureDraft(
            sessionId = "session_1",
            status = "PENDING",
            baseline = WorkoutStructureSnapshotDto(
                workoutId = "workout_1",
                workoutName = "Upper body",
                exercises = listOf(baseline),
            ),
            current = WorkoutStructureSnapshotDto(
                workoutId = "workout_1",
                workoutName = "Upper body",
                exercises = listOf(baseline.copy(targetSets = 5, notes = "Pause on chest")),
            ),
            updatedAtEpochMs = 1,
        )
    }
}
