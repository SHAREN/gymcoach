package org.sharteman.gymcoach.data.offline

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import org.sharteman.gymcoach.data.model.ExerciseDto
import org.sharteman.gymcoach.data.model.HistoricalSetAddRequest
import org.sharteman.gymcoach.data.model.HistoricalSetUpdateRequest
import org.sharteman.gymcoach.data.model.MobileHistoryExerciseDto
import org.sharteman.gymcoach.data.model.MobileHistorySetDto
import org.sharteman.gymcoach.data.model.MobileHistorySnapshot
import org.sharteman.gymcoach.data.model.ProgramExerciseDto
import org.sharteman.gymcoach.data.model.WorkoutDto
import org.sharteman.gymcoach.data.programs.ExerciseInput
import org.sharteman.gymcoach.data.programs.ManagedProgramDto
import org.sharteman.gymcoach.data.programs.ProgramCountsDto
import org.sharteman.gymcoach.data.programs.ProgramExerciseInput
import org.sharteman.gymcoach.data.programs.ProgramInput
import org.sharteman.gymcoach.data.programs.WorkoutInput
import org.sharteman.gymcoach.data.programs.withGeneralMetadata

const val OFFLINE_DOMAIN_CATALOG = "CATALOG"
const val OFFLINE_DOMAIN_HISTORY = "HISTORY"
const val OFFLINE_STATUS_PENDING = "PENDING"
const val OFFLINE_STATUS_FAILED = "FAILED"
const val OFFLINE_STATUS_BLOCKED = "BLOCKED"

@Serializable
data class CatalogSnapshot(
    val programs: List<ManagedProgramDto> = emptyList(),
    val exercises: List<ExerciseDto> = emptyList(),
    val exerciseEditReceipts: Map<String, ExerciseInput> = emptyMap(),
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
    val ownerUserId: String? = null,
    override val domain: String = OFFLINE_DOMAIN_CATALOG,
) : OfflineMutation

