package org.sharteman.gymcoach.ui

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.sharteman.gymcoach.data.local.ActiveWorkoutRuntimeEntity
import org.sharteman.gymcoach.data.local.GymCoachDatabase
import org.sharteman.gymcoach.data.local.LocalSessionEntity
import org.sharteman.gymcoach.data.local.LocalSetEntity
import org.sharteman.gymcoach.data.model.BootstrapResponse
import org.sharteman.gymcoach.data.model.ExerciseDto
import org.sharteman.gymcoach.data.model.LastPerformanceDto
import org.sharteman.gymcoach.data.model.PerformanceSetDto
import org.sharteman.gymcoach.data.model.ProfileDto
import org.sharteman.gymcoach.data.model.ProgramDto
import org.sharteman.gymcoach.data.model.ProgramExerciseDto
import org.sharteman.gymcoach.data.model.ReturnRecommendationDto
import org.sharteman.gymcoach.data.model.WorkoutDto
import org.sharteman.gymcoach.data.network.ApiClient
import org.sharteman.gymcoach.data.programs.ExerciseInput
import org.sharteman.gymcoach.data.repository.GymCoachRepository
import org.sharteman.gymcoach.data.security.AccountStore

class WorkoutAdvanceUiTest {
    @get:Rule
    val composeRule = createComposeRule()

    private lateinit var database: GymCoachDatabase
    private lateinit var repository: GymCoachRepository

    @Before
    fun setUp() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        database = Room.inMemoryDatabaseBuilder(context, GymCoachDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        repository = GymCoachRepository(
            dao = database.dao(),
            accountStore = testAccountStore(),
            api = ApiClient(),
            scheduleSyncNow = {},
            schedulePeriodicSync = {},
        )
    }

    @After
    fun tearDown() {
        database.close()
    }

    @Test
    fun completingSecondSupersetMemberAdvancesToTheNextIncompleteExercise() {
        val workout = workout()
        val bootstrap = bootstrap(workout)
        runBlocking {
            database.dao().saveSession(
                LocalSessionEntity(
                    id = SESSION_ID,
                    workoutId = workout.id,
                    gymId = null,
                    startedAt = "2026-07-27T10:00:00Z",
                ),
            )
            database.dao().saveSet(completedSet("a", "set-a"))
            database.dao().saveActiveWorkoutRuntime(
                ActiveWorkoutRuntimeEntity(
                    sessionId = SESSION_ID,
                    workoutId = workout.id,
                    activeExerciseId = "b",
                    updatedAtEpochMs = System.currentTimeMillis(),
                ),
            )
        }

        composeRule.setContent {
            WorkoutScreen(
                repository = repository,
                sessionId = SESSION_ID,
                bootstrap = bootstrap,
                online = false,
                ownerUserId = "user",
                onUpdateExercise = { exercise, _: ExerciseInput -> exercise },
                onAskCoach = {},
                onOpenProgress = {},
                onOpenHistory = { _, _ -> },
                onExit = {},
            )
        }

        composeRule.waitUntil(5_000) {
            composeRule.onAllNodesWithText("2 / 3").fetchSemanticsNodes().isNotEmpty()
        }
        composeRule.onNodeWithTag("active-set-confirm").assertIsDisplayed().performClick()
        composeRule.waitUntil(5_000) {
            composeRule.onAllNodesWithText("3 / 3").fetchSemanticsNodes().isNotEmpty()
        }
        composeRule.waitUntil(5_000) {
            runBlocking { database.dao().getActiveWorkoutRuntime(SESSION_ID)?.activeExerciseId } == "c"
        }

        val exerciseIds = runBlocking {
            database.dao().getAllSets(SESSION_ID).filterNot { it.deleted }.map { it.exerciseId }.sorted()
        }
        val runtime = runBlocking { database.dao().getActiveWorkoutRuntime(SESSION_ID) }
        assertEquals(listOf("a", "b"), exerciseIds)
        assertEquals("c", runtime?.activeExerciseId)
        assertNotNull(runtime?.restEndsAtEpochMs)
    }

    private fun bootstrap(workout: WorkoutDto): BootstrapResponse {
        val recommendations = workout.exercises.associate { exercise ->
            exercise.id to ReturnRecommendationDto(
                mode = "normal",
                targetSets = exercise.targetSets,
                targetRIR = exercise.targetRIR,
            )
        }
        val second = workout.exercises[1]
        return BootstrapResponse(
            schemaVersion = 7,
            calculationVersion = "ui-test",
            serverTime = "2026-07-27T10:00:00Z",
            profile = ProfileDto(id = "user", email = "user@example.test"),
            activeProgram = ProgramDto(
                id = "program",
                name = "Test program",
                phase = "ACTIVE",
                workouts = listOf(workout),
            ),
            lastPerformances = mapOf(
                second.exerciseId to LastPerformanceDto(
                    exerciseId = second.exerciseId,
                    sessionId = "previous-session",
                    sessionStartedAt = "2026-07-20T10:00:00Z",
                    sets = listOf(PerformanceSetDto(weight = 10.0, reps = 10, rir = 2)),
                    maxWeight = 10.0,
                    repsAtMaxWeight = 10,
                ),
            ),
            returnRecommendationsByWorkout = mapOf(workout.id to recommendations),
        )
    }

    private fun workout(): WorkoutDto = WorkoutDto(
        id = "workout",
        programId = "program",
        name = "Superset workout",
        order = 0,
        exercises = listOf(
            programExercise("a", 0, 1),
            programExercise("b", 1, 1),
            programExercise("c", 2, null),
        ),
    )

    private fun programExercise(
        exerciseId: String,
        order: Int,
        group: Int?,
    ) = ProgramExerciseDto(
        id = "program-$exerciseId",
        workoutId = "workout",
        exerciseId = exerciseId,
        order = order,
        targetSets = 1,
        targetRepsMin = 10,
        targetRepsMax = 10,
        targetRIR = 2,
        restSec = 120,
        supersetGroup = group,
        exercise = ExerciseDto(
            id = exerciseId,
            name = "Exercise ${exerciseId.uppercase()}",
            muscleGroup = "CHEST",
            category = "COMPOUND",
        ),
    )

    private fun completedSet(exerciseId: String, id: String) = LocalSetEntity(
        id = id,
        sessionId = SESSION_ID,
        exerciseId = exerciseId,
        setNumber = 1,
        weight = 10.0,
        reps = 10,
        rir = 2,
        completedAt = "2026-07-27T10:00:00Z",
    )

    private fun testAccountStore() = object : AccountStore {
        override val deviceId = "emulator-ui-test"
        override var serverUrl = "https://example.test"
        override var userId: String? = "user"
        override var userEmail: String? = "user@example.test"
        private var token: String? = "test-token"

        override fun getAccessToken() = token
        override fun setAccessToken(token: String) {
            this.token = token
        }
        override fun clearAccessToken() {
            token = null
        }
        override fun clearAccount() {
            token = null
            userId = null
            userEmail = null
        }
    }

    private companion object {
        const val SESSION_ID = "session"
    }
}
