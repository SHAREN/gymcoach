package org.sharteman.gymcoach.data.settings

import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import javax.net.ssl.SSLHandshakeException
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.sharteman.gymcoach.data.diagnostics.SettingsDiagnosticSink
import org.sharteman.gymcoach.data.diagnostics.SettingsRequestDiagnostic
import org.sharteman.gymcoach.data.model.CoachingFieldInput
import org.sharteman.gymcoach.data.model.CoachingFieldState
import org.sharteman.gymcoach.data.model.CoachingHealthStatus
import org.sharteman.gymcoach.data.model.CoachingProfilePatchInput

class SettingsApiTest {

    @Test
    fun `coaching profile writes use exact partial body without server fields`() = runTest {
        val bodies = mutableListOf<String>()
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request()
            val buffer = Buffer()
            request.body?.writeTo(buffer)
            bodies += buffer.readUtf8()
            assertEquals("Bearer token", request.header("Authorization"))
            Response.Builder()
                .request(request)
                .protocol(Protocol.HTTP_1_1)
                .code(200)
                .message("OK")
                .body(
                    """{"email":"private@example.test","coachingProfile":{"version":1,"updatedAt":"2026-07-18T11:00:00.000Z","healthStatus":{"state":"KNOWN","value":"TRAIN_WITH_LIMITATIONS","updatedAt":"2026-07-18T11:00:00.000Z"}}}"""
                        .toResponseBody("application/json".toMediaType()),
                )
                .build()
        }.build()
        val api = SettingsApi("https://example.test", "token", client)
        val patch = CoachingProfilePatchInput(
            healthStatus = CoachingFieldInput(
                CoachingFieldState.KNOWN,
                CoachingHealthStatus.TRAIN_WITH_LIMITATIONS,
            ),
        )
        val first = api.saveCoachingProfile(patch)
        api.saveCoachingProfile(patch)
        assertEquals("TRAIN_WITH_LIMITATIONS", first.coachingProfile?.healthStatus?.value)
        assertEquals(bodies[0], bodies[1])
        assertEquals(
            """{"coachingProfile":{"healthStatus":{"state":"KNOWN","value":"TRAIN_WITH_LIMITATIONS"}}}""",
            bodies[0],
        )
        assertTrue(!bodies[0].contains("updatedAt"))
        assertTrue(!bodies[0].contains("displayName"))
    }
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
        assertEquals(SettingsErrorKind.TRANSPORT, classifySettingsError(ConnectException()))
    }

    @Test
    fun `load propagates one attempt across exact correlated subrequests`() = runTest {
        val diagnostics = RecordingDiagnostics()
        val requestCorrelations = mutableListOf<String>()
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request()
            requestCorrelations += requireNotNull(request.header("X-GymCoach-Correlation-ID"))
            val body = when (request.url.encodedPath) {
                "/api/profile" -> """{"email":"safe@example.invalid"}"""
                "/api/gyms" -> """{"gyms":[]}"""
                "/api/mobile/exercises" -> "[]"
                else -> error("Unexpected path ${request.url.encodedPath}")
            }
            val subrequest = when (request.url.encodedPath) {
                "/api/profile" -> "profile"
                "/api/gyms" -> "gyms"
                else -> "exercises"
            }
            Response.Builder()
                .request(request)
                .protocol(Protocol.HTTP_1_1)
                .code(200)
                .message("OK")
                .header("X-GymCoach-Correlation-ID", "server-$subrequest")
                .header("X-GymCoach-Settings-Subrequest", subrequest)
                .header("X-GymCoach-Auth-Outcome", "valid")
                .header("X-GymCoach-Error-Code", "ok")
                .body(body.toResponseBody("application/json".toMediaType()))
                .build()
        }.build()
        val api = SettingsApi(
            baseUrl = "https://example.test",
            token = "token",
            client = client,
            diagnostics = diagnostics,
        ).withDiagnosticAttempt("settings-attempt-1")

        val snapshot = api.load()

        assertEquals("safe@example.invalid", snapshot.profile.email)
        assertEquals(3, requestCorrelations.distinct().size)
        assertEquals(
            setOf("profile", "gyms", "exercises"),
            diagnostics.requests.mapNotNull { it.subrequest }.toSet(),
        )
        assertTrue(diagnostics.requests.all { it.attemptId == "settings-attempt-1" })
        assertTrue(diagnostics.requests.all { it.authOutcome == "valid" })
    }

    @Test
    fun `route rejection retains server correlation auth category and safe cause`() = runTest {
        val diagnostics = RecordingDiagnostics()
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            Response.Builder()
                .request(chain.request())
                .protocol(Protocol.HTTP_1_1)
                .code(403)
                .message("Forbidden")
                .header("X-GymCoach-Correlation-ID", "settings-profile-403")
                .header("X-GymCoach-Settings-Subrequest", "profile")
                .header("X-GymCoach-Auth-Outcome", "valid")
                .header("X-GymCoach-Error-Code", "auth_rejected")
                .body("""{"error":"Rejected","code":"auth_rejected"}"""
                    .toResponseBody("application/json".toMediaType()))
                .build()
        }.build()
        val api = SettingsApi("https://example.test", "token", client, diagnostics)

        val failure = runCatching { api.loadProfile() }.exceptionOrNull() as SettingsException

        assertEquals(SettingsErrorKind.FORBIDDEN, failure.kind)
        assertEquals("settings-profile-403", failure.correlationId)
        assertEquals("profile", failure.subrequest)
        assertEquals("auth_rejected", failure.errorCode)
        assertEquals("valid", failure.authOutcome)
        assertEquals("auth_rejected", diagnostics.requests.single().category)
    }

    @Test
    fun `invalid JSON keeps the successful response correlation and schema category`() = runTest {
        val diagnostics = RecordingDiagnostics()
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            Response.Builder()
                .request(chain.request())
                .protocol(Protocol.HTTP_1_1)
                .code(200)
                .message("OK")
                .header("X-GymCoach-Correlation-ID", "settings-profile-schema")
                .header("X-GymCoach-Settings-Subrequest", "profile")
                .header("X-GymCoach-Auth-Outcome", "valid")
                .body("not-json".toResponseBody("application/json".toMediaType()))
                .build()
        }.build()
        val api = SettingsApi("https://example.test", "token", client, diagnostics)

        val failure = runCatching { api.loadProfile() }.exceptionOrNull() as SettingsException

        assertEquals(SettingsErrorKind.INVALID_RESPONSE, failure.kind)
        assertEquals("settings-profile-schema", failure.correlationId)
        assertEquals("invalid-json-schema", failure.errorCode)
        assertEquals(1, diagnostics.requests.size)
        assertEquals("invalid-response", diagnostics.requests.single().category)
        assertTrue(diagnostics.requests.single().durationMs >= 0)
    }

    @Test
    fun `every Settings subrequest retains HTTP auth failures`() = runTest {
        settingsLoadCalls().forEach { call ->
            listOf(401, 403).forEach { statusCode ->
                val diagnostics = RecordingDiagnostics()
                val client = OkHttpClient.Builder().addInterceptor { chain ->
                    Response.Builder()
                        .request(chain.request())
                        .protocol(Protocol.HTTP_1_1)
                        .code(statusCode)
                        .message("Rejected")
                        .header("X-GymCoach-Correlation-ID", "${call.subrequest}-$statusCode")
                        .header("X-GymCoach-Settings-Subrequest", call.subrequest)
                        .header("X-GymCoach-Auth-Outcome", "valid")
                        .header("X-GymCoach-Error-Code", "route_rejected")
                        .body(
                            """{"error":"Rejected","code":"route_rejected"}"""
                                .toResponseBody("application/json".toMediaType()),
                        )
                        .build()
                }.build()
                val api = SettingsApi("https://example.test", "token", client, diagnostics)

                val failure = runCatching { call.invoke(api) }.exceptionOrNull() as SettingsException

                assertEquals(statusCode, failure.statusCode)
                assertEquals(call.subrequest, failure.subrequest)
                assertEquals("${call.subrequest}-$statusCode", failure.correlationId)
                assertEquals("route_rejected", failure.errorCode)
                assertEquals("valid", failure.authOutcome)
                assertEquals("route_rejected", diagnostics.requests.single().category)
            }
        }
    }

    @Test
    fun `every Settings subrequest retains network and schema failures`() = runTest {
        settingsLoadCalls().forEach { call ->
            settingsTransportFailures().forEach { transport ->
                val thrown = transport.createException()
                val networkDiagnostics = RecordingDiagnostics()
                val networkClient = OkHttpClient.Builder().addInterceptor {
                    throw thrown
                }.build()
                val networkApi = SettingsApi(
                    "https://example.test",
                    "token",
                    networkClient,
                    networkDiagnostics,
                )

                val networkFailure = runCatching {
                    call.invoke(networkApi)
                }.exceptionOrNull() as SettingsException

                val diagnostic = networkDiagnostics.requests.single()
                assertEquals(transport.kind, networkFailure.kind)
                assertEquals(call.subrequest, networkFailure.subrequest)
                assertTrue(!networkFailure.correlationId.isNullOrBlank())
                assertEquals(networkFailure.correlationId, diagnostic.correlationId)
                assertEquals(call.subrequest, diagnostic.subrequest)
                assertEquals(transport.category, diagnostic.category)
                assertEquals(transport.category, diagnostic.errorCode)
                assertTrue(networkFailure.cause === thrown)
                assertTrue(diagnostic.exception === thrown)
            }

            val schemaDiagnostics = RecordingDiagnostics()
            val schemaClient = OkHttpClient.Builder().addInterceptor { chain ->
                Response.Builder()
                    .request(chain.request())
                    .protocol(Protocol.HTTP_1_1)
                    .code(200)
                    .message("OK")
                    .header("X-GymCoach-Correlation-ID", "${call.subrequest}-schema")
                    .header("X-GymCoach-Settings-Subrequest", call.subrequest)
                    .body("not-json".toResponseBody("application/json".toMediaType()))
                    .build()
            }.build()
            val schemaApi = SettingsApi(
                "https://example.test",
                "token",
                schemaClient,
                schemaDiagnostics,
            )

            val schemaFailure = runCatching {
                call.invoke(schemaApi)
            }.exceptionOrNull() as SettingsException

            assertEquals(SettingsErrorKind.INVALID_RESPONSE, schemaFailure.kind)
            assertEquals(call.subrequest, schemaFailure.subrequest)
            assertEquals("${call.subrequest}-schema", schemaFailure.correlationId)
            assertEquals("invalid-response", schemaDiagnostics.requests.single().category)
        }
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

    @Test
    fun `new system bars omit equipment IDs while existing bars preserve them`() = runTest {
        val requests = mutableListOf<Pair<String, String>>()
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request()
            val buffer = Buffer()
            request.body?.writeTo(buffer)
            requests += request.url.encodedPath to buffer.readUtf8()
            Response.Builder()
                .request(request)
                .protocol(Protocol.HTTP_1_1)
                .code(200)
                .message("OK")
                .body("{}".toResponseBody("application/json".toMediaType()))
                .build()
        }.build()
        val api = SettingsApi("https://example.test", "token", client)
        val barbell = SettingsBarbellSystemProfileInput(
            exerciseIds = emptyList(),
            families = listOf(
                SettingsBarbellFamilyInput(
                    family = "LARGE",
                    loadingSides = 2,
                    bars = listOf(
                        SettingsSystemBarInput(weightKg = 17.5),
                        SettingsSystemBarInput(equipmentId = "stable-large-20", weightKg = 20.0),
                    ),
                    plates = emptyList(),
                ),
            ),
        )

        api.saveBarbellSystemProfile("gym-1", barbell)

        assertEquals("/api/gyms/gym-1/system-profiles/barbell", requests.single().first)
        val requestBody = requests.single().second
        val bars = Json.parseToJsonElement(requestBody)
            .jsonObject.getValue("families")
            .jsonArray.single()
            .jsonObject.getValue("bars")
            .jsonArray
        val newBar = bars[0].jsonObject
        val existingBar = bars[1].jsonObject
        assertFalse(newBar.containsKey("equipmentId"))
        assertFalse(requestBody.contains("\"equipmentId\":null"))
        assertEquals(
            "stable-large-20",
            existingBar.getValue("equipmentId").jsonPrimitive.content,
        )
    }
}

