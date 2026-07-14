package org.sharteman.gymcoach.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class ExerciseStripInteractionTest {
    @Test
    fun `inactive thumbnail selects exercise`() {
        assertEquals(ExerciseStripAction.SELECT, exerciseStripAction(selected = false, selectionEnabled = true))
    }

    @Test
    fun `selected thumbnail opens exercise details`() {
        assertEquals(ExerciseStripAction.OPEN, exerciseStripAction(selected = true, selectionEnabled = true))
    }

    @Test
    fun `selected thumbnail still opens while selection is disabled`() {
        assertEquals(ExerciseStripAction.OPEN, exerciseStripAction(selected = true, selectionEnabled = false))
        assertEquals(ExerciseStripAction.NONE, exerciseStripAction(selected = false, selectionEnabled = false))
    }
}
