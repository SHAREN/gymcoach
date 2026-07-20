package org.sharteman.gymcoach.ui.profile

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.sharteman.gymcoach.data.model.CoachingActivityIntensity
import org.sharteman.gymcoach.data.model.CoachingFieldDto
import org.sharteman.gymcoach.data.model.CoachingFieldState
import org.sharteman.gymcoach.data.model.CoachingHealthStatus
import org.sharteman.gymcoach.data.model.CoachingLimitationKind
import org.sharteman.gymcoach.data.model.CoachingMuscleGroup
import org.sharteman.gymcoach.data.model.CoachingOutsideActivityType
import org.sharteman.gymcoach.data.model.CoachingProfileDto
import org.sharteman.gymcoach.data.model.CoachingTrainingLevel

class CoachingProfileUiModelsTest {
    @Test
    fun `builds exact partial patches for every coaching profile field`() {
        val draft = CoachingProfileDraft(
            healthStatus = CoachingFieldDraft(CoachingFieldState.KNOWN, CoachingHealthStatus.TRAIN_WITH_LIMITATIONS),
            trainingLevel = CoachingFieldDraft(CoachingFieldState.KNOWN, CoachingTrainingLevel.INTERMEDIATE),
            availableWeekdays = CoachingFieldDraft(CoachingFieldState.KNOWN, setOf(5, 1, 3)),
            maximumSessionDurationMin = CoachingFieldDraft(CoachingFieldState.KNOWN, "75"),
            limitations = CoachingFieldDraft(
                CoachingFieldState.KNOWN,
                CoachingLimitationsDraftValue(
                    entries = listOf(
                        CoachingLimitationDraft(
                            kind = CoachingLimitationKind.PAIN,
                            label = " Pressing ",
                            affectedExerciseNames = listOf("Bench press", "bench press", "Arnold press"),
                            details = " Self-reported only ",
                        ),
                    ),
                    note = " General note ",
                ),
            ),
            priorityMuscles = CoachingFieldDraft(
                CoachingFieldState.KNOWN,
                setOf(CoachingMuscleGroup.CHEST, CoachingMuscleGroup.TRICEPS),
            ),
            priorityStrengthMovements = CoachingFieldDraft(
                CoachingFieldState.KNOWN,
                listOf("Squat", "Bench press"),
            ),
            outsideActivities = CoachingFieldDraft(
                CoachingFieldState.KNOWN,
                listOf(
                    CoachingOutsideActivityDraft(
                        type = CoachingOutsideActivityType.CARDIO,
                        name = " Cycling ",
                        sessionsPerWeek = "2",
                        minutesPerWeek = "90",
                        intensity = CoachingActivityIntensity.MODERATE,
                        details = "Commute",
                    ),
                ),
            ),
            likedExercises = CoachingFieldDraft(CoachingFieldState.KNOWN, listOf("Pull-up", "Row")),
            dislikedExercises = CoachingFieldDraft(CoachingFieldState.NOT_APPLICABLE, null),
            averageSleepHours = CoachingFieldDraft(CoachingFieldState.KNOWN, "7,5"),
            baselineStress = CoachingFieldDraft(CoachingFieldState.KNOWN, 3),
            generalRecovery = CoachingFieldDraft(CoachingFieldState.NOT_APPLICABLE, null),
        )

        val safety = requireNotNull(draft.sectionPatch(CoachingProfileSection.SAFETY).patch)
        val limitations = requireNotNull(draft.sectionPatch(CoachingProfileSection.LIMITATIONS).patch)
        val preferences = requireNotNull(draft.sectionPatch(CoachingProfileSection.PREFERENCES).patch)
        val recovery = requireNotNull(draft.sectionPatch(CoachingProfileSection.RECOVERY).patch)

        assertEquals(listOf(1, 3, 5), safety.availableWeekdays?.value)
        assertEquals(CoachingHealthStatus.TRAIN_WITH_LIMITATIONS, safety.healthStatus?.value)
        assertEquals(75, safety.maximumSessionDurationMin?.value)
        assertEquals(listOf("Bench press", "Arnold press"), limitations.limitations?.value?.entries?.single()?.affectedExerciseNames)
        assertEquals("Pressing", limitations.limitations?.value?.entries?.single()?.label)
        assertEquals(2, preferences.priorityMuscles?.value?.size)
        assertEquals("Cycling", preferences.outsideActivities?.value?.single()?.name)
        assertEquals(CoachingFieldState.NOT_APPLICABLE, preferences.dislikedExercises?.state)
        assertEquals(7.5, recovery.averageSleepHours?.value)
        assertEquals(3, recovery.baselineStress?.value)
        assertEquals(CoachingFieldState.NOT_APPLICABLE, recovery.generalRecovery?.state)
    }

