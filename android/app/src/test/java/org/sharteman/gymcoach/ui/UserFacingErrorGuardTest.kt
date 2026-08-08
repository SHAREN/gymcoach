package org.sharteman.gymcoach.ui

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test

class UserFacingErrorGuardTest {
    @Test
    fun `primary Android UI does not render throwable or server messages directly`() {
        val uiRoot = listOf(
            File("app/src/main/java/org/sharteman/gymcoach/ui"),
            File("src/main/java/org/sharteman/gymcoach/ui"),
        ).firstOrNull(File::isDirectory)
        requireNotNull(uiRoot) { "Android UI source directory was not found." }

        val forbidden = listOf(
            Regex("showSnackbar\\([^\\n]*\\.message"),
            Regex("(?:error|message)\\s*=\\s*(?:it|error|failure|throwable|exception)\\.message"),
            Regex("Text\\([^\\n]*(?:serverMessage|responseBody|errorBody)"),
            Regex("stringResource\\([^\\n]*,\\s*(?:it|error|failure|throwable|exception)\\.message"),
        )
        val findings = uiRoot.walkTopDown()
            .filter { it.isFile && it.extension == "kt" }
            .flatMap { file ->
                file.readLines().asSequence().mapIndexedNotNull { index, line ->
                    if (forbidden.any { it.containsMatchIn(line) }) {
                        "${file.relativeTo(uiRoot)}:${index + 1}: ${line.trim()}"
                    } else {
                        null
                    }
                }
            }
            .toList()

        assertTrue(
            "Raw technical errors must go through classifyAppError and friendly copy:\n" +
                findings.joinToString("\n"),
            findings.isEmpty(),
        )
    }
}
