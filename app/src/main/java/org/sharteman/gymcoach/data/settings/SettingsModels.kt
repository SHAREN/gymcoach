package org.sharteman.gymcoach.data.settings

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import org.sharteman.gymcoach.data.model.ExerciseDto

@Serializable
data class SettingsProfileDto(
    val email: String,
    val displayName: String? = null,
    val bodyweight: Double? = null,
    val sex: String? = null,
    val heightCm: Int? = null,
    val goal: String? = null,
    val weeklyFrequency: Int? = null,
    val unit: String = "KG",
)

@Serializable
data class SettingsProfileInput(
    val displayName: String? = null,
    val bodyweight: Double? = null,
    val sex: String? = null,
    val heightCm: Int? = null,
    val goal: String? = null,
    val weeklyFrequency: Int? = null,
    val unit: String = "KG",
)

@Serializable
data class SettingsGymExerciseConfigDto(
    val id: String? = null,
    val gymId: String? = null,
    val exerciseId: String,
    val isAvailable: Boolean = true,
    val weightOptions: List<Double> = emptyList(),
    val dumbbellWeights: List<Double> = emptyList(),
    val plateWeights: List<Double> = emptyList(),
    val barWeights: List<Double> = emptyList(),
)

@Serializable
data class SettingsGymDto(
    val id: String,
    val name: String,
    val dumbbellWeights: List<Double> = emptyList(),
    val plateWeights: List<Double> = emptyList(),
    val barWeights: List<Double> = emptyList(),
    val exerciseConfigs: List<SettingsGymExerciseConfigDto> = emptyList(),
)

@Serializable
data class SettingsGymListDto(
    val activeGymId: String? = null,
    val gyms: List<SettingsGymDto> = emptyList(),
)

@Serializable
data class SettingsGymInput(
    val name: String,
    val dumbbellWeights: List<Double> = emptyList(),
    val plateWeights: List<Double> = emptyList(),
    val barWeights: List<Double> = emptyList(),
    val exerciseConfigs: List<SettingsGymExerciseConfigDto> = emptyList(),
    val makeActive: Boolean = false,
)

@Serializable
data class AndroidReleaseDto(
    val versionCode: Int,
    val versionName: String,
    val sha256: String,
    val sizeBytes: Long,
    val publishedAt: String,
    val apkFile: String,
    val downloadUrl: String,
)

data class SettingsSnapshot(
    val profile: SettingsProfileDto,
    val gymList: SettingsGymListDto,
    val exercises: List<ExerciseDto>,
)

enum class SettingsImportFormat {
    STRONG,
    HEVY,
    TCX,
    GPX,
    FIT,
}

data class SettingsImportPreview(
    val format: SettingsImportFormat,
    val fileName: String,
    val payload: String,
    val unit: String,
    val response: JsonObject,
)

enum class SettingsErrorKind {
    AUTHENTICATION,
    FORBIDDEN,
    NOT_FOUND,
    INVALID_DATA,
    RATE_LIMIT,
    BAD_GATEWAY,
    SERVER_UNAVAILABLE,
    DNS,
    TIMEOUT,
    TLS,
    OFFLINE,
    INVALID_RESPONSE,
    UNKNOWN,
}

class SettingsException(
    val kind: SettingsErrorKind,
    val statusCode: Int? = null,
    val serverMessage: String? = null,
    cause: Throwable? = null,
) : Exception(serverMessage ?: kind.name, cause)
