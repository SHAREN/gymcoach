package org.sharteman.gymcoach.data.offline

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import org.sharteman.gymcoach.data.model.ExerciseDto
import org.sharteman.gymcoach.data.model.ProgramExerciseDto
import org.sharteman.gymcoach.data.model.WorkoutDto
import org.sharteman.gymcoach.data.programs.ExerciseInput
import org.sharteman.gymcoach.data.programs.ManagedProgramDto
import org.sharteman.gymcoach.data.programs.ProgramCountsDto
import org.sharteman.gymcoach.data.programs.ProgramExerciseInput
import org.sharteman.gymcoach.data.programs.ProgramInput
import org.sharteman.gymcoach.data.programs.WorkoutInput

const val OFFLINE_DOMAIN_CATALOG = "CATALOG"
const val OFFLINE_DOMAIN_HISTORY = "HISTORY"
const val OFFLINE_STATUS_PENDING = "PENDING"
const val OFFLINE_STATUS_FAILED = "FAILED"
const val OFFLINE_STATUS_BLOCKED = "BLOCKED"

@Serializable
data class CatalogSnapshot(
    val programs: List<ManagedProgramDto> = emptyList(),
    val exercises: List<ExerciseDto> = emptyList(),
)

@Serializable
sealed interface OfflineMutation {
    val operationId: String
    val domain: String
}

@Serializable
@SerialName("CORRUPT")
data class CorruptOfflineMutation(
    override val operationId: String,
    override val domain: String,
) : OfflineMutation

@Serializable
@SerialName("CREATE_PROGRAM")
data class CreateProgramMutation(
    override val operationId: String,
    val programId: String,
    val input: ProgramInput,
    override val domain: String = OFFLINE_DOMAIN_CATALOG,
) : OfflineMutation

@Serializable
@SerialName("UPDATE_PROGRAM")
data class UpdateProgramMutation(
    override val operationId: String,
    val programId: String,
    val input: ProgramInput,
    override val domain: String = OFFLINE_DOMAIN_CATALOG,
) : OfflineMutation

@Serializable
@SerialName("DELETE_PROGRAM")
data class DeleteProgramMutation(
    override val operationId: String,
    val programId: String,
    override val domain: String = OFFLINE_DOMAIN_CATALOG,
) : OfflineMutation

@Serializable
@SerialName("SET_PROGRAM_ACTIVE")
data class SetProgramActiveMutation(
    override val operationId: String,
    val programId: String,
    val active: Boolean,
    override val domain: String = OFFLINE_DOMAIN_CATALOG,
) : OfflineMutation

@Serializable
@SerialName("CREATE_WORKOUT")
data class CreateWorkoutMutation(
    override val operationId: String,
    val programId: String,
    val workoutId: String,
    val input: WorkoutInput,
    override val domain: String = OFFLINE_DOMAIN_CATALOG,
) : OfflineMutation

@Serializable
@SerialName("UPDATE_WORKOUT")
data class UpdateWorkoutMutation(
    override val operationId: String,
    val workoutId: String,
    val input: WorkoutInput,
    override val domain: String = OFFLINE_DOMAIN_CATALOG,
) : OfflineMutation

@Serializable
@SerialName("DELETE_WORKOUT")
data class DeleteWorkoutMutation(
    override val operationId: String,
    val workoutId: String,
    override val domain: String = OFFLINE_DOMAIN_CATALOG,
) : OfflineMutation

@Serializable
@SerialName("CREATE_PROGRAM_EXERCISE")
data class CreateProgramExerciseMutation(
    override val operationId: String,
    val workoutId: String,
    val programExerciseId: String,
    val input: ProgramExerciseInput,
    override val domain: String = OFFLINE_DOMAIN_CATALOG,
) : OfflineMutation

@Serializable
@SerialName("UPDATE_PROGRAM_EXERCISE")
data class UpdateProgramExerciseMutation(
    override val operationId: String,
    val programExerciseId: String,
    val input: ProgramExerciseInput,
    override val domain: String = OFFLINE_DOMAIN_CATALOG,
) : OfflineMutation

@Serializable
@SerialName("DELETE_PROGRAM_EXERCISE")
data class DeleteProgramExerciseMutation(
    override val operationId: String,
    val programExerciseId: String,
    override val domain: String = OFFLINE_DOMAIN_CATALOG,
) : OfflineMutation

@Serializable
@SerialName("CREATE_EXERCISE")
data class CreateExerciseMutation(
    override val operationId: String,
    val exerciseId: String,
    val input: ExerciseInput,
    override val domain: String = OFFLINE_DOMAIN_CATALOG,
) : OfflineMutation

@Serializable
@SerialName("UPDATE_EXERCISE")
data class UpdateExerciseMutation(
    override val operationId: String,
    val exerciseId: String,
    val input: ExerciseInput,
    override val domain: String = OFFLINE_DOMAIN_CATALOG,
) : OfflineMutation

