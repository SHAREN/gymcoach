package org.sharteman.gymcoach.data.repository

import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.sharteman.gymcoach.data.local.GymCoachDatabase
import org.sharteman.gymcoach.data.model.HistoricalSetAddRequest
import org.sharteman.gymcoach.data.model.HistoricalSetUpdateRequest
import org.sharteman.gymcoach.data.model.MobileHistoryExerciseDto
import org.sharteman.gymcoach.data.model.MobileHistorySessionDto
import org.sharteman.gymcoach.data.model.MobileHistorySetDto
import org.sharteman.gymcoach.data.model.MobileHistorySnapshot
import org.sharteman.gymcoach.data.offline.AddHistoricalSetMutation
import org.sharteman.gymcoach.data.offline.DeleteHistoricalSetMutation
import org.sharteman.gymcoach.data.offline.NetworkStatus
import org.sharteman.gymcoach.data.offline.OFFLINE_DOMAIN_HISTORY
import org.sharteman.gymcoach.data.offline.RoomOfflinePersistence
import org.sharteman.gymcoach.data.offline.UpdateHistoricalSetMutation
import org.sharteman.gymcoach.data.offline.accountKey
import org.sharteman.gymcoach.data.offline.applyHistoryMutation
import org.sharteman.gymcoach.data.offline.historyCacheKey
import org.sharteman.gymcoach.data.offline.offlineJson
import org.sharteman.gymcoach.data.security.AccountStore

