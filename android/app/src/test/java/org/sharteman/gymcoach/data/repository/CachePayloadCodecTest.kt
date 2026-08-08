package org.sharteman.gymcoach.data.repository

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertNotEquals
import org.junit.Test

class CachePayloadCodecTest {
    @Test
    fun `cache serialization leaves the caller thread`() = runBlocking {
        val callerThread = Thread.currentThread().name

        val codecThread = runCachePayloadCodec { Thread.currentThread().name }

        assertNotEquals(callerThread, codecThread)
    }
}
