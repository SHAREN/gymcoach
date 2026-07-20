package org.sharteman.gymcoach.data.repository

import org.junit.Assert.assertEquals
import org.junit.Test
import org.sharteman.gymcoach.data.model.BootstrapResponse
import org.sharteman.gymcoach.data.model.ExerciseDto
import org.sharteman.gymcoach.data.model.ExerciseLoadProfileDto
import org.sharteman.gymcoach.data.model.MuscleLoadDimensionDto
import org.sharteman.gymcoach.data.model.ProfileDto
import org.sharteman.gymcoach.data.model.ProgramDto
import org.sharteman.gymcoach.data.model.ProgramExerciseDto
import org.sharteman.gymcoach.data.model.SessionDto
import org.sharteman.gymcoach.data.model.SetDto
import org.sharteman.gymcoach.data.model.TaggedLoadDimensionDto
import org.sharteman.gymcoach.data.model.WorkoutDto
import org.sharteman.gymcoach.data.programs.ExerciseInput
import org.sharteman.gymcoach.data.programs.generalMetadataInput

class ExerciseMetadataBootstrapTest {
    @Test
    fun `targeted exercise edit preserves workout targets drafts sets and frozen load snapshots`() {
        val original = exercise()
        val target = ProgramExerciseDto(
            id = "target-1",
            workoutId = "workout-1",
            exerciseId = original.id,
            order = 2,
            targetSets = 4,
            targetDropSets = 1,
            targetRepsMin = 8,
            targetRepsMax = 12,
            targetRIR = 2,
            restSec = 150,
            tempo = "3-1-1",
            notes = "Keep target note",
            supersetGroup = 3,
            exercise = original,
        )
        val workout = WorkoutDto(
            id = "workout-1",
            programId = "program-1",
            name = "Workout",
            order = 1,
            exercises = listOf(target),
        )
        val set = SetDto(
            id = "set-1",
            sessionId = "session-1",
            exerciseId = original.id,
            gymEquipmentId = "equipment-1",
            equipmentNameSnapshot = "Cable station",
            selectedLoadKg = 42.5,
            selectedLoadMultiplierSnapshot = 2.0,
            nominalResistanceKg = 85.0,
            setNumber = 1,
            weight = 42.5,
            reps = 10,
            rir = 2,
            completedAt = "2026-07-18T12:00:00Z",
        )
        val session = SessionDto(
            id = "session-1",
            workoutId = workout.id,
            startedAt = "2026-07-18T11:00:00Z",
            notes = "Keep workout draft",
            sets = listOf(set),
            workout = workout,
        )
        val bootstrap = BootstrapResponse(
            schemaVersion = 1,
            calculationVersion = "test",
            serverTime = "2026-07-18T12:00:00Z",
            profile = ProfileDto(id = "user-1", email = "user@example.test"),
            activeProgram = ProgramDto(
                id = "program-1",
                name = "Program",
                phase = "Base",
                workouts = listOf(workout),
            ),
            catalog = listOf(original),
            openSessions = listOf(session),
        )
        val input = ExerciseInput(
            name = "Renamed press",
            muscleGroup = "CHEST",
            category = "COMPOUND",
            defaultRestSec = 180,
            notes = "Updated exercise note",
            usesBodyweight = false,
            equipmentType = "CABLE",
        )

        val updated = applyExerciseInputToBootstrap(bootstrap, original.id, input)
        val expectedExercise = original.copy(
            name = input.name,
            defaultRestSec = input.defaultRestSec,
            notes = input.notes,
            equipmentType = input.equipmentType,
        )

        assertEquals(expectedExercise, updated.catalog.single())
        assertEquals(target.copy(exercise = expectedExercise), updated.activeProgram!!.workouts.single().exercises.single())
        assertEquals(target.copy(exercise = expectedExercise), updated.openSessions.single().workout!!.exercises.single())
        assertEquals(session.notes, updated.openSessions.single().notes)
        assertEquals(session.sets, updated.openSessions.single().sets)
    }

    @Test
    fun `remote metadata response cannot clear cached profile or training dates`() {
        val original = exercise()
        val bootstrap = BootstrapResponse(
            schemaVersion = 1,
            calculationVersion = "test",
            serverTime = "2026-07-18T12:00:00Z",
            profile = ProfileDto(id = "user-1", email = "user@example.test"),
            catalog = listOf(original),
        )
        val response = original.copy(
            name = "Updated",
            loadProfile = null,
            trainingDates = emptyList(),
        )

        val updated = mergeExerciseMetadataIntoBootstrap(bootstrap, response).catalog.single()

        assertEquals("Updated", updated.name)
        assertEquals(original.loadProfile, updated.loadProfile)
        assertEquals(original.trainingDates, updated.trainingDates)
    }

    @Test
    fun `captured edit protects one stale bootstrap then receipt is consumed causally`() {
        val original = exercise()
        val input = ExerciseInput(
            name = "Locally saved name",
            muscleGroup = original.muscleGroup,
            category = original.category,
            defaultRestSec = original.defaultRestSec,
            notes = original.notes,
            usesBodyweight = original.usesBodyweight,
            equipmentType = original.equipmentType,
        )
        val stale = BootstrapResponse(
            schemaVersion = 1,
            calculationVersion = "test",
            serverTime = "2026-07-18T12:00:00Z",
            profile = ProfileDto(id = "user-1", email = "user@example.test"),
            catalog = listOf(original),
        )
        val receipts = mapOf(original.id to input)
        val capturedBeforeRequest = receipts

        val protected = capturedBeforeRequest.entries.fold(stale) { current, entry ->
            applyExerciseInputToBootstrap(current, entry.key, entry.value)
        }
        val remaining = consumeProtectedExerciseEditReceipts(receipts, capturedBeforeRequest)
        val laterServerEdit = stale.copy(catalog = listOf(original.copy(name = "Later server edit")))

        assertEquals(input.name, protected.catalog.single().name)
        assertEquals(emptyMap<String, ExerciseInput>(), remaining)
        assertEquals("Later server edit", laterServerEdit.catalog.single().name)
    }

    @Test
    fun `receipt consumption never removes a newer edit created during bootstrap persistence`() {
        val original = exercise()
        val captured = original.generalMetadataInput().copy(name = "Captured edit")
        val newer = captured.copy(name = "Newer edit")

        val remaining = consumeProtectedExerciseEditReceipts(
            receipts = mapOf(original.id to newer),
            protectedEdits = mapOf(original.id to captured),
        )

        assertEquals(mapOf(original.id to newer), remaining)
    }

    private fun exercise() = ExerciseDto(
        id = "exercise-1",
        userId = "user-1",
        name = "Bench press",
        muscleGroup = "CHEST",
        category = "COMPOUND",
        defaultRestSec = 120,
        notes = "Original note",
        equipmentType = "BARBELL",
        loadProfile = ExerciseLoadProfileDto(
            version = 1,
            algorithmVersion = "exercise-load-profile-v1",
            classification = "CLASSIFIED",
            provenance = "TEST",
            confidence = "HIGH",
            primaryMuscles = MuscleLoadDimensionDto("CLASSIFIED"),
            secondaryMuscles = MuscleLoadDimensionDto("CLASSIFIED"),
            movementPatterns = TaggedLoadDimensionDto("CLASSIFIED"),
            fatigueTags = TaggedLoadDimensionDto("CLASSIFIED"),
            jointStress = TaggedLoadDimensionDto("CLASSIFIED"),
        ),
        trainingDates = listOf("2026-07-01T08:00:00Z"),
    )
}
