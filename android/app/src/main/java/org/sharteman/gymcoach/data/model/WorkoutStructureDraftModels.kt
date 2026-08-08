package org.sharteman.gymcoach.data.model

import kotlinx.serialization.Serializable

@Serializable
data class WorkoutStructureSnapshotDto(
    val workoutId: String,
    val workoutName: String,
    val exercises: List<ProgramExerciseDto>,
)

data class WorkoutStructureDraft(
    val sessionId: String,
    val status: String,
    val baseline: WorkoutStructureSnapshotDto,
    val current: WorkoutStructureSnapshotDto,
    val updatedAtEpochMs: Long,
)

object WorkoutStructureDraftStatus {
    const val ACTIVE = "ACTIVE"
    const val PENDING = "PENDING"
    const val APPLY_QUEUED = "APPLY_QUEUED"
    const val APPLIED = "APPLIED"
    const val KEPT_FOR_SESSION = "KEPT_FOR_SESSION"
}
