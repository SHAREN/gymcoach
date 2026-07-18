package org.sharteman.gymcoach.data.settings

import java.net.SocketTimeoutException
import java.net.UnknownHostException
import javax.net.ssl.SSLHandshakeException
import kotlinx.coroutines.test.runTest
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SettingsApiTest {
    @Test
    fun `maps actionable HTTP update errors`() {
        assertEquals(SettingsErrorKind.AUTHENTICATION, settingsErrorKindForStatus(401))
        assertEquals(SettingsErrorKind.NOT_FOUND, settingsErrorKindForStatus(404))
        assertEquals(SettingsErrorKind.BAD_GATEWAY, settingsErrorKindForStatus(502))
        assertEquals(SettingsErrorKind.SERVER_UNAVAILABLE, settingsErrorKindForStatus(503))
        assertEquals(SettingsErrorKind.RATE_LIMIT, settingsErrorKindForStatus(429))
    }

    @Test
    fun `maps DNS timeout and TLS failures separately`() {
        assertEquals(SettingsErrorKind.DNS, classifySettingsError(UnknownHostException()))
        assertEquals(SettingsErrorKind.TIMEOUT, classifySettingsError(SocketTimeoutException()))
        assertEquals(SettingsErrorKind.TLS, classifySettingsError(SSLHandshakeException("certificate")))
    }

    @Test
    fun `system profile writes use authoritative PUT routes and stable retry bodies`() = runTest {
        val requests = mutableListOf<Pair<String, String>>()
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request()
            val buffer = Buffer()
            request.body?.writeTo(buffer)
            requests += request.url.encodedPath to buffer.readUtf8()
            val responseBody = if (request.url.encodedPath == "/api/gyms/gym-1") {
                """{"id":"gym-1","name":"Renamed"}"""
            } else {
                "{}"
            }
            Response.Builder()
                .request(request)
                .protocol(Protocol.HTTP_1_1)
                .code(200)
                .message("OK")
                .body(responseBody.toResponseBody("application/json".toMediaType()))
                .build()
        }.build()
        val api = SettingsApi("https://example.test", "token", client)
        val dumbbells = SettingsDumbbellsSystemProfileInput(
            weightsKg = listOf(10.0, 12.5),
            exerciseIds = listOf("exercise-1"),
        )
        val barbell = SettingsBarbellSystemProfileInput(
            exerciseIds = listOf("exercise-2"),
            families = listOf(
                SettingsBarbellFamilyInput(
                    family = "LARGE",
                    loadingSides = 2,
                    bars = listOf(SettingsSystemBarInput("large-12", 12.0)),
                    plates = listOf(SettingsSystemPlateInput(10.0, 2)),
                ),
                SettingsBarbellFamilyInput(
                    family = "SMALL",
                    loadingSides = 2,
                    bars = listOf(SettingsSystemBarInput("small-6", 6.0)),
                    plates = listOf(SettingsSystemPlateInput(3.5, null)),
                ),
            ),
        )

        api.saveDumbbellsSystemProfile("gym-1", dumbbells)
        api.saveBarbellSystemProfile("gym-1", barbell)
        api.saveBarbellSystemProfile("gym-1", barbell)
        api.updateGym("gym-1", SettingsGymUpdateInput(name = "Renamed"))

        assertEquals("/api/gyms/gym-1/system-profiles/dumbbells", requests[0].first)
        assertEquals("/api/gyms/gym-1/system-profiles/barbell", requests[1].first)
        assertEquals(requests[1].second, requests[2].second)
        assertTrue(requests[1].second.contains("\"equipmentId\":\"large-12\""))
        assertTrue(requests[1].second.contains("\"family\":\"SMALL\""))
        assertEquals("/api/gyms/gym-1", requests[3].first)
        assertTrue(!requests[3].second.contains("dumbbellWeights"))
        assertTrue(!requests[3].second.contains("plateWeights"))
        assertTrue(!requests[3].second.contains("barWeights"))
    }
}
