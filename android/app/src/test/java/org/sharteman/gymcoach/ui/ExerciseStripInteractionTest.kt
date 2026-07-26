package org.sharteman.gymcoach.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
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

    @Test
    fun `active thumbnail is vivid and inactive thumbnail is subtly dimmed`() {
        assertEquals(1f, exerciseThumbnailAlpha(selected = true))
        assertEquals(0.58f, exerciseThumbnailAlpha(selected = false))
    }

    @Test
    fun `terminal add tile is extra for empty single and many strips`() {
        assertEquals(1, exerciseStripItemCount(0))
        assertEquals(2, exerciseStripItemCount(1))
        assertEquals(8, exerciseStripItemCount(7))
        assertTrue(isExerciseStripAddIndex(index = 0, exerciseCount = 0))
        assertTrue(isExerciseStripAddIndex(index = 1, exerciseCount = 1))
        assertTrue(isExerciseStripAddIndex(index = 7, exerciseCount = 7))
        assertFalse(isExerciseStripAddIndex(index = 6, exerciseCount = 7))
    }
}
