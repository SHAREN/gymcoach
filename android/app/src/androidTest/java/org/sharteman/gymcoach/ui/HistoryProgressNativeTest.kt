package org.sharteman.gymcoach.ui

import android.content.ContentValues
import android.graphics.Bitmap
import android.os.Environment
import android.provider.MediaStore
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToNode
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.sharteman.gymcoach.R
import org.sharteman.gymcoach.data.model.MobileDeloadStatusDto
import org.sharteman.gymcoach.data.model.BootstrapResponse
import org.sharteman.gymcoach.data.model.ExerciseDto
import org.sharteman.gymcoach.data.model.GymDto
import org.sharteman.gymcoach.data.model.GymEquipmentDto
import org.sharteman.gymcoach.data.model.GymEquipmentExerciseDto
import org.sharteman.gymcoach.data.model.GymExerciseConfigDto
import org.sharteman.gymcoach.data.model.HistoricalSetAddRequest
import org.sharteman.gymcoach.data.model.HistoricalSetUpdateRequest
import org.sharteman.gymcoach.data.model.ProfileDto
import org.sharteman.gymcoach.data.model.ProgramDto
import org.sharteman.gymcoach.data.model.ProgramExerciseDto
import org.sharteman.gymcoach.data.model.WorkoutDto
import org.sharteman.gymcoach.data.model.MobileExerciseRecordDto
import org.sharteman.gymcoach.data.model.MobileHistoryExerciseDto
import org.sharteman.gymcoach.data.model.MobileHistoryProgramDto
import org.sharteman.gymcoach.data.model.MobileHistorySessionDto
import org.sharteman.gymcoach.data.model.MobileHistorySetDto
import org.sharteman.gymcoach.data.model.MobileHistorySnapshot
import org.sharteman.gymcoach.data.model.MobileLoadingRowDto
import org.sharteman.gymcoach.data.model.MobileProgressExerciseDto
import org.sharteman.gymcoach.data.model.MobileProgressPointDto
import org.sharteman.gymcoach.data.model.MobileProgressRecapDto
import org.sharteman.gymcoach.data.model.MobileProgressSnapshot
import org.sharteman.gymcoach.data.model.MobileVolumeLandmarkRowDto
import org.sharteman.gymcoach.data.model.MobileVolumeLandmarksDto
import org.sharteman.gymcoach.data.repository.HistoryProgressDataSource
import org.sharteman.gymcoach.data.offline.offlineJson
import org.sharteman.gymcoach.ui.theme.GymCoachTheme
import java.time.Instant
import java.time.YearMonth
import kotlinx.serialization.encodeToString

class HistoryProgressNativeTest {
    @get:Rule val compose = createComposeRule()

