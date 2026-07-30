package org.sharteman.gymcoach.data.repository

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.sharteman.gymcoach.data.local.LocalSessionEntity
import org.sharteman.gymcoach.data.local.LocalSetEntity
import org.sharteman.gymcoach.data.model.BootstrapResponse
import org.sharteman.gymcoach.data.model.ExerciseHistorySessionDto
import org.sharteman.gymcoach.data.model.ExerciseHistorySetDto
import org.sharteman.gymcoach.data.model.ProfileDto

class ExerciseHistoryMergeTest {
    @Test
    fun mergesFinishedStrengthAndCardioHistoryWithoutDuplicates() {
        val serverHistory = ExerciseHistorySessionDto(
            sessionId = "session-local",
            startedAt = "2026-07-14T08:00:00Z",
            sets = listOf(ExerciseHistorySetDto(1, 70.0, 8)),
        )
        val bootstrap = bootstrap(
            mapOf(
                "bench" to listOf(serverHistory),
                "deleted-exercise" to listOf(
                    ExerciseHistorySessionDto("session-deleted", "2026-07-13T08:00:00Z"),
                ),
            ),
        )
        val session = session("session-local", "2026-07-14T08:00:00Z", gymId = "gym-1")
        val merged = mergeLocalExerciseHistory(
            bootstrap,
            sessions = listOf(
                session to listOf(
                    set(
                        "working",
                        session.id,
                        "bench",
                        2,
                        weight = 80.0,
                        reps = 6,
                        rir = 1,
                        gymEquipmentId = "bar-a",
                        equipmentNameSnapshot = "Olympic bar",
                    ),
                    set("warmup", session.id, "bench", 1, weight = 20.0, reps = 10, isWarmup = true),
                    set(
                        "cardio",
                        session.id,
                        "running",
                        1,
                        durationSec = 3_907,
                        distanceM = 5_000.0,
                        avgHr = 142,
                        maxHr = 166,
                    ),
                    set("removed", session.id, "bench", 3, weight = 60.0, reps = 10, deleted = true),
                ),
            ),
            deletedSessionIds = setOf("session-deleted"),
        )

        assertEquals(1, merged.exerciseHistoryByExerciseId.getValue("bench").size)
        assertTrue(merged.exerciseHistoryByExerciseId.getValue("bench").single().localOnly)
        val bench = merged.exerciseHistoryByExerciseId.getValue("bench").single()
        assertEquals("gym-1", bench.gymId)
        assertEquals(80.0, bench.sets.single().weight, 0.0)
        assertEquals("bar-a", bench.sets.single().gymEquipmentId)
        assertEquals("Olympic bar", bench.sets.single().equipmentName)
        val cardio = merged.exerciseHistoryByExerciseId.getValue("running")[0].sets.single()
        assertEquals(3_907, cardio.durationSec)
        assertEquals(5_000.0, cardio.distanceM!!, 0.0)
        assertEquals(142, cardio.avgHr)
        assertEquals(166, cardio.maxHr)
        assertFalse(merged.exerciseHistoryByExerciseId.containsKey("deleted-exercise"))
    }

    @Test
    fun ignoresOpenSessionsAndKeepsOnlyTwelveNewestSessions() {
        val histories = (1..12).map { day ->
            ExerciseHistorySessionDto(
                sessionId = "server-$day",
                startedAt = "2026-06-${day.toString().padStart(2, '0')}T08:00:00Z",
            )
        }
        val open = session("open", "2026-07-15T08:00:00Z", finished = false)
        val newest = session("newest", "2026-07-14T08:00:00Z")

        val merged = mergeLocalExerciseHistory(
            bootstrap(mapOf("bench" to histories)),
            sessions = listOf(
                open to listOf(set("open-set", open.id, "bench", 1)),
                newest to listOf(set("new-set", newest.id, "bench", 1)),
            ),
        )

        val result = merged.exerciseHistoryByExerciseId.getValue("bench")
        assertEquals(12, result.size)
        assertEquals("newest", result.first().sessionId)
        assertTrue(result.none { it.sessionId == "open" })
        assertTrue(result.none { it.sessionId == "server-1" })
    }

    private fun bootstrap(history: Map<String, List<ExerciseHistorySessionDto>>) = BootstrapResponse(
        schemaVersion = 3,
        calculationVersion = "test",
        serverTime = "2026-07-15T00:00:00Z",
        profile = ProfileDto(id = "user", email = "test@example.com"),
        exerciseHistoryByExerciseId = history,
    )

    private fun session(
        id: String,
        startedAt: String,
        finished: Boolean = true,
        gymId: String? = null,
    ) = LocalSessionEntity(
        id = id,
        workoutId = "workout",
        gymId = gymId,
        startedAt = startedAt,
        finishedAt = if (finished) "2026-07-15T09:00:00Z" else null,
    )

    private fun set(
        id: String,
        sessionId: String,
        exerciseId: String,
        setNumber: Int,
        weight: Double = 0.0,
        reps: Int = 1,
        rir: Int? = null,
        durationSec: Int? = null,
        distanceM: Double? = null,
        avgHr: Int? = null,
        maxHr: Int? = null,
        isWarmup: Boolean = false,
        deleted: Boolean = false,
        gymEquipmentId: String? = null,
        equipmentNameSnapshot: String? = null,
    ) = LocalSetEntity(
        id = id,
        sessionId = sessionId,
        exerciseId = exerciseId,
        gymEquipmentId = gymEquipmentId,
        equipmentNameSnapshot = equipmentNameSnapshot,
        setNumber = setNumber,
        weight = weight,
        reps = reps,
        rir = rir,
        durationSec = durationSec,
        distanceM = distanceM,
        avgHr = avgHr,
        maxHr = maxHr,
        isWarmup = isWarmup,
        completedAt = "2026-07-15T08:30:00Z",
        deleted = deleted,
    )
}
