package org.sharteman.gymcoach.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

@Serializable
data class LoginRequest(
    val email: String,
    val password: String,
    val deviceId: String,
    val deviceName: String,
)

@Serializable
data class LoginResponse(
    val accessToken: String,
    val user: MobileUser,
)

@Serializable
data class ApiErrorResponse(
    val error: String? = null,
    val code: String? = null,
)

@Serializable
data class MobileUser(
    val id: String,
    val email: String,
    val displayName: String? = null,
)

@Serializable
data class BootstrapResponse(
    val schemaVersion: Int,
    val calculationVersion: String,
    val serverTime: String,
    val profile: ProfileDto,
    val activeProgram: ProgramDto? = null,
    val gyms: List<GymDto> = emptyList(),
    val catalog: List<ExerciseDto> = emptyList(),
    val openSessions: List<SessionDto> = emptyList(),
    val lastPerformances: Map<String, LastPerformanceDto> = emptyMap(),
    val exerciseHistoryByExerciseId: Map<String, List<ExerciseHistorySessionDto>> = emptyMap(),
    val returnRecommendationsByWorkout: Map<String, Map<String, ReturnRecommendationDto>> = emptyMap(),
    val readiness: ReadinessDto? = null,
)

@Serializable
data class ProfileDto(
    val id: String,
    val email: String,
    val displayName: String? = null,
    val bodyweight: Double? = null,
    val unit: String = "KG",
    val activeGymId: String? = null,
    val deloadActive: Boolean = false,
)

@Serializable
data class ProgramDto(
    val id: String,
    val name: String,
    val description: String? = null,
    val phase: String,
    val workouts: List<WorkoutDto> = emptyList(),
)

@Serializable
data class WorkoutDto(
    val id: String,
    val programId: String,
    val name: String,
    val dayOfWeek: Int? = null,
    val order: Int,
    val exercises: List<ProgramExerciseDto> = emptyList(),
)

@Serializable
data class ProgramExerciseDto(
    val id: String,
    val workoutId: String,
    val exerciseId: String,
    val order: Int,
    val targetSets: Int,
    val targetDropSets: Int = 0,
    val targetRepsMin: Int,
    val targetRepsMax: Int,
    val targetRIR: Int,
    val restSec: Int,
    val tempo: String? = null,
    val notes: String? = null,
    val supersetGroup: Int? = null,
    val autoregulationMode: String = "PRESERVE_RIR",
    val fatigueRate: Double? = null,
    val loadAdjustmentPct: Double? = null,
    val exercise: ExerciseDto,
)

@Serializable
data class ExerciseDto(
    val id: String,
    val userId: String? = null,
    val name: String,
    val muscleGroup: String,
    val category: String,
    val defaultRestSec: Int = 90,
    val notes: String? = null,
    val usesBodyweight: Boolean = false,
    val equipmentType: String = "OTHER",
    val trainingDates: List<String> = emptyList(),
)

@Serializable
data class GymDto(
    val id: String,
    val name: String,
    val dumbbellWeights: List<Double> = emptyList(),
    val plateWeights: List<Double> = emptyList(),
    val barWeights: List<Double> = emptyList(),
    val exerciseConfigs: List<GymExerciseConfigDto> = emptyList(),
)

@Serializable
data class GymExerciseConfigDto(
    val id: String? = null,
    val gymId: String,
    val exerciseId: String,
    val isAvailable: Boolean = true,
    val weightOptions: List<Double> = emptyList(),
    val dumbbellWeights: List<Double> = emptyList(),
    val plateWeights: List<Double> = emptyList(),
    val barWeights: List<Double> = emptyList(),
)

@Serializable
data class SessionDto(
    val id: String,
    val programId: String? = null,
    val workoutId: String? = null,
    val gymId: String? = null,
    val startedAt: String,
    val finishedAt: String? = null,
    val notes: String? = null,
    val sessionRpe: Int? = null,
    val sets: List<SetDto> = emptyList(),
    val workout: WorkoutDto? = null,
)

@Serializable
data class SetDto(
    val id: String,
    val sessionId: String,
    val exerciseId: String,
    val setNumber: Int,
    val weight: Double,
    val reps: Int,
    val rir: Int? = null,
    val durationSec: Int? = null,
    val distanceM: Double? = null,
    val avgHr: Int? = null,
    val maxHr: Int? = null,
    val notes: String? = null,
    val isWarmup: Boolean = false,
    val isDropSet: Boolean = false,
    val recoverySec: Int? = null,
    val completedAt: String,
)

@Serializable
data class LastPerformanceDto(
    val exerciseId: String,
    val sessionId: String,
    val sessionStartedAt: String,
    val sets: List<PerformanceSetDto> = emptyList(),
    val maxWeight: Double,
    val repsAtMaxWeight: Int,
)

@Serializable
data class PerformanceSetDto(
    val weight: Double,
    val reps: Int,
    val rir: Int? = null,
    val isDropSet: Boolean = false,
)

@Serializable
data class ExerciseHistorySessionDto(
    val sessionId: String,
    val startedAt: String,
    val sets: List<ExerciseHistorySetDto> = emptyList(),
)

@Serializable
data class ExerciseHistorySetDto(
    val setNumber: Int,
    val weight: Double,
    val reps: Int,
    val rir: Int? = null,
    val isDropSet: Boolean = false,
)

@Serializable
data class ReturnRecommendationDto(
    val mode: String,
    val exerciseGapDays: Int? = null,
    val muscleGapDays: Int? = null,
    val targetSets: Int,
    val targetRIR: Int,
    val suggestedWeight: Double? = null,
    val weightCeiling: Double? = null,
)

