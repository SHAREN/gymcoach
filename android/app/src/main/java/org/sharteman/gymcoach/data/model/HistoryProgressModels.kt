package org.sharteman.gymcoach.data.model

import kotlinx.serialization.Serializable

@Serializable
data class MobileProgressGoalDto(
    val id: String,
    val targetWeight: Double,
    val targetReps: Int,
    val targetEstimated1RM: Double,
    val progress: Double,
    val achievedAt: String? = null,
)

@Serializable
data class MobileProgressRecapDto(
    val sessions: Int = 0,
    val firstWeight: Double = 0.0,
    val firstDate: String = "",
    val lastWeight: Double = 0.0,
    val lastDate: String = "",
    val weightDelta: Double = 0.0,
    val firstEstimated1RM: Double = 0.0,
    val lastEstimated1RM: Double = 0.0,
    val estimated1RMDelta: Double = 0.0,
    val stalled: Boolean = false,
)

@Serializable
data class MobileLoadingRowDto(
    val percent: Int,
    val weight: Double,
)

@Serializable
data class MobileVolumeLandmarksDto(
    val weekKey: String,
    val defaultMev: Int,
    val defaultMrv: Int,
    val rows: List<MobileVolumeLandmarkRowDto> = emptyList(),
)

@Serializable
data class MobileVolumeLandmarkRowDto(
    val muscleGroup: String,
    val sets: Int,
    val frequency: Int,
    val zone: String,
    val mev: Int,
    val mrv: Int,
    val custom: Boolean,
)

@Serializable
data class MobileExerciseRecordDto(
    val exerciseName: String,
    val maxWeight: Double,
    val maxWeightReps: Int,
    val maxWeightDate: String,
    val bestEstimated1RM: Double,
    val bestEstimated1RMDate: String,
)

@Serializable
data class MobileDeloadStatusDto(
    val recommended: Boolean = false,
    val active: Boolean = false,
    val until: String? = null,
    val stalledExerciseNames: List<String> = emptyList(),
    val averageReadiness: Double? = null,
    val readinessCheckins: Int? = null,
)

@Serializable
data class MobileGoalRequest(
    val exerciseId: String,
    val targetWeight: Double,
    val targetReps: Int,
)

@Serializable
data class MobileVolumeTargetRequest(
    val muscleGroup: String,
    val mev: Int,
    val mrv: Int,
)

@Serializable
data class MobileVolumeTargetClearRequest(
    val muscleGroup: String,
)

@Serializable
data class MobileHistorySnapshot(
    val schemaVersion: Int,
    val generatedAt: String,
    val month: String,
    val selectedProgramId: String? = null,
    val unit: String = "KG",
    val programs: List<MobileHistoryProgramDto> = emptyList(),
    val sessions: List<MobileHistorySessionDto> = emptyList(),
    val hasAnyHistory: Boolean = false,
)

@Serializable
data class MobileHistoryProgramDto(
    val id: String,
    val name: String,
)

@Serializable
data class MobileHistorySessionDto(
    val id: String,
    val programId: String? = null,
    val programName: String? = null,
    val workoutName: String? = null,
    val startedAt: String,
    val finishedAt: String,
    val durationMin: Int,
    val notes: String? = null,
    val sessionRpe: Int? = null,
    val workingSets: Int,
    val volume: Double,
    val cardio: MobileHistoryCardioDto? = null,
    val exercises: List<MobileHistoryExerciseDto> = emptyList(),
)

@Serializable
data class MobileHistoryCardioDto(
    val durationSec: Int,
    val distanceM: Double,
    val avgHr: Int? = null,
)

@Serializable
data class MobileHistoryExerciseDto(
    val id: String,
    val name: String,
    val muscleGroup: String,
    val category: String,
    val usesBodyweight: Boolean = false,
    val volume: Double,
    val estimated1RM: Double,
    val cardio: MobileHistoryCardioDto? = null,
    val sets: List<MobileHistorySetDto> = emptyList(),
)

@Serializable
data class MobileHistorySetDto(
    val id: String,
    val setNumber: Int,
    val weight: Double,
    val effectiveWeight: Double,
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