@Serializable
@SerialName("DELETE_EXERCISE")
data class DeleteExerciseMutation(
    override val operationId: String,
    val exerciseId: String,
    override val domain: String = OFFLINE_DOMAIN_CATALOG,
) : OfflineMutation

@Serializable
@SerialName("DELETE_HISTORY_SESSION")
data class DeleteHistorySessionMutation(
    override val operationId: String,
    val sessionId: String,
    override val domain: String = OFFLINE_DOMAIN_HISTORY,
) : OfflineMutation

data class OfflineSyncIssue(
    val operationId: String,
    val type: String,
    val message: String,
    val attempts: Int,
    val nextAttemptAtEpochMs: Long,
    val blocked: Boolean,
)

fun applyCatalogMutations(
    base: CatalogSnapshot,
    mutations: List<OfflineMutation>,
): CatalogSnapshot = mutations.fold(base) { snapshot, mutation ->
    applyCatalogMutation(snapshot, mutation)
}

fun applyCatalogMutation(base: CatalogSnapshot, mutation: OfflineMutation): CatalogSnapshot = when (mutation) {
    is CorruptOfflineMutation -> base
    is CreateProgramMutation -> base.copy(
        programs = listOf(
            ManagedProgramDto(
                id = mutation.programId,
                name = mutation.input.name,
                description = mutation.input.description,
                phase = mutation.input.phase,
                counts = ProgramCountsDto(),
            ),
        ) + base.programs.filterNot { it.id == mutation.programId },
    )
    is UpdateProgramMutation -> base.copy(
        programs = base.programs.map { program ->
            if (program.id == mutation.programId) {
                program.copy(
                    name = mutation.input.name,
                    phase = mutation.input.phase,
                    description = mutation.input.description,
                )
            } else {
                program
            }
        },
    )
    is DeleteProgramMutation -> base.copy(programs = base.programs.filterNot { it.id == mutation.programId })
    is SetProgramActiveMutation -> base.copy(
        programs = base.programs.map { program ->
            when {
                program.id == mutation.programId -> program.copy(isActive = mutation.active)
                mutation.active && program.isActive -> program.copy(isActive = false)
                else -> program
            }
        },
    )
    is CreateWorkoutMutation -> base.updateProgram(mutation.programId) { program ->
        val workout = WorkoutDto(
            id = mutation.workoutId,
            programId = mutation.programId,
            name = mutation.input.name,
            dayOfWeek = mutation.input.dayOfWeek,
            order = (program.workouts.maxOfOrNull { it.order } ?: 0) + 1,
        )
        program.copy(
            workouts = program.workouts.filterNot { it.id == workout.id } + workout,
            counts = program.counts.copy(workouts = program.counts.workouts + 1),
        )
    }
    is UpdateWorkoutMutation -> base.updateWorkout(mutation.workoutId) { workout ->
        workout.copy(name = mutation.input.name, dayOfWeek = mutation.input.dayOfWeek)
    }
    is DeleteWorkoutMutation -> base.copy(
        programs = base.programs.map { program ->
            if (program.workouts.none { it.id == mutation.workoutId }) return@map program
            program.copy(
                workouts = program.workouts.filterNot { it.id == mutation.workoutId },
                counts = program.counts.copy(workouts = (program.counts.workouts - 1).coerceAtLeast(0)),
            )
        },
    )
    is CreateProgramExerciseMutation -> {
        val exercise = base.exercises.firstOrNull { it.id == mutation.input.exerciseId }
            ?: return base
        base.updateWorkout(mutation.workoutId) { workout ->
            val target = mutation.input.toDto(
                id = mutation.programExerciseId,
                workoutId = mutation.workoutId,
                order = (workout.exercises.maxOfOrNull { it.order } ?: 0) + 1,
                exercise = exercise,
            )
            workout.copy(exercises = workout.exercises.filterNot { it.id == target.id } + target)
        }
    }
    is UpdateProgramExerciseMutation -> base.updateProgramExercise(mutation.programExerciseId) { current ->
        val exercise = base.exercises.firstOrNull { it.id == mutation.input.exerciseId } ?: current.exercise
        mutation.input.toDto(current.id, current.workoutId, current.order, exercise)
    }
    is DeleteProgramExerciseMutation -> base.copy(
        programs = base.programs.map { program ->
            program.copy(
                workouts = program.workouts.map { workout ->
                    workout.copy(exercises = workout.exercises.filterNot { it.id == mutation.programExerciseId })
                },
            )
        },
    )
    is CreateExerciseMutation -> base.copy(
        exercises = base.exercises.filterNot { it.id == mutation.exerciseId } +
            mutation.input.toDto(mutation.exerciseId),
    )
    is UpdateExerciseMutation -> {
        val current = base.exercises.firstOrNull { it.id == mutation.exerciseId }
        val updated = mutation.input.toDto(mutation.exerciseId).copy(
            userId = current?.userId,
            trainingDates = current?.trainingDates.orEmpty(),
        )
        base.copy(
            exercises = base.exercises.map { if (it.id == mutation.exerciseId) updated else it },
            programs = base.programs.map { program ->
                program.copy(
                    workouts = program.workouts.map { workout ->
                        workout.copy(
                            exercises = workout.exercises.map { target ->
                                if (target.exerciseId == mutation.exerciseId) target.copy(exercise = updated) else target
                            },
                        )
                    },
                )
            },
        )
    }
    is DeleteExerciseMutation -> base.copy(exercises = base.exercises.filterNot { it.id == mutation.exerciseId })
    is DeleteHistorySessionMutation -> base
}

