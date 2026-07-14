package org.sharteman.gymcoach.ui.coach

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MarkdownContentTest {
    @Test
    fun keepsHeadingsListsQuotesAndCodeAsStructuredBlocks() {
        val blocks = parseMarkdownBlocks(
            """
            # Plan

            - Keep the load
            1. Record RIR
            > Review after training
            ```
            sets = 3
            ```
            """.trimIndent(),
        )

        assertEquals(MarkdownBlock.Heading(1, "Plan"), blocks[0])
        assertEquals(MarkdownBlock.Bullet("Keep the load", ordered = false), blocks[1])
        assertEquals(MarkdownBlock.Bullet("Record RIR", ordered = true, number = 1), blocks[2])
        assertTrue(blocks[3] is MarkdownBlock.Quote)
        assertEquals(MarkdownBlock.Code("sets = 3"), blocks[4])
    }
}