private data class SettingsLoadCall(
    val subrequest: String,
    val invoke: suspend (SettingsApi) -> Unit,
)

private data class SettingsTransportFailure(
    val kind: SettingsErrorKind,
    val category: String,
    val createException: () -> Throwable,
)

private fun settingsLoadCalls() = listOf(
    SettingsLoadCall("profile") { it.loadProfile() },
    SettingsLoadCall("gyms") { it.loadGyms() },
    SettingsLoadCall("exercises") { it.loadExercises() },
    SettingsLoadCall("gym-equipment") { it.loadGymInventory("cly9h7k2w0001u6w8m4v3n2pq") },
)

private fun settingsTransportFailures() = listOf(
    SettingsTransportFailure(SettingsErrorKind.DNS, "DNS") {
        UnknownHostException("offline")
    },
    SettingsTransportFailure(SettingsErrorKind.TIMEOUT, "TIMEOUT") {
        SocketTimeoutException("timeout")
    },
    SettingsTransportFailure(SettingsErrorKind.TLS, "TLS") {
        SSLHandshakeException("certificate")
    },
    SettingsTransportFailure(SettingsErrorKind.TRANSPORT, "TRANSPORT") {
        ConnectException("connection refused")
    },
)

private class RecordingDiagnostics : SettingsDiagnosticSink {
    val requests = mutableListOf<SettingsRequestDiagnostic>()

    override fun recordRequest(input: SettingsRequestDiagnostic) {
        requests += input
    }
}
