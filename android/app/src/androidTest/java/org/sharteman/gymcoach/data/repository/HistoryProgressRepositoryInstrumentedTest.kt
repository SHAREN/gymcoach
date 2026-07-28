package org.sharteman.gymcoach.data.repository

import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertTrue
import org.junit.Test
import org.sharteman.gymcoach.data.model.HistoricalSetAddRequest
import org.sharteman.gymcoach.data.model.HistoricalSetUpdateRequest
import org.sharteman.gymcoach.data.offline.NetworkStatus
import org.sharteman.gymcoach.data.security.AccountStore

class HistoryProgressRepositoryInstrumentedTest {
    @Test
    fun finishedMutationsFailOfflineWithoutEnteringTheActiveOutbox() = runBlocking {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val repository = HistoryProgressRepository(
            context = context,
            accountStore = FakeAccountStore(),
            offlinePersistence = null,
            networkStatus = NetworkStatus { false },
        )

        val failures = listOf(
            runCatching {
                repository.updateHistoricalSet(
                    "set-1",
                    HistoricalSetUpdateRequest(weight = 30.0, reps = 10, rir = 2),
                )
            }.exceptionOrNull(),
            runCatching {
                repository.addHistoricalSet(
                    "session-1",
                    HistoricalSetAddRequest(
                        id = "mob_set_offline_1",
                        exerciseId = "exercise-1",
                        weight = 30.0,
                        reps = 10,
                        rir = 2,
                    ),
                )
            }.exceptionOrNull(),
            runCatching { repository.deleteHistoricalSet("set-1") }.exceptionOrNull(),
        )

        assertTrue(failures.all { it is HistoryOfflineMutationException })
    }

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
}