@Serializable
@SerialName("UPDATE_EXERCISE")
data class UpdateExerciseMutation(
    override val operationId: String,
    val exerciseId: String,
    val input: ExerciseInput,
    val expected: ExerciseInput? = null,
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

@Serializable
@SerialName("UPDATE_HISTORICAL_SET")
data class UpdateHistoricalSetMutation(
    override val operationId: String,
    val setId: String,
    val sessionId: String? = null,
    val exerciseId: String? = null,
    val request: HistoricalSetUpdateRequest,
    override val domain: String = OFFLINE_DOMAIN_HISTORY,
) : OfflineMutation

@Serializable
@SerialName("ADD_HISTORICAL_SET")
data class AddHistoricalSetMutation(
    override val operationId: String,
    val sessionId: String,
    val request: HistoricalSetAddRequest,
    override val domain: String = OFFLINE_DOMAIN_HISTORY,
) : OfflineMutation

@Serializable
@SerialName("DELETE_HISTORICAL_SET")
data class DeleteHistoricalSetMutation(
    override val operationId: String,
    val setId: String,
    val sessionId: String? = null,
    val exerciseId: String? = null,
    override val domain: String = OFFLINE_DOMAIN_HISTORY,
) : OfflineMutation

data class OfflineSyncIssue(
    val operationId: String,
    val type: String,
    val message: String,
    val attempts: Int,
    val nextAttemptAtEpochMs: Long,
    val blocked: Boolean,
    val createdAtEpochMs: Long = 0,
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
            mutation.input.toDto(mutation.exerciseId).copy(userId = mutation.ownerUserId),
    )
    is UpdateExerciseMutation -> {
        val current = base.exercises.firstOrNull { it.id == mutation.exerciseId }
        val updated = current?.withGeneralMetadata(mutation.input)
            ?: mutation.input.toDto(mutation.exerciseId)
        base.copy(
            exercises = base.exercises.map { if (it.id == mutation.exerciseId) updated else it },
            exerciseEditReceipts = base.exerciseEditReceipts + (mutation.exerciseId to mutation.input),
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
    is DeleteExerciseMutation -> base.copy(
        exercises = base.exercises.filterNot { it.id == mutation.exerciseId },
        exerciseEditReceipts = base.exerciseEditReceipts - mutation.exerciseId,
    )
    is DeleteHistorySessionMutation,
    is UpdateHistoricalSetMutation,
    is AddHistoricalSetMutation,
    is DeleteHistoricalSetMutation,
    -> base
}

fun applyHistoryMutations(
    base: MobileHistorySnapshot,
    mutations: List<OfflineMutation>,
): MobileHistorySnapshot = mutations.fold(base, ::applyHistoryMutation)

fun applyHistoryMutation(
    base: MobileHistorySnapshot,
    mutation: OfflineMutation,
): MobileHistorySnapshot = when (mutation) {
    is DeleteHistorySessionMutation -> base.copy(
        sessions = base.sessions.filterNot { it.id == mutation.sessionId },
    )
    is UpdateHistoricalSetMutation -> base.mapHistoryExercises { sessionId, exercise ->
        if (mutation.sessionId != null && mutation.sessionId != sessionId) return@mapHistoryExercises exercise
        if (mutation.exerciseId != null && mutation.exerciseId != exercise.id) return@mapHistoryExercises exercise
        exercise.copy(
            sets = exercise.sets.map { set ->
                if (set.id == mutation.setId) set.withHistoricalUpdate(mutation.request) else set
            },
        )
    }.recomputeHistoryTotals()
    is AddHistoricalSetMutation -> base.mapHistoryExercises { sessionId, exercise ->
        if (sessionId != mutation.sessionId || exercise.id != mutation.request.exerciseId) {
            return@mapHistoryExercises exercise
        }
        if (exercise.sets.any { it.id == mutation.request.id }) return@mapHistoryExercises exercise
        val bodyweightOffset = exercise.sets.firstOrNull()
            ?.takeIf { exercise.usesBodyweight }
            ?.let { it.effectiveWeight - it.weight }
            ?: 0.0
        exercise.copy(
            sets = exercise.sets + MobileHistorySetDto(
                id = mutation.request.id,
                setNumber = (exercise.sets.maxOfOrNull { it.setNumber } ?: 0) + 1,
                weight = mutation.request.weight,
                effectiveWeight = mutation.request.weight + bodyweightOffset,
                reps = mutation.request.reps,
                rir = mutation.request.rir,
                completedAt = base.sessions.first { it.id == sessionId }.finishedAt,
                gymEquipmentId = mutation.request.gymEquipmentId,
                selectedLoadKg = mutation.request.weight.takeIf {
                    mutation.request.gymEquipmentId != null
                },
            ),
        )
    }.recomputeHistoryTotals()
    is DeleteHistoricalSetMutation -> base.mapHistoryExercises { sessionId, exercise ->
        if (mutation.sessionId != null && mutation.sessionId != sessionId) return@mapHistoryExercises exercise
        if (mutation.exerciseId != null && mutation.exerciseId != exercise.id) return@mapHistoryExercises exercise
        exercise.copy(sets = exercise.sets.filterNot { it.id == mutation.setId })
    }.recomputeHistoryTotals()
    else -> base
}

fun OfflineMutation.dependsOn(discarded: OfflineMutation): Boolean = when (discarded) {
    is CorruptOfflineMutation -> operationId == discarded.operationId
    is CreateProgramMutation -> referencesProgram(discarded.programId)
    is CreateWorkoutMutation -> referencesWorkout(discarded.workoutId)
    is CreateProgramExerciseMutation -> referencesProgramExercise(discarded.programExerciseId)
    is CreateExerciseMutation -> referencesExercise(discarded.exerciseId)
    is DeleteHistorySessionMutation -> when (this) {
        is DeleteHistorySessionMutation -> sessionId == discarded.sessionId
        is UpdateHistoricalSetMutation -> sessionId == discarded.sessionId
        is AddHistoricalSetMutation -> sessionId == discarded.sessionId
        is DeleteHistoricalSetMutation -> sessionId == discarded.sessionId
        else -> false
    }
    is AddHistoricalSetMutation -> when (this) {
        is UpdateHistoricalSetMutation -> setId == discarded.request.id
        is DeleteHistoricalSetMutation -> setId == discarded.request.id
        else -> operationId == discarded.operationId
    }
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

private inline fun MobileHistorySnapshot.mapHistoryExercises(
    transform: (sessionId: String, exercise: MobileHistoryExerciseDto) -> MobileHistoryExerciseDto,
): MobileHistorySnapshot = copy(
    sessions = sessions.map { session ->
        session.copy(exercises = session.exercises.map { transform(session.id, it) })
    },
)

private fun MobileHistorySetDto.withHistoricalUpdate(
    request: HistoricalSetUpdateRequest,
): MobileHistorySetDto {
    val bodyweightOffset = effectiveWeight - weight
    val replacesEquipment = request.equipmentSnapshotAction == "REPLACE"
    val clearsEquipment = request.equipmentSnapshotAction == "CLEAR"
    val retainedMultiplier = selectedLoadMultiplierSnapshot.takeUnless { replacesEquipment || clearsEquipment }
    val retainedSnapshot = equipmentLoadSnapshot.takeUnless { replacesEquipment || clearsEquipment }
    val updatedNominal = retainedMultiplier?.let { request.weight * it }
        ?: nominalResistanceKg.takeUnless { replacesEquipment || clearsEquipment }
    return copy(
        weight = request.weight,
        effectiveWeight = request.weight + bodyweightOffset,
        reps = request.reps,
        rir = request.rir,
        gymEquipmentId = when {
            clearsEquipment -> null
            replacesEquipment -> request.gymEquipmentId
            else -> gymEquipmentId
        },
        equipmentNameSnapshot = equipmentNameSnapshot.takeUnless { replacesEquipment || clearsEquipment },
        selectedLoadKg = when {
            clearsEquipment -> null
            replacesEquipment || gymEquipmentId != null || selectedLoadKg != null -> request.weight
            else -> null
        },
        selectedLoadMultiplierSnapshot = retainedMultiplier,
        nominalResistanceKg = updatedNominal,
        equipmentLoadSnapshot = retainedSnapshot?.withMutableLoadFacts(request.weight, updatedNominal),
    )
}

private fun kotlinx.serialization.json.JsonElement.withMutableLoadFacts(
    selectedLoadKg: Double,
    nominalResistanceKg: Double?,
): kotlinx.serialization.json.JsonElement {
    val snapshot = this as? JsonObject ?: return this
    return buildJsonObject {
        snapshot.forEach { (key, value) -> put(key, value) }
        put("selectedLoadKg", JsonPrimitive(selectedLoadKg))
        put("nominalResistanceKg", nominalResistanceKg?.let(::JsonPrimitive) ?: JsonNull)
    }
}

private fun MobileHistorySnapshot.recomputeHistoryTotals(): MobileHistorySnapshot = copy(
    sessions = sessions.map { session ->
        val exercises = session.exercises.map { exercise ->
            val working = exercise.sets.filterNot { it.isWarmup || it.durationSec != null }
            exercise.copy(
                volume = working.sumOf { it.effectiveWeight * it.reps },
                estimated1RM = working.maxOfOrNull {
                    it.effectiveWeight * (1.0 + it.reps / 30.0)
                }?.let { kotlin.math.round(it * 10.0) / 10.0 } ?: 0.0,
            )
        }
        session.copy(
            exercises = exercises,
            workingSets = exercises.sumOf { exercise ->
                exercise.sets.count { !it.isWarmup && it.durationSec == null }
            },
            volume = exercises.sumOf { it.volume },
        )
    },
)
