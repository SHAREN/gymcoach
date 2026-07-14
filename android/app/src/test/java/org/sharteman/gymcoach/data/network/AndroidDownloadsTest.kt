package org.sharteman.gymcoach.data.network

import org.junit.Assert.assertEquals
import org.junit.Test

class AndroidDownloadsTest {
    @Test
    fun `uses the configured server origin`() {
        assertEquals(
            "https://gymcoach.example/api/android/download",
            androidDownloadUrl("https://gymcoach.example/"),
        )
        assertEquals(
            "http://192.168.0.119:3030/api/android/download",
            androidDownloadUrl("http://192.168.0.119:3030"),
        )
    }
}