@Serializable
data class ReadinessDto(
    val readiness: Int,
    val sleepQuality: Int,
    val soreness: Map<String, Int>? = null,
    val note: String? = null,
    val createdAt: String,
    val ageHours: Double,
)

@Serializable
data class ReadinessCheckinRequest(
    val readiness: Int,
    val sleepQuality: Int,
    val note: String? = null,
)

@Serializable
data class MobileSessionPayload(
    val id: String,
    val workoutId: String,
    val gymId: String? = null,
    val startedAt: String,
)

@Serializable
data class MobileSetPayload(
    val id: String,
    val sessionId: String,
    val exerciseId: String,
    val setNumber: Int,
    val weight: Double,
    val reps: Int,
    val rir: Int? = null,
    val durationSec: Int? = null,
    val distanceM: Double? = null,
    val avgHr: Int? = null,
    val maxHr: Int? = null,
    val notes: String? = null,
    val isWarmup: Boolean = false,
    val isDropSet: Boolean = false,
    val recoverySec: Int? = null,
    val completedAt: String,
)

@Serializable
sealed interface SyncOperation {
    val operationId: String
}

@Serializable
@SerialName("START_SESSION")
data class StartSessionOperation(
    override val operationId: String,
    val session: MobileSessionPayload,
) : SyncOperation

@Serializable
@SerialName("UPSERT_SET")
data class UpsertSetOperation(
    override val operationId: String,
    val set: MobileSetPayload,
) : SyncOperation

@Serializable
@SerialName("DELETE_SET")
data class DeleteSetOperation(
    override val operationId: String,
    val setId: String,
) : SyncOperation

@Serializable
@SerialName("DELETE_SESSION")
data class DeleteSessionOperation(
    override val operationId: String,
    val sessionId: String,
) : SyncOperation

@Serializable
@SerialName("UPDATE_TARGET_SETS")
data class UpdateTargetSetsOperation(
    override val operationId: String,
    val programExerciseId: String,
    val targetSets: Int,
    val previousTargetSets: Int,
) : SyncOperation

@Serializable
@SerialName("FINISH_SESSION")
data class FinishSessionOperation(
    override val operationId: String,
    val sessionId: String,
    val finishedAt: String,
    val notes: String? = null,
    val sessionRpe: Int? = null,
) : SyncOperation

@Serializable
data class SyncBatchRequest(val operations: List<SyncOperation>)

@Serializable
data class SyncBatchResponse(
    val serverTime: String,
    val results: List<SyncOperationResult>,
)

@Serializable
data class SyncOperationResult(
    val operationId: String,
    val status: String,
    val result: JsonObject? = null,
    val error: String? = null,
)

@Serializable
data class MobileProgressSnapshot(
    val schemaVersion: Int,
    val generatedAt: String,
    val exercises: List<MobileProgressExerciseDto> = emptyList(),
    val weeklyVolume: List<MobileWeeklyVolumeDto>? = null,
    val consistency: MobileConsistencyDto? = null,
    val bodyweightEntries: List<MobileBodyweightEntryDto>? = null,
    val bodyMeasurements: List<MobileBodyMeasurementDto>? = null,
    val conditioningWeeks: List<MobileConditioningWeekDto>? = null,
    val unit: String = "KG",
    val volumeLandmarks: MobileVolumeLandmarksDto? = null,
    val records: List<MobileExerciseRecordDto> = emptyList(),
    val deload: MobileDeloadStatusDto = MobileDeloadStatusDto(),
)

@Serializable
data class MobileWeeklyVolumeDto(
    val weekKey: String,
    val weekStartIso: String,
    val byMuscleGroup: Map<String, Double> = emptyMap(),
    val total: Double,
)

@Serializable
data class MobileConsistencyDto(
    val weeks: List<MobileConsistencyWeekDto> = emptyList(),
    val currentStreak: Int,
    val weeklyFrequency: Int? = null,
)

@Serializable
data class MobileConsistencyWeekDto(
    val weekKey: String,
    val weekStartIso: String,
    val trainedDays: Int,
    val onStreak: Boolean,
    val isCurrent: Boolean,
)

@Serializable
data class MobileBodyweightEntryDto(
    val id: String,
    val weightKg: Double,
    val measuredAt: String,
)

@Serializable
data class MobileBodyMeasurementDto(
    val id: String,
    val site: String,
    val valueCm: Double,
    val measuredAt: String,
)

@Serializable
data class MobileConditioningWeekDto(
    val weekKey: String,
    val weekStartIso: String,
    val minutes: Int,
    val distanceKm: Double,
    val sessions: Int,
)

@Serializable
data class MobileProgressExerciseDto(
    val id: String,
    val name: String,
    val muscleGroup: String,
    val usesBodyweight: Boolean = false,
    val points: List<MobileProgressPointDto> = emptyList(),
    val bestEstimated1RM: Double = 0.0,
    val loadingTable: List<MobileLoadingRowDto> = emptyList(),
    val goal: MobileProgressGoalDto? = null,
    val recap: MobileProgressRecapDto = MobileProgressRecapDto(),
)

@Serializable
data class MobileProgressPointDto(
    val sessionStartedAt: String,
    val maxWeight: Double,
    val estimated1RM: Double,
    val totalVolume: Double,
    val topSetReps: Int,
    val maxReps: Int,
    val totalReps: Int,
)
