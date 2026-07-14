package org.sharteman.gymcoach.data.programs

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import org.sharteman.gymcoach.data.model.ExerciseDto
import org.sharteman.gymcoach.data.model.ProgramExerciseDto
import org.sharteman.gymcoach.data.model.WorkoutDto

@Serializable
data class ProgramCountsDto(
    val workouts: Int = 0,
    val sessions: Int = 0,
)

@Serializable
data class ManagedProgramDto(
    val id: String,
    val name: String,
    val description: String? = null,
    val phase: String,
    val isActive: Boolean = false,
    val workouts: List<WorkoutDto> = emptyList(),
    @SerialName("_count") val counts: ProgramCountsDto = ProgramCountsDto(),
)

@Serializable
data class ProgramInput(
    val name: String,
    val phase: String,
    val description: String? = null,
)

@Serializable
data class WorkoutInput(
    val name: String,
    val dayOfWeek: Int? = null,
)

@Serializable
data class ProgramExerciseInput(
    val exerciseId: String,
    val targetSets: Int = 4,
    val targetDropSets: Int = 0,
    val targetRepsMin: Int = 8,
    val targetRepsMax: Int = 10,
    val targetRIR: Int = 2,
    val restSec: Int = 90,
    val autoregulationMode: String = "PRESERVE_RIR",
    val fatigueRate: Double? = null,
    val loadAdjustmentPct: Double? = null,
    val tempo: String? = null,
    val notes: String? = null,
    val supersetGroup: Int? = null,
)

@Serializable
data class ExerciseInput(
    val name: String,
    val muscleGroup: String,
    val category: String,
    val defaultRestSec: Int = 90,
    val notes: String? = null,
    val usesBodyweight: Boolean = false,
    val equipmentType: String = "OTHER",
)

@Serializable
data class ActiveInput(val active: Boolean)

@Serializable
data class MutationResult(val ok: Boolean)

interface ProgramsCatalogDataSource {
    suspend fun listPrograms(): List<ManagedProgramDto>
    suspend fun getProgram(id: String): ManagedProgramDto
    suspend fun createProgram(input: ProgramInput): ManagedProgramDto
    suspend fun updateProgram(id: String, input: ProgramInput): ManagedProgramDto
    suspend fun deleteProgram(id: String)
    suspend fun setProgramActive(id: String, active: Boolean): ManagedProgramDto
    suspend fun createWorkout(programId: String, input: WorkoutInput): WorkoutDto
    suspend fun updateWorkout(id: String, input: WorkoutInput): WorkoutDto
    suspend fun deleteWorkout(id: String)
    suspend fun createProgramExercise(workoutId: String, input: ProgramExerciseInput): ProgramExerciseDto
    suspend fun updateProgramExercise(id: String, input: ProgramExerciseInput): ProgramExerciseDto
    suspend fun deleteProgramExercise(id: String)
    suspend fun listExercises(): List<ExerciseDto>
    suspend fun getExercise(id: String): ExerciseDto
    suspend fun createExercise(input: ExerciseInput): ExerciseDto
    suspend fun updateExercise(id: String, input: ExerciseInput): ExerciseDto
    suspend fun deleteExercise(id: String)
}

data class ClientMutationMetadata(
    val operationId: String,
    val clientEntityId: String? = null,
)

interface ProgramsCatalogRemoteDataSource : ProgramsCatalogDataSource {
    suspend fun createProgram(
        input: ProgramInput,
        metadata: ClientMutationMetadata,
    ): ManagedProgramDto

    suspend fun createWorkout(
        programId: String,
        input: WorkoutInput,
        metadata: ClientMutationMetadata,
    ): WorkoutDto

    suspend fun createProgramExercise(
        workoutId: String,
        input: ProgramExerciseInput,
        metadata: ClientMutationMetadata,
    ): ProgramExerciseDto

    suspend fun createExercise(
        input: ExerciseInput,
        metadata: ClientMutationMetadata,
    ): ExerciseDto
}