    @Test
    fun `preserves unknown and not applicable without inventing values`() {
        val profile = CoachingProfileDto(
            healthStatus = CoachingFieldDto(state = "UNKNOWN", value = "NO_SIGNIFICANT_ISSUES"),
            limitations = CoachingFieldDto(state = "NOT_APPLICABLE", value = null),
            likedExercises = CoachingFieldDto(state = "NOT_APPLICABLE", value = null),
        )

        val draft = profile.toDraft()

        assertEquals(CoachingFieldState.UNKNOWN, draft.healthStatus.state)
        assertNull(draft.healthStatus.value)
        assertEquals(CoachingFieldState.NOT_APPLICABLE, draft.limitations.state)
        assertEquals(CoachingFieldState.NOT_APPLICABLE, draft.likedExercises.state)
    }

    @Test
    fun `normalizes unsupported or malformed server values to unknown`() {
        val profile = CoachingProfileDto(
            healthStatus = CoachingFieldDto(state = "KNOWN", value = "HEALTHY"),
            trainingLevel = CoachingFieldDto(state = "NOT_APPLICABLE", value = null),
            availableWeekdays = CoachingFieldDto(state = "KNOWN", value = listOf(1, 1)),
            priorityStrengthMovements = CoachingFieldDto(state = "KNOWN", value = List(21) { "Movement $it" }),
            likedExercises = CoachingFieldDto(state = "KNOWN", value = List(51) { "Exercise $it" }),
            averageSleepHours = CoachingFieldDto(state = "KNOWN", value = 25.0),
        )

        val draft = profile.toDraft()

        assertEquals(CoachingFieldState.UNKNOWN, draft.healthStatus.state)
        assertEquals(CoachingFieldState.UNKNOWN, draft.trainingLevel.state)
        assertEquals(CoachingFieldState.UNKNOWN, draft.availableWeekdays.state)
        assertTrue(draft.availableWeekdays.omitOnSave)
        assertTrue(draft.priorityStrengthMovements.omitOnSave)
        assertTrue(draft.likedExercises.omitOnSave)
        assertEquals(CoachingFieldState.UNKNOWN, draft.averageSleepHours.state)
    }

    @Test
    fun `unrelated section edit omits unsupported future enum instead of clearing it`() {
        val draft = CoachingProfileDto(
            healthStatus = CoachingFieldDto(state = "UNKNOWN"),
            trainingLevel = CoachingFieldDto(
                state = "KNOWN",
                value = "ELITE_FUTURE_LEVEL",
                updatedAt = "2026-07-18T10:00:00.000Z",
            ),
            availableWeekdays = CoachingFieldDto(state = "KNOWN", value = listOf(1, 3)),
            maximumSessionDurationMin = CoachingFieldDto(state = "KNOWN", value = 60),
        ).toDraft().copy(
            maximumSessionDurationMin = CoachingFieldDraft(CoachingFieldState.KNOWN, "75"),
        )

        val patch = requireNotNull(draft.sectionPatch(CoachingProfileSection.SAFETY).patch)

        assertNull(patch.trainingLevel)
        assertEquals(75, patch.maximumSessionDurationMin?.value)
    }

    @Test
    fun `raw list item bound is enforced before duplicate normalization`() {
        val overLimitDuplicates = List(51) { "Same exercise" }

        assertNull(normalizeUniqueList(overLimitDuplicates, maxItems = 50, maxLength = 120))
        assertEquals(
            listOf("Same exercise"),
            normalizeUniqueList(listOf("Same exercise", "same exercise"), 50, 120),
        )
    }

    @Test
    fun `exact names round trip without treating punctuation or newlines as separators`() {
        val exactNames = listOf("Press, machine", "Cable; row", "Supported\nrow")
        val profile = CoachingProfileDto(
            limitations = CoachingFieldDto(
                state = "KNOWN",
                value = org.sharteman.gymcoach.data.model.CoachingLimitationsValueDto(
                    entries = listOf(
                        org.sharteman.gymcoach.data.model.CoachingLimitationDto(
                            kind = "PAIN",
                            label = "Pressing",
                            affectedExerciseNames = exactNames,
                        ),
                    ),
                ),
            ),
            likedExercises = CoachingFieldDto(state = "KNOWN", value = exactNames),
        )

        val draft = profile.toDraft()
        val limitations = requireNotNull(draft.sectionPatch(CoachingProfileSection.LIMITATIONS).patch)
        val preferences = requireNotNull(draft.sectionPatch(CoachingProfileSection.PREFERENCES).patch)

        assertEquals(exactNames, limitations.limitations?.value?.entries?.single()?.affectedExerciseNames)
        assertEquals(exactNames, preferences.likedExercises?.value)
    }