class HistoryProgressRepositoryInstrumentedTest {
    @Test
    fun finishedMutationsPersistOfflineAndRebuildHistoryAfterRepositoryRestart() = runBlocking {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val database = Room.inMemoryDatabaseBuilder(context, GymCoachDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        try {
            val accountStore = FakeAccountStore()
            val persistence = RoomOfflinePersistence(database.offlineDao())
            val key = accountKey(accountStore.primaryServerUrl, requireNotNull(accountStore.userId))
            val cacheKey = historyCacheKey(key, MONTH, null)
            val base = historySnapshot()
            val preserved = applyHistoryMutation(
                base,
                UpdateHistoricalSetMutation(
                    operationId = "op-preserve",
                    setId = "set-1",
                    sessionId = SESSION_ID,
                    exerciseId = EXERCISE_ID,
                    request = HistoricalSetUpdateRequest(weight = 25.0, reps = 9, rir = 1),
                ),
            ).sessions.single().exercises.single().sets.single()
            assertEquals("equipment-a", preserved.gymEquipmentId)
            assertEquals("Cable A", preserved.equipmentNameSnapshot)
            assertEquals(0.5, preserved.selectedLoadMultiplierSnapshot ?: 0.0, 0.0)
            assertEquals(12.5, preserved.nominalResistanceKg ?: 0.0, 0.0)
            assertTrue(preserved.equipmentLoadSnapshot.toString().contains("25.0"))
            persistence.saveCache(
                key,
                OFFLINE_DOMAIN_HISTORY,
                cacheKey,
                offlineJson.encodeToString(base),
            )
            var schedules = 0
            val repository = HistoryProgressRepository(
                context = context,
                accountStore = accountStore,
                offlinePersistence = persistence,
                networkStatus = NetworkStatus { false },
                scheduleSync = { schedules++ },
            )

            repository.updateHistoricalSet(
                "set-1",
                HistoricalSetUpdateRequest(
                    weight = 30.0,
                    reps = 8,
                    rir = 1,
                    gymEquipmentId = "equipment-b",
                    equipmentSnapshotAction = "REPLACE",
                ),
            )
            val updated = requireNotNull(repository.cachedHistory(MONTH, null))
            val updatedSet = updated.sessions.single().exercises.single().sets.single()
            assertEquals(30.0, updatedSet.weight, 0.0)
            assertEquals(8, updatedSet.reps)
            assertEquals(1, updatedSet.rir)
            assertEquals("equipment-b", updatedSet.gymEquipmentId)
            assertEquals(null, updatedSet.equipmentNameSnapshot)
            assertEquals(null, updatedSet.selectedLoadMultiplierSnapshot)
            assertEquals(null, updatedSet.nominalResistanceKg)
            assertEquals(null, updatedSet.equipmentLoadSnapshot)
            assertEquals(240.0, updated.sessions.single().volume, 0.0)
            assertEquals(38.0, updated.sessions.single().exercises.single().estimated1RM, 0.0)

            repository.addHistoricalSet(
                SESSION_ID,
                HistoricalSetAddRequest(
                    id = "set-2",
                    exerciseId = EXERCISE_ID,
                    gymEquipmentId = "equipment-a",
                    weight = 20.0,
                    reps = 10,
                    rir = 2,
                ),
            )
            repository.deleteHistoricalSet("set-1")

            val restarted = HistoryProgressRepository(
                context = context,
                accountStore = accountStore,
                offlinePersistence = persistence,
                networkStatus = NetworkStatus { false },
                scheduleSync = { schedules++ },
            )
            val reloaded = requireNotNull(restarted.cachedHistory(MONTH, null))
            val session = reloaded.sessions.single()
            assertEquals(FINISHED_AT, session.finishedAt)
            assertEquals(listOf("set-2"), session.exercises.single().sets.map { it.id })
            assertEquals(1, session.workingSets)
            assertEquals(200.0, session.volume, 0.0)
            assertEquals(26.7, session.exercises.single().estimated1RM, 0.0)
            assertEquals(
                listOf(
                    UpdateHistoricalSetMutation::class,
                    AddHistoricalSetMutation::class,
                    DeleteHistoricalSetMutation::class,
                ),
                persistence.operations(key).map { it.mutation::class },
            )
            assertTrue(restarted.hasPendingHistoricalChanges())
            assertTrue(database.dao().queuedOperations().isEmpty())
            assertTrue(schedules >= 3)
        } finally {
            database.close()
        }
    }

    private fun historySnapshot() = MobileHistorySnapshot(
        schemaVersion = 2,
        generatedAt = "2026-08-08T10:00:00Z",
        month = MONTH,
        sessions = listOf(
            MobileHistorySessionDto(
                id = SESSION_ID,
                startedAt = "2026-08-08T09:00:00Z",
                finishedAt = FINISHED_AT,
                durationMin = 60,
                workingSets = 1,
                volume = 200.0,
                exercises = listOf(
                    MobileHistoryExerciseDto(
                        id = EXERCISE_ID,
                        name = "Cable press",
                        muscleGroup = "TRICEPS",
                        category = "ISOLATION",
                        equipmentType = "CABLE",
                        volume = 200.0,
                        estimated1RM = 26.7,
                        sets = listOf(
                            MobileHistorySetDto(
                                id = "set-1",
                                setNumber = 1,
                                weight = 20.0,
                                effectiveWeight = 20.0,
                                reps = 10,
                                rir = 2,
                                completedAt = FINISHED_AT,
                                gymEquipmentId = "equipment-a",
                                equipmentNameSnapshot = "Cable A",
                                selectedLoadKg = 20.0,
                                selectedLoadMultiplierSnapshot = 0.5,
                                nominalResistanceKg = 10.0,
                                equipmentLoadSnapshot = Json.parseToJsonElement(
                                    """{"version":2,"loadType":"SELECTORIZED","selectedLoadKg":20.0,"nominalResistanceKg":10.0}""",
                                ),
                            ),
                        ),
                    ),
                ),
            ),
        ),
        hasAnyHistory = true,
    )

    private class FakeAccountStore : AccountStore {
        override val deviceId = "history-test-device"
        override var serverUrl = "https://gym.example"
        override var userId: String? = "history-test-user"
        override var userEmail: String? = "history-test@example.com"
        override fun getAccessToken() = "gma_history_test"
        override fun setAccessToken(token: String) = Unit
        override fun clearAccessToken() = Unit
        override fun clearAccount() = Unit
    }

    private companion object {
        const val MONTH = "2026-08"
        const val SESSION_ID = "session-1"
        const val EXERCISE_ID = "exercise-1"
        const val FINISHED_AT = "2026-08-08T10:00:00Z"
    }
}