fun OfflineMutation.dependsOn(discarded: OfflineMutation): Boolean = when (discarded) {
    is CorruptOfflineMutation -> operationId == discarded.operationId
    is CreateProgramMutation -> referencesProgram(discarded.programId)
    is CreateWorkoutMutation -> referencesWorkout(discarded.workoutId)
    is CreateProgramExerciseMutation -> referencesProgramExercise(discarded.programExerciseId)
    is CreateExerciseMutation -> referencesExercise(discarded.exerciseId)
    is DeleteHistorySessionMutation -> this is DeleteHistorySessionMutation && sessionId == discarded.sessionId
    else -> operationId == discarded.operationId
}

private fun OfflineMutation.referencesProgram(programId: String): Boolean = when (this) {
    is CorruptOfflineMutation -> false
    is CreateProgramMutation -> this.programId == programId
    is UpdateProgramMutation -> this.programId == programId
    is DeleteProgramMutation -> this.programId == programId
    is SetProgramActiveMutation -> this.programId == programId
    is CreateWorkoutMutation -> this.programId == programId
    else -> false
}

private fun OfflineMutation.referencesWorkout(workoutId: String): Boolean = when (this) {
    is CorruptOfflineMutation -> false
    is CreateWorkoutMutation -> this.workoutId == workoutId
    is UpdateWorkoutMutation -> this.workoutId == workoutId
    is DeleteWorkoutMutation -> this.workoutId == workoutId
    is CreateProgramExerciseMutation -> this.workoutId == workoutId
    else -> false
}

private fun OfflineMutation.referencesProgramExercise(programExerciseId: String): Boolean = when (this) {
    is CorruptOfflineMutation -> false
    is CreateProgramExerciseMutation -> this.programExerciseId == programExerciseId
    is UpdateProgramExerciseMutation -> this.programExerciseId == programExerciseId
    is DeleteProgramExerciseMutation -> this.programExerciseId == programExerciseId
    else -> false
}

private fun OfflineMutation.referencesExercise(exerciseId: String): Boolean = when (this) {
    is CorruptOfflineMutation -> false
    is CreateExerciseMutation -> this.exerciseId == exerciseId
    is UpdateExerciseMutation -> this.exerciseId == exerciseId
    is DeleteExerciseMutation -> this.exerciseId == exerciseId
    is CreateProgramExerciseMutation -> input.exerciseId == exerciseId
    is UpdateProgramExerciseMutation -> input.exerciseId == exerciseId
    else -> false
}

private fun CatalogSnapshot.updateProgram(
    programId: String,
    transform: (ManagedProgramDto) -> ManagedProgramDto,
) = copy(programs = programs.map { if (it.id == programId) transform(it) else it })

private fun CatalogSnapshot.updateWorkout(
    workoutId: String,
    transform: (WorkoutDto) -> WorkoutDto,
) = copy(
    programs = programs.map { program ->
        program.copy(workouts = program.workouts.map { if (it.id == workoutId) transform(it) else it })
    },
)

private fun CatalogSnapshot.updateProgramExercise(
    programExerciseId: String,
    transform: (ProgramExerciseDto) -> ProgramExerciseDto,
) = copy(
    programs = programs.map { program ->
        program.copy(
            workouts = program.workouts.map { workout ->
                workout.copy(
                    exercises = workout.exercises.map {
                        if (it.id == programExerciseId) transform(it) else it
                    },
                )
            },
        )
    },
)

private fun ExerciseInput.toDto(id: String) = ExerciseDto(
    id = id,
    name = name,
    muscleGroup = muscleGroup,
    category = category,
    defaultRestSec = defaultRestSec,
    notes = notes,
    usesBodyweight = usesBodyweight,
    equipmentType = equipmentType,
)

private fun ProgramExerciseInput.toDto(
    id: String,
    workoutId: String,
    order: Int,
    exercise: ExerciseDto,
) = ProgramExerciseDto(
    id = id,
    workoutId = workoutId,
    exerciseId = exerciseId,
    order = order,
    targetSets = targetSets,
    targetDropSets = targetDropSets,
    targetRepsMin = targetRepsMin,
    targetRepsMax = targetRepsMax,
    targetRIR = targetRIR,
    restSec = restSec,
    tempo = tempo,
    notes = notes,
    supersetGroup = supersetGroup,
    autoregulationMode = autoregulationMode,
    fatigueRate = fatigueRate,
    loadAdjustmentPct = loadAdjustmentPct,
    exercise = exercise,
)
