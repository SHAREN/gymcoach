package org.sharteman.gymcoach.watch.transport

import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class HuaweiWearEngineSdkClientTest {
    @Test
    fun `owned send timeout becomes an SDK failure`() = runTest {
        val error = runCatching {
            withWearEngineSendTimeout(1) { awaitCancellation() }
        }.exceptionOrNull()

        assertTrue(error is HuaweiWearEngineClientException)
        assertEquals(
            HuaweiWearEngineFailure.SDK_FAILURE,
            (error as HuaweiWearEngineClientException).failure,
        )
        assertTrue(error.cause is TimeoutCancellationException)
    }

    @Test
    fun `parent timeout remains coroutine cancellation`() = runTest {
        val error = runCatching {
            withTimeout(1) {
                withWearEngineSendTimeout(60_000) { awaitCancellation() }
            }
        }.exceptionOrNull()

        assertTrue(error is TimeoutCancellationException)
        assertTrue(error !is HuaweiWearEngineClientException)
    }
}