    @Test
    fun `saved section merge keeps edits made while request is in flight`() {
        val submitted = CoachingProfileDraft(
            maximumSessionDurationMin = CoachingFieldDraft(CoachingFieldState.KNOWN, "60"),
            trainingLevel = CoachingFieldDraft(CoachingFieldState.KNOWN, CoachingTrainingLevel.BEGINNER),
        )
        val current = submitted.copy(
            maximumSessionDurationMin = CoachingFieldDraft(CoachingFieldState.KNOWN, "75"),
        )
        val saved = submitted.copy(
            maximumSessionDurationMin = CoachingFieldDraft(CoachingFieldState.KNOWN, "60"),
            trainingLevel = CoachingFieldDraft(CoachingFieldState.KNOWN, CoachingTrainingLevel.INTERMEDIATE),
        )

        val merged = mergeSectionDraft(current, submitted, saved, CoachingProfileSection.SAFETY)

        assertEquals("75", merged.maximumSessionDurationMin.value)
        assertEquals(CoachingTrainingLevel.INTERMEDIATE, merged.trainingLevel.value)
    }

    @Test
    fun `profile refresh merge keeps unsaved edits and accepts untouched server fields`() {
        val baseline = CoachingProfileDraft(
            maximumSessionDurationMin = CoachingFieldDraft(CoachingFieldState.KNOWN, "60"),
            baselineStress = CoachingFieldDraft(CoachingFieldState.KNOWN, 2),
        )
        val current = baseline.copy(
            maximumSessionDurationMin = CoachingFieldDraft(CoachingFieldState.KNOWN, "75"),
        )
        val saved = baseline.copy(
            maximumSessionDurationMin = CoachingFieldDraft(CoachingFieldState.KNOWN, "90"),
            baselineStress = CoachingFieldDraft(CoachingFieldState.KNOWN, 4),
        )

        val merged = mergeProfileDraftKeepingEdits(current, baseline, saved)

        assertEquals("75", merged.maximumSessionDurationMin.value)
        assertEquals(4, merged.baselineStress.value)
    }

    @Test
    fun `rejects every shared bound before saving`() {
        val invalid = CoachingProfileDraft(
            healthStatus = CoachingFieldDraft(CoachingFieldState.KNOWN, null),
            trainingLevel = CoachingFieldDraft(CoachingFieldState.KNOWN, null),
            availableWeekdays = CoachingFieldDraft(CoachingFieldState.KNOWN, emptySet()),
            maximumSessionDurationMin = CoachingFieldDraft(CoachingFieldState.KNOWN, "19"),
            limitations = CoachingFieldDraft(
                CoachingFieldState.KNOWN,
                CoachingLimitationsDraftValue(
                    listOf(CoachingLimitationDraft(label = "", affectedExerciseNames = listOf(""))),
                ),
            ),
            priorityMuscles = CoachingFieldDraft(CoachingFieldState.KNOWN, emptySet()),
            priorityStrengthMovements = CoachingFieldDraft(CoachingFieldState.KNOWN, listOf("")),
            outsideActivities = CoachingFieldDraft(
                CoachingFieldState.KNOWN,
                listOf(CoachingOutsideActivityDraft(name = "", sessionsPerWeek = "15")),
            ),
            likedExercises = CoachingFieldDraft(CoachingFieldState.KNOWN, listOf("")),
            dislikedExercises = CoachingFieldDraft(CoachingFieldState.KNOWN, listOf("")),
            averageSleepHours = CoachingFieldDraft(CoachingFieldState.KNOWN, "24.1"),
            baselineStress = CoachingFieldDraft(CoachingFieldState.KNOWN, 0),
            generalRecovery = CoachingFieldDraft(CoachingFieldState.KNOWN, 6),
        )

        CoachingProfileSection.entries.forEach { section ->
            assertFalse(invalid.sectionPatch(section).isValid)
            assertTrue(invalid.sectionPatch(section).invalidFields.isNotEmpty())
        }
    }
}
