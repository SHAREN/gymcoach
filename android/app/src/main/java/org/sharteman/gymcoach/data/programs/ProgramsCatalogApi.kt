package org.sharteman.gymcoach.data.programs

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.sharteman.gymcoach.data.model.ApiErrorResponse
import org.sharteman.gymcoach.data.model.ExerciseDto
import org.sharteman.gymcoach.data.model.ProgramExerciseDto
import org.sharteman.gymcoach.data.model.WorkoutDto
import org.sharteman.gymcoach.data.network.ApiException
import java.util.concurrent.TimeUnit

class ProgramsCatalogApi(
    private val baseUrl: String,
    private val token: String,
    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build(),
) : ProgramsCatalogDataSource {
    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
        explicitNulls = true
    }

    override suspend fun listPrograms(): List<ManagedProgramDto> = request("GET", "/api/mobile/programs")
    override suspend fun getProgram(id: String): ManagedProgramDto =
        request("GET", "/api/mobile/programs/$id")

    override suspend fun createProgram(input: ProgramInput): ManagedProgramDto =
        request("POST", "/api/mobile/programs", json.encodeToString(input))

    override suspend fun updateProgram(id: String, input: ProgramInput): ManagedProgramDto =
        request("PUT", "/api/mobile/programs/$id", json.encodeToString(input))

    override suspend fun deleteProgram(id: String) {
        request<MutationResult>("DELETE", "/api/mobile/programs/$id")
    }

    override suspend fun setProgramActive(id: String, active: Boolean): ManagedProgramDto =
        request("POST", "/api/mobile/programs/$id/activate", json.encodeToString(ActiveInput(active)))

    override suspend fun createWorkout(programId: String, input: WorkoutInput): WorkoutDto =
        request("POST", "/api/mobile/programs/$programId/workouts", json.encodeToString(input))

    override suspend fun updateWorkout(id: String, input: WorkoutInput): WorkoutDto =
        request("PUT", "/api/mobile/workouts/$id", json.encodeToString(input))

    override suspend fun deleteWorkout(id: String) {
        request<MutationResult>("DELETE", "/api/mobile/workouts/$id")
    }

    override suspend fun createProgramExercise(
        workoutId: String,
        input: ProgramExerciseInput,
    ): ProgramExerciseDto = request(
        "POST",
        "/api/mobile/workouts/$workoutId/program-exercises",
        json.encodeToString(input),
    )

    override suspend fun updateProgramExercise(
        id: String,
        input: ProgramExerciseInput,
    ): ProgramExerciseDto = request(
        "PUT",
        "/api/mobile/program-exercises/$id",
        json.encodeToString(input),
    )

    override suspend fun deleteProgramExercise(id: String) {
        request<MutationResult>("DELETE", "/api/mobile/program-exercises/$id")
    }

    override suspend fun listExercises(): List<ExerciseDto> = request("GET", "/api/mobile/exercises")
    override suspend fun getExercise(id: String): ExerciseDto = request("GET", "/api/mobile/exercises/$id")
    override suspend fun createExercise(input: ExerciseInput): ExerciseDto =
        request("POST", "/api/mobile/exercises", json.encodeToString(input))

    override suspend fun updateExercise(id: String, input: ExerciseInput): ExerciseDto =
        request("PUT", "/api/mobile/exercises/$id", json.encodeToString(input))

    override suspend fun deleteExercise(id: String) {
        request<MutationResult>("DELETE", "/api/mobile/exercises/$id")
    }

    private suspend inline fun <reified T> request(method: String, path: String, body: String? = null): T =
        withContext(Dispatchers.IO) {
            val builder = Request.Builder()
                .url("${baseUrl.trimEnd('/')}$path")
                .header("Authorization", "Bearer $token")
            when (method) {
                "GET" -> builder.get()
                "POST" -> builder.post((body ?: "{}").toRequestBody(JSON_MEDIA_TYPE))
                "PUT" -> builder.put((body ?: "{}").toRequestBody(JSON_MEDIA_TYPE))
                "DELETE" -> builder.delete()
                else -> error("Unsupported HTTP method $method")
            }
            client.newCall(builder.build()).execute().use { response ->
                val responseBody = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    val envelope = runCatching { json.decodeFromString<ApiErrorResponse>(responseBody) }.getOrNull()
                    throw ApiException(response.code, envelope?.error)
                }
                json.decodeFromString<T>(responseBody)
            }
        }

    private companion object {
        val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()
    }
}
