package org.sharteman.gymcoach.data.coach

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CoachResponseParserTest {
    @Test
    fun parsesValidatedAdjustmentsAndRemovesTheTransportBlock() {
        val result = parseCoachResponse(
            """
            ## Weekly review
            Keep the productive work.
            <adjustments>
            [{"exerciseName":"Bench Press","summary":"Add one set","suggestedSets":4,"suggestedRIR":2}]
            </adjustments>
            """.trimIndent(),
        )

        assertEquals("## Weekly review\nKeep the productive work.", result.markdown)
        assertEquals(1, result.adjustments.size)
        assertEquals(4, result.adjustments.single().suggestedSets)
        assertNull(result.parseError)
    }

    @Test
    fun rejectsAnOutOfContractAdjustmentWithoutOfferingItForApply() {
        val result = parseCoachResponse(
            "Advice<adjustments>[{\"exerciseName\":\"Bench\",\"summary\":\"Unsafe\",\"suggestedRIR\":9}]</adjustments>",
        )

        assertEquals("Advice", result.markdown)
        assertTrue(result.adjustments.isEmpty())
        assertTrue(result.parseError?.contains("Invalid adjustment") == true)
    }

    @Test
    fun fillsMissingValuesFromTheSameActiveProgramDefaultsAsWeb() {
        val adjustment = CoachAdjustment(exerciseName = "Bench", summary = "Hold")
        val result = adjustment.withDefaults(
            ProgramExerciseDefaultsDto(8, 12, 3, 2, 120),
        )

        assertEquals(8, result.suggestedRepsMin)
        assertEquals(12, result.suggestedRepsMax)
        assertEquals(3, result.suggestedSets)
        assertEquals(2, result.suggestedRIR)
        assertEquals(120, result.suggestedRestSec)
    }
}
