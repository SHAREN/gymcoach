package org.sharteman.gymcoach.data.network

import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.sharteman.gymcoach.data.model.HistoricalSetAddRequest
import org.sharteman.gymcoach.data.model.HistoricalSetUpdateRequest

class HistoryProgressApiClientTest {
    private lateinit var server: MockWebServer
    private lateinit var api: HistoryProgressApiClient

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        api = HistoryProgressApiClient()
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    @Test
    fun `finished set mutations use historical routes and stable client id`() = runTest {
        repeat(4) { server.enqueue(MockResponse().setResponseCode(200).setBody("{}")) }
        val baseUrl = server.url("/").toString()

        api.updateHistoricalSet(
            baseUrl,
            "token-1",
            "set-1",
            HistoricalSetUpdateRequest(
                weight = 30.0,
                reps = 10,
                rir = 2,
                gymEquipmentId = "equipment-b",
                equipmentSnapshotAction = "REPLACE",
            ),
        )
        api.updateHistoricalSet(
            baseUrl,
            "token-1",
            "set-frozen",
            HistoricalSetUpdateRequest(weight = 25.0, reps = 11, rir = 1),
        )
        api.addHistoricalSet(
            baseUrl,
            "token-1",
            "session-1",
            HistoricalSetAddRequest(
                id = "mob_set_retry_1",
                exerciseId = "exercise-1",
                gymEquipmentId = "equipment-b",
                weight = 30.0,
                reps = 10,
                rir = 2,
            ),
        )
        api.deleteHistoricalSet(baseUrl, "token-1", "set-1")

        val update = server.takeRequest()
        assertEquals("PATCH", update.method)
        assertEquals("/api/sets/set-1", update.path)
        assertEquals("Bearer token-1", update.getHeader("Authorization"))
        assertTrue(update.body.readUtf8().contains("\"equipmentSnapshotAction\":\"REPLACE\""))

        val preserve = server.takeRequest()
        assertEquals("PATCH", preserve.method)
        val preserveBody = preserve.body.readUtf8()
        assertTrue(!preserveBody.contains("gymEquipmentId"))
        assertTrue(!preserveBody.contains("equipmentSnapshotAction"))

        val add = server.takeRequest()
        assertEquals("POST", add.method)
        assertEquals("/api/sessions/session-1/historical-sets", add.path)
        assertTrue(add.body.readUtf8().contains("\"id\":\"mob_set_retry_1\""))

        val delete = server.takeRequest()
        assertEquals("DELETE", delete.method)
        assertEquals("/api/sets/set-1", delete.path)
    }
}
