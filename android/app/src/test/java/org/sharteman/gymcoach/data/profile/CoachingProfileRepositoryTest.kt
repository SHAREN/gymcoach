package org.sharteman.gymcoach.data.profile

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.sharteman.gymcoach.data.model.CoachingFieldDto
import org.sharteman.gymcoach.data.model.CoachingFieldInput
import org.sharteman.gymcoach.data.model.CoachingFieldState
import org.sharteman.gymcoach.data.model.CoachingHealthStatus
import org.sharteman.gymcoach.data.model.CoachingProfileDto
import org.sharteman.gymcoach.data.model.CoachingProfilePatchInput
import org.sharteman.gymcoach.data.settings.CoachingProfileRemoteDataSource
import org.sharteman.gymcoach.data.settings.SettingsErrorKind
import org.sharteman.gymcoach.data.settings.SettingsException
import org.sharteman.gymcoach.data.settings.SettingsProfileDto

class CoachingProfileRepositoryTest {
    @Test
    fun `response loss retry recognizes already applied value without rewriting timestamp`() = runTest {
        val store = FakePendingStore()
        val remote = FakeRemote(baseProfile())
        remote.failAfterApply = SettingsException(SettingsErrorKind.TIMEOUT)
        val repository = CoachingProfileRepository(remote, store)
        val patch = CoachingProfilePatchInput(
            healthStatus = CoachingFieldInput(
                CoachingFieldState.KNOWN,
                CoachingHealthStatus.TRAIN_WITH_LIMITATIONS,
            ),
        )

        val queued = repository.save(remote.profile, patch)
        val appliedTimestamp = remote.profile.healthStatus.updatedAt
        remote.failAfterApply = null
        val retried = repository.retryPending(queued.profile)

        assertTrue(queued.pending)
        assertFalse(retried.pending)
        assertEquals(1, remote.saveCalls)
        assertEquals(appliedTimestamp, retried.profile.healthStatus.updatedAt)
        assertEquals("TRAIN_WITH_LIMITATIONS", retried.profile.healthStatus.value)
        assertEquals(null, store.read())
    }

    @Test
    fun `newer server field wins over stale offline patch`() = runTest {
        val store = FakePendingStore()
        val remote = FakeRemote(baseProfile()).apply {
            loadFailure = SettingsException(SettingsErrorKind.DNS)
        }
        val repository = CoachingProfileRepository(remote, store)
        val patch = CoachingProfilePatchInput(
            healthStatus = CoachingFieldInput(
                CoachingFieldState.KNOWN,
                CoachingHealthStatus.TRAIN_WITH_LIMITATIONS,
            ),
        )

        val queued = repository.save(remote.profile, patch)
        remote.loadFailure = null
        remote.profile = remote.profile.copy(
            updatedAt = T3,
            healthStatus = CoachingFieldDto(
                state = "KNOWN",
                value = "MEDICAL_CLEARANCE_REQUIRED",
                updatedAt = T3,
            ),
        )
        val retried = repository.retryPending(queued.profile)

        assertEquals(setOf("healthStatus"), retried.conflictedFields)
        assertEquals("MEDICAL_CLEARANCE_REQUIRED", retried.profile.healthStatus.value)
        assertEquals(0, remote.saveCalls)
        assertEquals(null, store.read())
    }

    @Test
    fun `pending sections merge and survive repository restart`() = runTest {
        val store = FakePendingStore()
        val remote = FakeRemote(baseProfile()).apply {
            loadFailure = SettingsException(SettingsErrorKind.SERVER_UNAVAILABLE)
        }
        val firstProcess = CoachingProfileRepository(remote, store)
        val safety = firstProcess.save(
            remote.profile,
            CoachingProfilePatchInput(
                healthStatus = CoachingFieldInput(
                    CoachingFieldState.KNOWN,
                    CoachingHealthStatus.NO_SIGNIFICANT_ISSUES,
                ),
            ),
        )
        val restarted = CoachingProfileRepository(remote, store)
        val recovery = restarted.save(
            safety.profile,
            CoachingProfilePatchInput(
                generalRecovery = CoachingFieldInput(CoachingFieldState.KNOWN, 4),
            ),
        )

        assertTrue(recovery.pending)
        assertEquals(setOf("healthStatus", "generalRecovery"), store.read()?.patch?.fieldNames())

        remote.loadFailure = null
        val synced = restarted.retryPending(recovery.profile)

        assertFalse(synced.pending)
        assertEquals("NO_SIGNIFICANT_ISSUES", synced.profile.healthStatus.value)
        assertEquals(4, synced.profile.generalRecovery.value)
        assertEquals(1, remote.saveCalls)
    }