    @Test
    fun historyCalendarOpensFullDetailAndConfirmsDelete() {
        val source = FakeHistorySource(historySnapshot())
        compose.setContent {
            GymCoachTheme { HistoryScreen(onBack = {}, dataSource = source) }
        }

        compose.waitUntil(5_000) {
            compose.onAllNodesWithTag("history-session-session-1")
                .fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("history-session-session-1").performClick()
        compose.onNodeWithTag("history-session-detail").assertIsDisplayed()
        compose.onNodeWithTag("history-delete-session").performScrollTo().performClick()
        compose.onNodeWithTag("history-delete-confirm").performClick()
        compose.waitUntil(5_000) { source.deletedSessionId != null }

        assertEquals("session-1", source.deletedSessionId)
    }

    @Test
    fun finishedWorkoutUsesSharedEditorForEquipmentEditAddDeleteAndReload() {
        val source = FakeHistorySource(historySnapshot())
        val bootstrap = historyBootstrap()
        val originalFinishedAt = source.finishedAt
        val originalProgram = offlineJson.encodeToString<ProgramDto?>(bootstrap.activeProgram)
        var aggregateRefreshes = 0
        compose.setContent {
            GymCoachTheme {
                HistoryScreen(
                    onBack = {},
                    dataSource = source,
                    bootstrap = bootstrap,
                    onHistoricalMutation = { aggregateRefreshes++ },
                )
            }
        }

        compose.waitUntil(5_000) {
            compose.onAllNodesWithTag("history-session-session-1").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("history-session-session-1").performClick()
        compose.onNodeWithTag("strength-set-editor-finished_edit")
            .performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag("active-set-options").assertDoesNotExist()
        compose.onNodeWithTag("apply-set-recommendation").assertDoesNotExist()
        saveScreenshot("ihc-finished-shared-editor.png")

        compose.onNodeWithTag("completed-set-1-edit").performScrollTo().performClick()
        compose.onNodeWithTag("completed-set-set-equipment").performClick()
        compose.waitUntil(5_000) {
            compose.onAllNodesWithText("Cable B").fetchSemanticsNodes().size > 1
        }
        saveScreenshot("ihc-equipment-correction.png")
        compose.onAllNodesWithText("Cable B")[1].performClick()
        compose.onNodeWithTag("completed-set-1-save").performClick()
        compose.waitUntil(5_000) {
            source.updatedRequest?.equipmentSnapshotAction == "REPLACE"
        }
        assertEquals("equipment-b", source.updatedRequest?.gymEquipmentId)

        compose.onNodeWithTag("completed-set-1-edit").performScrollTo().performClick()
        compose.onNodeWithTag("completed-set-1-weight-editor").performClick()
        compose.onNodeWithTag("set-value-option-WEIGHT-30").performClick()
        compose.waitUntil(5_000) { source.updatedRequest?.weight == 30.0 }
        compose.onNodeWithTag("completed-set-1-edit").performScrollTo().performClick()
        compose.onNodeWithTag("completed-set-1-reps-editor").performClick()
        compose.onNodeWithTag("set-value-option-REPS-8").performClick()
        compose.waitUntil(5_000) { source.updatedRequest?.reps == 8 }
        compose.onNodeWithTag("completed-set-1-edit").performScrollTo().performClick()
        compose.onNodeWithTag("completed-set-1-rir-editor").performClick()
        compose.onNodeWithTag("set-value-option-RIR-3").performClick()
        compose.waitUntil(5_000) { source.updatedRequest?.rir == 3 }
        compose.onNodeWithTag("completed-set-1-weight").assertTextContains("30")
        compose.onNodeWithTag("completed-set-1-reps").assertTextContains("8")
        compose.onNodeWithTag("completed-set-1-rir").assertTextContains("3")
        compose.onNodeWithTag("history-strength-summary-pullup")
            .performScrollTo().assertTextContains("240", substring = true)

        compose.onNodeWithTag("active-set-confirm").performScrollTo().performClick()
        compose.waitUntil(5_000) { source.addedRequest != null }
        assertEquals("equipment-a", source.addedRequest?.gymEquipmentId)
        compose.onNodeWithTag("completed-set-2-edit").performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag("history-strength-summary-pullup")
            .performScrollTo().assertTextContains("300", substring = true)
        saveScreenshot("ihc-added-set.png")

        val back = InstrumentationRegistry.getInstrumentation().targetContext.getString(
            org.sharteman.gymcoach.R.string.previous,
        )
        compose.onNodeWithContentDescription(back).performClick()
        compose.onNodeWithTag("history-session-session-1").performClick()
        compose.onNodeWithTag("completed-set-2-edit").performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag("history-strength-summary-pullup")
            .performScrollTo().assertTextContains("300", substring = true)

        compose.onNodeWithTag("completed-set-1-delete").performScrollTo().performClick()
        compose.onNodeWithTag("finished-set-delete-confirm").assertIsDisplayed()
        saveScreenshot("ihc-delete-confirmation.png")
        compose.onNodeWithTag("finished-set-delete-confirm").performClick()
        compose.waitUntil(5_000) { source.deletedSetId == "set" }
        assertEquals(listOf(source.addedRequest?.id), source.setIds)
        assertEquals(originalFinishedAt, source.finishedAt)
        assertEquals(1, source.workingSets)
        assertEquals(60.0, source.volume, 0.0)
        assertEquals(12.0, source.estimated1RM, 0.0)
        assertEquals(originalProgram, offlineJson.encodeToString<ProgramDto?>(bootstrap.activeProgram))
        assertEquals(6, aggregateRefreshes)
        assertTrue(source.refreshCount >= 7)
    }

    @Test
    fun finishedWorkoutWithUnlinkedEquipmentUsesExplicitManualWeightFallback() {
        val source = FakeHistorySource(historySnapshot())
        val bootstrap = historyBootstrap().copy(
            gyms = listOf(
                GymDto(
                    id = "gym-1",
                    name = "History gym",
                    inventoryMode = "EQUIPMENT_FIRST",
                    equipment = emptyList(),
                    exerciseConfigs = emptyList(),
                ),
            ),
        )
        compose.setContent {
            GymCoachTheme {
                HistoryScreen(
                    onBack = {},
                    dataSource = source,
                    bootstrap = bootstrap,
                )
            }
        }

        compose.waitUntil(5_000) {
            compose.onAllNodesWithTag("history-session-session-1").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("history-session-session-1").performClick()
        compose.onNodeWithTag("active-weight-picker").performScrollTo().performClick()
        compose.onNodeWithTag("weight-picker-manual-fallback").assertIsDisplayed()
        compose.onNodeWithText(
            InstrumentationRegistry.getInstrumentation().targetContext.getString(
                R.string.weight_options_manual_fallback,
            ),
        ).assertIsDisplayed()
        saveScreenshot("y3n-finished-manual-fallback.png")

        repeat(2) { compose.onNodeWithTag("set-value-key-backspace").performClick() }
        compose.onNodeWithTag("set-value-key-2").performClick()
        compose.onNodeWithTag("set-value-key-7").performClick()
        compose.onNodeWithTag("set-value-key-decimal").performClick()
        compose.onNodeWithTag("set-value-key-5").performClick()
        compose.onNodeWithTag("set-value-apply").performClick()
        compose.onNodeWithTag("active-set-confirm").performScrollTo().performClick()
        compose.waitUntil(5_000) { source.addedRequest != null }

        assertEquals(27.5, source.addedRequest?.weight ?: 0.0, 0.001)
        assertEquals(null, source.addedRequest?.gymEquipmentId)
    }

    @Test
    fun failedFinishedEditKeepsTheSharedEditorAndPreviousRow() {
        val source = FakeHistorySource(historySnapshot()).apply { failNextMutation = true }
        compose.setContent {
            GymCoachTheme { HistoryScreen(onBack = {}, dataSource = source) }
        }

        compose.waitUntil(5_000) {
            compose.onAllNodesWithTag("history-session-session-1").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("history-session-session-1").performClick()
        compose.onNodeWithTag("completed-set-1-edit").performScrollTo().performClick()
        compose.onNodeWithTag("completed-set-1-save").performClick()
        compose.waitUntil(5_000) { source.failedMutationCount == 1 }
        compose.onNodeWithTag("completed-set-1-save").assertIsDisplayed()
        compose.onNodeWithText(
            InstrumentationRegistry.getInstrumentation().targetContext.getString(
                org.sharteman.gymcoach.R.string.history_edit_error,
            ),
        ).assertIsDisplayed()
    }

    @Test
    fun queuedFinishedEditRemainsVisibleWhenRemoteRefreshFails() {
        val source = FakeHistorySource(historySnapshot())
        compose.setContent {
            GymCoachTheme {
                HistoryScreen(
                    onBack = {},
                    dataSource = source,
                    bootstrap = historyBootstrap(),
                )
            }
        }

        compose.waitUntil(5_000) {
            compose.onAllNodesWithTag("history-session-session-1").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("history-session-session-1").performClick()
        source.failRefresh = true
        compose.onNodeWithTag("completed-set-1-edit").performScrollTo().performClick()
        compose.onNodeWithTag("completed-set-1-weight-editor").performClick()
        compose.onNodeWithTag("set-value-option-WEIGHT-20").performClick()

        compose.waitUntil(5_000) { source.updatedRequest?.weight == 20.0 }
        val aggregateRefreshError = InstrumentationRegistry.getInstrumentation().targetContext.getString(
            org.sharteman.gymcoach.R.string.history_aggregate_refresh_error,
        )
        compose.waitUntil(5_000) {
            compose.onAllNodesWithText(aggregateRefreshError).fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText(aggregateRefreshError).assertIsDisplayed()
        compose.waitUntil(5_000) {
            compose.onAllNodesWithTag("completed-set-1-weight").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("completed-set-1-weight").assertTextContains("20")
    }

    @Test
    fun progressShowsAllServerBackedDashboardBlocks() {
        compose.setContent {
            GymCoachTheme {
                ProgressScreen(
                    snapshot = progressSnapshot(),
                    unit = "KG",
                    refreshing = false,
                    onRefresh = {},
                    onBack = {},
                )
            }
        }

        listOf(
            "progress-deload-card",
            "progress-loading-table",
            "progress-goal-card",
            "progress-stalled-card",
            "progress-volume-landmarks",
            "progress-recap-card",
            "progress-records-card",
        ).forEach { tag ->
            compose.onNodeWithTag("progress-list").performScrollToNode(hasTestTag(tag))
            compose.onNodeWithTag(tag).assertIsDisplayed()
        }
    }

    @Test
    fun completedRecoveryBreakExplainsReturnAndHidesStartDeload() {
        compose.setContent {
            GymCoachTheme {
                ProgressScreen(
                    snapshot = progressSnapshot().copy(
                        deload = MobileDeloadStatusDto(
                            recommended = false,
                            state = "recovery-break-completed",
                            stalledExerciseNames = listOf("Bench Press", "Squat"),
                            averageReadiness = 4.0,
                            latestSleepQuality = 4,
                            daysSinceLastMeaningfulWorkout = 12.6,
                            recent7DayCompletedWorkouts = 0,
                            recent7DayWorkingSets = 0,
                            actualWeeklyFrequency28Days = 1.25,
                            plannedWeeklyFrequency = 3,
                            workingSetRatio = 0.2,
                            sessionFrequencyRatio = 0.2,
                        ),
                    ),
                    unit = "KG",
                    refreshing = false,
                    onRefresh = {},
                    onBack = {},
                )
            }
        }

        compose.onNodeWithTag("progress-list").performScrollToNode(
            hasTestTag("progress-deload-card"),
        )
        compose.onNodeWithTag("progress-recovery-break-explanation").assertIsDisplayed()
        compose.onAllNodesWithTag("progress-start-deload").assertCountEquals(0)
        saveScreenshot("deload-recovery-break-completed")
    }

    private fun saveScreenshot(name: String) {
        if (InstrumentationRegistry.getArguments().getString("captureScreenshots") != "true") return
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val values = ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, name)
            put(MediaStore.Images.Media.MIME_TYPE, "image/png")
            put(MediaStore.Images.Media.RELATIVE_PATH, "${Environment.DIRECTORY_PICTURES}/GymCoachTests")
        }
        val uri = requireNotNull(
            context.contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values),
        )
        context.contentResolver.openOutputStream(uri).use { output ->
            requireNotNull(output)
            InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
                .compress(Bitmap.CompressFormat.PNG, 100, output)
        }
    }

    private class FakeHistorySource(private var snapshot: MobileHistorySnapshot) : HistoryProgressDataSource {
        var deletedSessionId: String? = null
        var updatedRequest: HistoricalSetUpdateRequest? = null
        var addedRequest: HistoricalSetAddRequest? = null
        var deletedSetId: String? = null
        var failNextMutation: Boolean = false
        var failRefresh: Boolean = false
        var failedMutationCount: Int = 0
        var refreshCount: Int = 0
        val finishedAt: String get() = snapshot.sessions.single().finishedAt
        val setIds: List<String> get() = snapshot.sessions.single().exercises.single().sets.map { it.id }
        val workingSets: Int get() = snapshot.sessions.single().workingSets
        val volume: Double get() = snapshot.sessions.single().volume
        val estimated1RM: Double get() = snapshot.sessions.single().exercises.single().estimated1RM

        override suspend fun cachedHistory(month: String, programId: String?) = snapshot
        override suspend fun refreshHistory(month: String, programId: String?): MobileHistorySnapshot {
            refreshCount += 1
            if (failRefresh) error("offline")
            return snapshot
        }
        override suspend fun deleteHistorySession(sessionId: String) {
            deletedSessionId = sessionId
            snapshot = snapshot.copy(sessions = snapshot.sessions.filterNot { it.id == sessionId })
        }
        override suspend fun updateHistoricalSet(setId: String, request: HistoricalSetUpdateRequest) {
            if (failNextMutation) {
                failNextMutation = false
                failedMutationCount += 1
                error("offline")
            }
            updatedRequest = request
            snapshot = snapshot.mapStrengthSets { set ->
                if (set.id == setId) {
                    set.copy(
                        weight = request.weight,
                        effectiveWeight = request.weight,
                        reps = request.reps,
                        rir = request.rir,
                        gymEquipmentId = request.gymEquipmentId ?: set.gymEquipmentId,
                        equipmentNameSnapshot = if (request.gymEquipmentId == "equipment-b") {
                            "Cable B"
                        } else {
                            set.equipmentNameSnapshot
                        },
                        selectedLoadKg = request.weight,
                    )
                } else {
                    set
                }
            }
        }
        override suspend fun addHistoricalSet(sessionId: String, request: HistoricalSetAddRequest) {
            addedRequest = request
            val session = snapshot.sessions.single()
            val exercise = session.exercises.single()
            val added = MobileHistorySetDto(
                id = request.id,
                setNumber = (exercise.sets.maxOfOrNull { it.setNumber } ?: 0) + 1,
                weight = request.weight,
                effectiveWeight = request.weight,
                reps = request.reps,
                rir = request.rir,
                completedAt = session.finishedAt,
                gymEquipmentId = request.gymEquipmentId,
                equipmentNameSnapshot = "Cable A",
                selectedLoadKg = request.weight,
            )
            snapshot = snapshot.copy(
                sessions = listOf(
                    session.copy(
                        workingSets = session.workingSets + 1,
                        exercises = listOf(exercise.copy(sets = exercise.sets + added)),
                    ),
                ),
            ).recomputeStrengthTotals()
        }
        override suspend fun deleteHistoricalSet(setId: String) {
            deletedSetId = setId
            snapshot = snapshot.mapStrengthSets { set -> set.takeUnless { it.id == setId } }
        }
        override suspend fun saveGoal(exerciseId: String, targetWeightKg: Double, targetReps: Int) = Unit
        override suspend fun deleteGoal(goalId: String) = Unit
        override suspend fun saveVolumeTarget(muscleGroup: String, mev: Int, mrv: Int) = Unit
        override suspend fun clearVolumeTarget(muscleGroup: String) = Unit
        override suspend fun startDeload() = Unit
        override suspend fun endDeload() = Unit
    }

    private fun historySnapshot(): MobileHistorySnapshot {
        val now = Instant.now()
        return MobileHistorySnapshot(
            schemaVersion = 2,
            generatedAt = now.toString(),
            month = YearMonth.now().toString(),
            programs = listOf(MobileHistoryProgramDto("program", "Upper Lower")),
            hasAnyHistory = true,
            sessions = listOf(
            MobileHistorySessionDto(
                id = "session-1",
                programId = "program",
                programName = "Upper Lower",
                workoutName = "Upper",
                startedAt = now.toString(),
                finishedAt = now.plusSeconds(3_600).toString(),
                gymId = "gym-1",
                durationMin = 60,
                notes = "Strong session",
                sessionRpe = 7,
                workingSets = 1,
                volume = 480.0,
                exercises = listOf(
                    MobileHistoryExerciseDto(
                        id = "pullup",
                        name = "Pull-up",
                        muscleGroup = "BACK_WIDTH",
                        category = "COMPOUND",
                        usesBodyweight = true,
                        equipmentType = "CABLE",
                        volume = 480.0,
                        estimated1RM = 96.0,
                        sets = listOf(
                            MobileHistorySetDto(
                                id = "set",
                                setNumber = 1,
                                weight = 10.0,
                                effectiveWeight = 80.0,
                                reps = 6,
                                rir = 2,
                                completedAt = now.plusSeconds(600).toString(),
                                gymEquipmentId = "equipment-a",
                                equipmentNameSnapshot = "Cable A",
                                selectedLoadKg = 10.0,
                            ),
                        ),
                    ),
                ),
            ),
        ),
        )
    }

    private fun historyBootstrap() = BootstrapResponse(
        schemaVersion = 9,
        calculationVersion = "history-editor-test",
        serverTime = Instant.now().toString(),
        profile = ProfileDto(id = "user", email = "user@example.com", activeGymId = "gym-1"),
        activeProgram = ProgramDto(
            id = "program",
            name = "Upper Lower",
            phase = "Base",
            workouts = listOf(
                WorkoutDto(
                    id = "workout",
                    programId = "program",
                    name = "Upper",
                    order = 0,
                    exercises = listOf(
                        ProgramExerciseDto(
                            id = "program-exercise",
                            workoutId = "workout",
                            exerciseId = "pullup",
                            order = 0,
                            targetSets = 3,
                            targetRepsMin = 6,
                            targetRepsMax = 10,
                            targetRIR = 2,
                            restSec = 120,
                            exercise = ExerciseDto(
                                id = "pullup",
                                name = "Pull-up",
                                muscleGroup = "BACK_WIDTH",
                                category = "COMPOUND",
                                usesBodyweight = true,
                                equipmentType = "CABLE",
                            ),
                        ),
                    ),
                ),
            ),
        ),
        gyms = listOf(
            GymDto(
                id = "gym-1",
                name = "History gym",
                inventoryMode = "EQUIPMENT_FIRST",
                exerciseConfigs = listOf(
                    GymExerciseConfigDto(
                        id = "config",
                        gymId = "gym-1",
                        exerciseId = "pullup",
                        preferredEquipmentId = "equipment-a",
                    ),
                ),
                equipment = listOf(
                    historyEquipment("equipment-a", "Cable A", listOf(10.0, 20.0, 30.0)),
                    historyEquipment("equipment-b", "Cable B", listOf(20.0, 30.0, 40.0)),
                ),
            ),
        ),
    )

    private fun historyEquipment(id: String, name: String, weights: List<Double>) = GymEquipmentDto(
        id = id,
        gymId = "gym-1",
        name = name,
        equipmentType = "CABLE",
        loadType = "SELECTORIZED",
        weightOptions = weights,
        exerciseLinks = listOf(GymEquipmentExerciseDto(id, "pullup")),
    )

    private fun progressSnapshot() = MobileProgressSnapshot(
        schemaVersion = 3,
        generatedAt = "2026-07-14T10:00:00.000Z",
        unit = "KG",
        exercises = listOf(
            MobileProgressExerciseDto(
                id = "bench",
                name = "Bench Press",
                muscleGroup = "CHEST",
                points = listOf(
                    MobileProgressPointDto(
                        sessionStartedAt = "2026-07-01T10:00:00.000Z",
                        maxWeight = 100.0,
                        estimated1RM = 116.7,
                        totalVolume = 500.0,
                        topSetReps = 5,
                        maxReps = 5,
                        totalReps = 5,
                    ),
                ),
                bestEstimated1RM = 116.7,
                loadingTable = listOf(MobileLoadingRowDto(80, 92.5)),
                recap = MobileProgressRecapDto(
                    sessions = 3,
                    firstWeight = 95.0,
                    lastWeight = 100.0,
                    estimated1RMDelta = 5.0,
                    stalled = true,
                ),
            ),
        ),
        volumeLandmarks = MobileVolumeLandmarksDto(
            weekKey = "2026-W28",
            defaultMev = 10,
            defaultMrv = 20,
            rows = listOf(
                MobileVolumeLandmarkRowDto("CHEST", 12, 2, "WITHIN", 10, 20, false),
            ),
        ),
        records = listOf(
            MobileExerciseRecordDto("Bench Press", 100.0, 5, "2026-07-01", 116.7, "2026-07-01"),
        ),
        deload = MobileDeloadStatusDto(
            recommended = true,
            state = "planned-deload",
            stalledExerciseNames = listOf("Bench Press", "Squat"),
        ),
    )
}

private fun MobileHistorySnapshot.mapStrengthSets(
    transform: (MobileHistorySetDto) -> MobileHistorySetDto?,
): MobileHistorySnapshot = copy(
    sessions = sessions.map { session ->
        session.copy(
            exercises = session.exercises.map { exercise ->
                exercise.copy(sets = exercise.sets.mapNotNull(transform))
            },
        )
    },
).recomputeStrengthTotals()

private fun MobileHistorySnapshot.recomputeStrengthTotals(): MobileHistorySnapshot = copy(
    sessions = sessions.map { session ->
        val exercises = session.exercises.map { exercise ->
            val working = exercise.sets.filterNot { it.isWarmup }
            exercise.copy(
                volume = working.sumOf { it.effectiveWeight * it.reps },
                estimated1RM = working.maxOfOrNull {
                    it.effectiveWeight * (1.0 + it.reps / 30.0)
                } ?: 0.0,
            )
        }
        session.copy(
            exercises = exercises,
            workingSets = exercises.sumOf { exercise ->
                exercise.sets.count { !it.isWarmup }
            },
            volume = exercises.sumOf { it.volume },
        )
    },
)
