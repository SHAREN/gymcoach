package org.sharteman.gymcoach.ui

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToNode
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.sharteman.gymcoach.data.model.MobileDeloadStatusDto
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
import org.sharteman.gymcoach.ui.theme.GymCoachTheme
import java.time.Instant
import java.time.YearMonth

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

    private class FakeHistorySource(private var snapshot: MobileHistorySnapshot) : HistoryProgressDataSource {
        var deletedSessionId: String? = null

        override fun cachedHistory(month: String, programId: String?) = snapshot
        override suspend fun refreshHistory(month: String, programId: String?) = snapshot
        override suspend fun deleteHistorySession(sessionId: String) {
            deletedSessionId = sessionId
            snapshot = snapshot.copy(sessions = snapshot.sessions.filterNot { it.id == sessionId })
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
            schemaVersion = 1,
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
                            ),
                        ),
                    ),
                ),
            ),
        ),
        )
    }

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
            stalledExerciseNames = listOf("Bench Press", "Squat"),
        ),
    )
}
