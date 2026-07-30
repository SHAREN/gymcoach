package org.sharteman.gymcoach.ui

import android.content.ContentValues
import android.content.Context
import android.graphics.Bitmap
import android.os.Environment
import android.provider.MediaStore
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import kotlinx.coroutines.flow.first
import kotlinx.serialization.encodeToString
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.sharteman.gymcoach.data.local.ActiveWorkoutRuntimeEntity
import org.sharteman.gymcoach.data.local.BootstrapCacheEntity
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
    private lateinit var api: ApiClient
    private lateinit var context: Context

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        database = Room.inMemoryDatabaseBuilder(context, GymCoachDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        api = ApiClient()
        repository = GymCoachRepository(
            dao = database.dao(),
            accountStore = testAccountStore(),
            api = api,
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

    @Test
    fun manualSetCountFromTableAndMenuOverridesReturnRecommendationImmediately() {
        val workout = setCountWorkout()
        val bootstrap = bootstrap(workout, recommendedTargetSets = 2)
        runBlocking {
            database.dao().saveBootstrap(
                BootstrapCacheEntity(
                    payloadJson = api.json.encodeToString(bootstrap),
                    updatedAtEpochMs = 1_000,
                ),
            )
            database.dao().saveSession(
                LocalSessionEntity(
                    id = SESSION_ID,
                    workoutId = workout.id,
                    gymId = null,
                    startedAt = "2026-07-30T10:00:00Z",
                ),
            )
            database.dao().saveActiveWorkoutRuntime(
                ActiveWorkoutRuntimeEntity(
                    sessionId = SESSION_ID,
                    workoutId = workout.id,
                    activeExerciseId = "a",
                    updatedAtEpochMs = 1_000,
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

        composeRule.onNodeWithText("0 / 2").assertIsDisplayed()
        composeRule.onNodeWithTag("set-count-button").performClick()
        repeat(2) {
            composeRule.onNodeWithContentDescription(
                context.getString(org.sharteman.gymcoach.R.string.increase),
            ).performClick()
            composeRule.waitForIdle()
        }
        composeRule.onNodeWithText("4").assertIsDisplayed()
        composeRule.onNodeWithText(
            context.getString(org.sharteman.gymcoach.R.string.save),
        ).performClick()
        composeRule.waitUntil(5_000) {
            runBlocking {
                database.dao().getActiveTargetSetOverride(SESSION_ID, "program-a") != null
            }
        }
        assertEquals(
            4,
            runBlocking {
                database.dao().getActiveTargetSetOverride(SESSION_ID, "program-a")?.targetSets
            },
        )
        composeRule.onNodeWithText("0 / 4").assertIsDisplayed()
        saveScreenshot("manual-target-sets-table-4.png")

        composeRule.onNodeWithTag("active-exercise-actions").performClick()
        composeRule.onNodeWithTag("exercise-menu-target-sets").performClick()
        composeRule.waitForIdle()
        saveScreenshot("manual-target-sets-menu.png")
        composeRule.onNodeWithTag("exercise-target-sets-5").performClick()
        composeRule.waitUntil(5_000) {
            composeRule.onAllNodesWithText("0 / 5").fetchSemanticsNodes().isNotEmpty()
        }
        assertEquals(
            5,
            runBlocking {
                database.dao().getActiveTargetSetOverride(SESSION_ID, "program-a")?.targetSets
            },
        )
        saveScreenshot("manual-target-sets-menu-5.png")
    }

    @Test
    fun activeTargetSetRepositoryPersistsOverrideInRoom() = runBlocking {
        val workout = setCountWorkout()
        val bootstrap = bootstrap(workout, recommendedTargetSets = 2)
        database.dao().saveBootstrap(
            BootstrapCacheEntity(
                payloadJson = api.json.encodeToString(bootstrap),
                updatedAtEpochMs = 1_000,
            ),
        )
        database.dao().saveSession(
            LocalSessionEntity(
                id = SESSION_ID,
                workoutId = workout.id,
                gymId = null,
                startedAt = "2026-07-30T10:00:00Z",
            ),
        )
        database.dao().saveActiveWorkoutRuntime(
            ActiveWorkoutRuntimeEntity(
                sessionId = SESSION_ID,
                workoutId = workout.id,
                activeExerciseId = "a",
                updatedAtEpochMs = 1_000,
            ),
        )

        repository.updateActiveTargetSets(
            SESSION_ID,
            "program-a",
            4,
            effectiveTargetDropSets = 0,
        )

        assertEquals(
            4,
            database.dao().getActiveTargetSetOverride(SESSION_ID, "program-a")?.targetSets,
        )
        val restartedRepository = GymCoachRepository(
            dao = database.dao(),
            accountStore = testAccountStore(),
            api = api,
            scheduleSyncNow = {},
            schedulePeriodicSync = {},
        )
        assertEquals(
            4,
            restartedRepository.observeActiveTargetSetOverrides(SESSION_ID)
                .first()
                .single()
                .targetSets,
        )
    }

    private fun bootstrap(
        workout: WorkoutDto,
        recommendedTargetSets: Int? = null,
    ): BootstrapResponse {
        val recommendations = workout.exercises.associate { exercise ->
            exercise.id to ReturnRecommendationDto(
                mode = if (recommendedTargetSets == null) "normal" else "exercise-reintro",
                targetSets = recommendedTargetSets ?: exercise.targetSets,
                targetRIR = if (recommendedTargetSets == null) exercise.targetRIR else 3,
            )
        }
        val previous = workout.exercises.getOrNull(1) ?: workout.exercises.first()
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
                previous.exerciseId to LastPerformanceDto(
                    exerciseId = previous.exerciseId,
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

    private fun setCountWorkout(): WorkoutDto = WorkoutDto(
        id = "workout-set-count",
        programId = "program",
        name = "Set count workout",
        order = 0,
        exercises = listOf(
            programExercise("a", 0, null).copy(
                workoutId = "workout-set-count",
                targetSets = 4,
            ),
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
