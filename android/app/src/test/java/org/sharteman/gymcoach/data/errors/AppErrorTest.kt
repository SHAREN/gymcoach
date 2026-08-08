package org.sharteman.gymcoach.data.errors

import android.database.sqlite.SQLiteException
import java.io.FileNotFoundException
import java.io.IOException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import kotlinx.serialization.SerializationException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.sharteman.gymcoach.data.network.ApiException
import org.sharteman.gymcoach.data.repository.MobileAuthenticationRequiredException

class AppErrorTest {
    @Test
    fun `maps required network and HTTP categories without exposing raw messages`() {
        assertCategory(AppErrorCategory.OFFLINE, UnknownHostException("private.example"))
        assertCategory(AppErrorCategory.TIMEOUT, SocketTimeoutException("socket detail"))
        assertCategory(AppErrorCategory.SERVER_TEMPORARY, ApiException(503, "upstream stack"))
        assertCategory(AppErrorCategory.AUTH_REQUIRED, MobileAuthenticationRequiredException())
        assertCategory(AppErrorCategory.APP_UPDATE_REQUIRED, ApiException(426, "Update required"))
        assertCategory(AppErrorCategory.CONFLICT, ApiException(409, "revision conflict"))
        assertCategory(AppErrorCategory.NOT_FOUND_OR_DELETED, ApiException(404, "Session not found"))
        assertCategory(
            AppErrorCategory.CLIENT_SERVER_INCOMPATIBLE,
            ApiException(400, "Invalid discriminator value. Expected START_SESSION | UPSERT_SET"),
        )
        assertEquals(
            AppErrorCategory.CLIENT_SERVER_INCOMPATIBLE,
            classifyAppError(
                ApiException(400, "Invalid discriminator value"),
                AppErrorContext(online = false),
            ).category,
        )
        assertCategory(
            AppErrorCategory.CLIENT_SERVER_INCOMPATIBLE,
            SerializationException("Unknown field from newer server"),
        )
        assertCategory(AppErrorCategory.VALIDATION_OR_LEGACY_OPERATION, ApiException(422, "Invalid reps"))
        assertCategory(
            AppErrorCategory.VALIDATION_OR_LEGACY_OPERATION,
            IllegalStateException("Stored operation cannot be decoded: corrupt payload"),
        )
    }

    @Test
    fun `retryability and recovery actions distinguish temporary and permanent failures`() {
        val temporary = classifyAppError(SocketTimeoutException())
        assertTrue(temporary.retryable)
        assertEquals(AppErrorRecoveryAction.RETRY, temporary.recoveryAction)

        val schema = classifyAppError(
            ApiException(400, "Invalid discriminator value"),
            AppErrorContext(
                operation = AppErrorOperation.SYNC,
                dataState = AppErrorDataState.QUEUED_LOCALLY,
                queueItemId = "operation-1",
            ),
        )
        assertFalse(schema.retryable)
        assertEquals(AppErrorRecoveryAction.UPDATE_APP, schema.recoveryAction)
        assertEquals(AppErrorDataState.QUEUED_LOCALLY, schema.dataState)

        val validation = classifyAppError(
            ApiException(422, "Invalid legacy operation"),
            AppErrorContext(queueItemId = "operation-2"),
        )
        assertFalse(validation.retryable)
        assertEquals(AppErrorRecoveryAction.REMOVE_QUEUED_OPERATION, validation.recoveryAction)
    }

    @Test
    fun `file permission errors have a file-specific recovery action`() {
        val result = classifyAppError(
            FileNotFoundException("C:\\Users\\person\\private.txt"),
            AppErrorContext(operation = AppErrorOperation.EXPORT),
        )
        assertEquals(AppErrorCategory.PERMISSION_OR_FILE_EXPORT, result.category)
        assertEquals(AppErrorRecoveryAction.CHOOSE_ANOTHER_FILE, result.recoveryAction)
        assertEquals(
            AppErrorCategory.PERMISSION_OR_FILE_EXPORT,
            classifyAppError(
                IOException("Could not write selected file"),
                AppErrorContext(operation = AppErrorOperation.EXPORT),
            ).category,
        )
    }

    @Test
    fun `local database failures are classified as local storage without a network action`() {
        val result = classifyAppError(SQLiteException("database disk image is malformed"))
        assertEquals(AppErrorCategory.LOCAL_STORAGE, result.category)
        assertFalse(result.retryable)
        assertEquals(AppErrorRecoveryAction.CONTACT_SUPPORT, result.recoveryAction)
    }

    @Test
    fun `unknown exception keeps raw message only in sanitized technical details`() {
        val result = classifyAppError(IllegalStateException("internal raw failure 9182"))
        assertEquals(AppErrorCategory.UNKNOWN, result.category)
        assertEquals("internal raw failure 9182", result.technical.sanitizedServerResponse)
        assertEquals(AppErrorRecoveryAction.CONTACT_SUPPORT, result.recoveryAction)
    }

    @Test
    fun `sanitizer redacts credentials cookies email sensitive payload and paths`() {
        val raw = """
            Authorization: Bearer abc.def.ghi
            Cookie: session=secret-cookie
            {"accessToken":"gma_abcdefghijklmnopqrstuvwxyz0123456789ABCDE", "password":"hunter2",
             "email":"person@example.com", "medical":"private diagnosis", "payload":{"sets":[1,2]}}
            C:\Users\person\private\report.txt
        """.trimIndent()
        val sanitized = requireNotNull(sanitizeDiagnosticText(raw))
        assertFalse(sanitized.contains("abc.def.ghi"))
        assertFalse(sanitized.contains("secret-cookie"))
        assertFalse(sanitized.contains("hunter2"))
        assertFalse(sanitized.contains("person@example.com"))
        assertFalse(sanitized.contains("private diagnosis"))
        assertFalse(sanitized.contains("[1,2]"))
        assertFalse(sanitized.contains("C:\\Users"))
        assertTrue(sanitized.contains("[redacted]"))
    }

    @Test
    fun `unsafe identifiers are omitted from reports`() {
        assertNull(sanitizeDiagnosticIdentifier("Bearer secret"))
        assertNull(sanitizeDiagnosticIdentifier("person@example.com"))
        assertEquals("safe-id_123", sanitizeDiagnosticIdentifier("safe-id_123"))
    }

    private fun assertCategory(expected: AppErrorCategory, error: Throwable) {
        assertEquals(expected, classifyAppError(error).category)
    }
}