    @Test
    fun `non retryable rejection clears poisoned pending update`() = runTest {
        val store = FakePendingStore()
        val remote = FakeRemote(baseProfile()).apply {
            saveFailureBeforeApply = SettingsException(SettingsErrorKind.INVALID_DATA, statusCode = 400)
        }
        val repository = CoachingProfileRepository(remote, store)

        val failure = runCatching {
            repository.save(
                remote.profile,
                CoachingProfilePatchInput(
                    generalRecovery = CoachingFieldInput(CoachingFieldState.KNOWN, 4),
                ),
            )
        }.exceptionOrNull()

        assertTrue(failure is SettingsException)
        assertEquals(null, store.read())
    }

    @Test
    fun `retry without pending update refreshes authoritative server timestamps`() = runTest {
        val remote = FakeRemote(baseProfile())
        val repository = CoachingProfileRepository(remote, FakePendingStore())
        remote.profile = remote.profile.copy(
            updatedAt = T3,
            generalRecovery = CoachingFieldDto("KNOWN", 5, T3),
        )

        val result = repository.retryPending(baseProfile())

        assertEquals(T3, result.profile.updatedAt)
        assertEquals(5, result.profile.generalRecovery.value)
        assertEquals(1, remote.loadCalls)
    }

    @Test
    fun `pending storage key is isolated by both account and primary server`() {
        val first = coachingProfileOwnerKey("user-1", "https://first.example")

        assertEquals(first, coachingProfileOwnerKey("user-1", "https://first.example/"))
        assertTrue(first != coachingProfileOwnerKey("user-1", "https://second.example"))
        assertTrue(first != coachingProfileOwnerKey("user-2", "https://first.example"))
    }

    private class FakePendingStore : CoachingProfilePendingStore {
        private var value: PendingCoachingProfilePatch? = null
        override fun read() = value
        override fun write(value: PendingCoachingProfilePatch) {
            this.value = value
        }
        override fun clear() {
            value = null
        }
    }

    private class FakeRemote(
        var profile: CoachingProfileDto,
    ) : CoachingProfileRemoteDataSource {
        var loadFailure: SettingsException? = null
        var saveFailureBeforeApply: SettingsException? = null
        var failAfterApply: SettingsException? = null
        var loadCalls = 0
        var saveCalls = 0

        override suspend fun loadProfile(): SettingsProfileDto {
            loadCalls += 1
            loadFailure?.let { throw it }
            return SettingsProfileDto(email = "private@example.test", coachingProfile = profile)
        }

        override suspend fun saveCoachingProfile(input: CoachingProfilePatchInput): SettingsProfileDto {
            saveCalls += 1
            saveFailureBeforeApply?.let { throw it }
            profile = profile.copy(
                updatedAt = T2,
                healthStatus = input.healthStatus?.let { field ->
                    CoachingFieldDto(
                        state = field.state.name,
                        value = field.value?.name,
                        updatedAt = T2,
                    )
                } ?: profile.healthStatus,
                generalRecovery = input.generalRecovery?.let { field ->
                    CoachingFieldDto(
                        state = field.state.name,
                        value = field.value,
                        updatedAt = T2,
                    )
                } ?: profile.generalRecovery,
            )
            failAfterApply?.let { throw it }
            return SettingsProfileDto(email = "private@example.test", coachingProfile = profile)
        }
    }

    private fun baseProfile() = CoachingProfileDto(
        updatedAt = T1,
        healthStatus = CoachingFieldDto(updatedAt = T1),
        generalRecovery = CoachingFieldDto(updatedAt = T1),
    )

    private companion object {
        const val T1 = "2026-07-18T10:00:00.000Z"
        const val T2 = "2026-07-18T11:00:00.000Z"
        const val T3 = "2026-07-18T12:00:00.000Z"
    }
}
