package org.sharteman.gymcoach.data.settings

import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import org.sharteman.gymcoach.data.model.ExerciseDto
import org.sharteman.gymcoach.data.model.CoachingProfileDto

@Serializable
data class SettingsProfileDto(
    val email: String,
    val displayName: String? = null,
    val bodyweight: Double? = null,
    val sex: String? = null,
    val heightCm: Int? = null,
    val goal: String? = null,
    val weeklyFrequency: Int? = null,
    val coachingProfile: CoachingProfileDto? = null,
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
    val preferredEquipmentId: String? = null,
    val isAvailable: Boolean = true,
    val systemProfileSupported: Boolean? = null,
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
data class SettingsEquipmentImageDto(
    val kind: String,
    val url: String,
    val mimeType: String? = null,
)

@Serializable
data class SettingsGymEquipmentDto(
    val id: String,
    val gymId: String,
    val name: String,
    val equipmentType: String,
    val description: String? = null,
    val manufacturer: String? = null,
    val modelName: String? = null,
    val quantity: Int = 1,
    val loadType: String = "NONE",
    val weightOptions: List<Double> = emptyList(),
    val selectedLoadMultiplier: Double = 1.0,
    val baseLoadKg: Double = 0.0,
    val platePoolId: String? = null,
    val loadingSides: Int = 2,
    val systemBarbellFamily: String? = null,
    val imageUrl: String? = null,
    val image: SettingsEquipmentImageDto? = null,
    val exerciseLinks: List<ExerciseDto> = emptyList(),
    val preferredExerciseIds: List<String> = emptyList(),
    val platePool: SettingsGymPlatePoolDto? = null,
)

@Serializable
data class SettingsGymPlateInventoryItemDto(
    val id: String? = null,
    val weightKg: Double,
    val quantity: Int? = null,
)

@Serializable
data class SettingsGymPlatePoolDto(
    val id: String = "",
    val name: String = "",
    val compatibilityKey: String = "",
    val systemBarbellFamily: String? = null,
    val plates: List<SettingsGymPlateInventoryItemDto> = emptyList(),
)

@Serializable
data class SettingsSharedFreeWeightsDto(
    val dumbbellWeightsKg: List<Double> = emptyList(),
    val plateWeightsKg: List<Double> = emptyList(),
    val barWeightsKg: List<Double> = emptyList(),
)

@Serializable
data class SettingsDumbbellsSystemProfileDto(
    val id: String = "",
    val kind: String = "DUMBBELLS",
    val weightsKg: List<Double> = emptyList(),
    val exerciseLinks: List<ExerciseDto> = emptyList(),
)

@Serializable
data class SettingsBarbellFamilyDto(
    val family: String = "",
    val pool: SettingsGymPlatePoolDto = SettingsGymPlatePoolDto(),
    val bars: List<SettingsGymEquipmentDto> = emptyList(),
    val loadingSides: Int = 2,
)

@Serializable
data class SettingsBarbellSystemProfileDto(
    val id: String = "",
    val kind: String = "BARBELL",
    val exerciseLinks: List<ExerciseDto> = emptyList(),
    val families: List<SettingsBarbellFamilyDto> = emptyList(),
)

@Serializable
data class SettingsSystemProfilesDto(
    val dumbbells: SettingsDumbbellsSystemProfileDto = SettingsDumbbellsSystemProfileDto(),
    val barbell: SettingsBarbellSystemProfileDto = SettingsBarbellSystemProfileDto(),
)

@Serializable
data class SettingsGymInventoryDto(
    val id: String,
    val name: String,
    val sharedFreeWeights: SettingsSharedFreeWeightsDto = SettingsSharedFreeWeightsDto(),
    val platePools: List<SettingsGymPlatePoolDto> = emptyList(),
    val equipment: List<SettingsGymEquipmentDto> = emptyList(),
    val systemProfiles: SettingsSystemProfilesDto? = null,
    val exerciseCoverage: List<ExerciseDto> = emptyList(),
)

@Serializable
data class SettingsGymInventoryResponse(
    val gym: SettingsGymInventoryDto,
)

@Serializable
data class SettingsGymEquipmentInput(
    val name: String,
    val equipmentType: String,
    val description: String? = null,
    val manufacturer: String? = null,
    val modelName: String? = null,
    val quantity: Int = 1,
    val weightOptions: List<Double> = emptyList(),
    val exerciseIds: List<String> = emptyList(),
    val markExercisesAvailable: Boolean = true,
)

@Serializable
data class SettingsDumbbellsSystemProfileInput(
    val weightsKg: List<Double>,
    val exerciseIds: List<String>,
)

@OptIn(ExperimentalSerializationApi::class)
@Serializable
data class SettingsSystemBarInput(
    @EncodeDefault(EncodeDefault.Mode.NEVER)
    val equipmentId: String? = null,
    val weightKg: Double,
)

@Serializable
data class SettingsSystemPlateInput(
    val weightKg: Double,
    val quantity: Int? = null,
)

@Serializable
data class SettingsBarbellFamilyInput(
    val family: String,
    val loadingSides: Int,
    val bars: List<SettingsSystemBarInput>,
    val plates: List<SettingsSystemPlateInput>,
)

@Serializable
data class SettingsBarbellSystemProfileInput(
    val exerciseIds: List<String>,
    val families: List<SettingsBarbellFamilyInput>,
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
data class SettingsGymUpdateInput(
    val name: String,
    val exerciseConfigs: List<SettingsGymExerciseConfigDto> = emptyList(),
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
    val gymInventories: Map<String, SettingsGymInventoryDto> = emptyMap(),
    val sectionFailures: List<SettingsSectionFailure> = emptyList(),
)

enum class SettingsSection {
    PROFILE,
    GYMS,
    EXERCISES,
    EQUIPMENT,
}

data class SettingsSectionFailure(
    val section: SettingsSection,
    val kind: SettingsErrorKind,
    val statusCode: Int? = null,
    val correlationId: String? = null,
    val subrequest: String? = null,
    val route: String? = null,
    val authority: String? = null,
    val errorCode: String? = null,
    val authOutcome: String? = null,
    val causeClass: String? = null,
    val retryable: Boolean = true,
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
    TOKEN_REVOKED,
    TOKEN_EXPIRED,
    FORBIDDEN,
    SESSION_ROUTE_REJECTED,
    ENDPOINT_MISMATCH,
    SESSION_VALIDATION_UNAVAILABLE,
    NOT_FOUND,
    INVALID_DATA,
    RATE_LIMIT,
    BAD_GATEWAY,
    SERVER_UNAVAILABLE,
    DNS,
    TIMEOUT,
    TLS,
    TRANSPORT,
    OFFLINE,
    INVALID_RESPONSE,
    UNKNOWN,
}

class SettingsException(
    val kind: SettingsErrorKind,
    val statusCode: Int? = null,
    val serverMessage: String? = null,
    val correlationId: String? = null,
    val subrequest: String? = null,
    val route: String? = null,
    val authority: String? = null,
    val errorCode: String? = null,
    val authOutcome: String? = null,
    val retryable: Boolean = true,
    cause: Throwable? = null,
) : Exception(serverMessage ?: kind.name, cause)

fun SettingsErrorKind.isConfirmedCredentialFailure(): Boolean = this in setOf(
    SettingsErrorKind.AUTHENTICATION,
    SettingsErrorKind.TOKEN_REVOKED,
    SettingsErrorKind.TOKEN_EXPIRED,
)
