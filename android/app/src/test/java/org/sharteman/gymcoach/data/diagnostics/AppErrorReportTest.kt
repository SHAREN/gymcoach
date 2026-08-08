package org.sharteman.gymcoach.data.diagnostics

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.sharteman.gymcoach.data.errors.AppErrorContext
import org.sharteman.gymcoach.data.errors.AppErrorDataState
import org.sharteman.gymcoach.data.errors.AppErrorOperation
import org.sharteman.gymcoach.data.errors.classifyAppError
import org.sharteman.gymcoach.data.network.ApiException

class AppErrorReportTest {
    @Test
    fun `report contains required diagnostics and redacts secrets`() {
        val error = classifyAppError(
            ApiException(
                statusCode = 400,
                serverMessage = "Invalid discriminator value. Authorization: Bearer super-secret " +
                    "email=person@example.com payload={private-training-data}",
                errorCode = "invalid_discriminator",
            ),
            AppErrorContext(
                operation = AppErrorOperation.SYNC,
                dataState = AppErrorDataState.QUEUED_LOCALLY,
                operationType = "UPSERT_SET",
                queueItemId = "operation-123",
                attemptCount = 2,
                createdAtEpochMs = 1_788_000_000_000,
                lastRetryAtEpochMs = 1_788_000_100_000,
                httpStatus = 400,
                correlationId = "request-safe-123",
            ),
        )
        val report = buildAppErrorReportForTest(
            error = error,
            pendingCount = 4,
            online = true,
            appInfo = SettingsDiagnosticAppInfo(
                packageName = "org.sharteman.gymcoach",
                versionName = "0.4.44",
                versionCode = 54,
                buildType = "release",
                commit = "abc123",
            ),
            networkClass = "wifi",
            recentEvents = emptyList(),
            nowEpochMs = 1_788_000_200_000,
        )

        for (required in listOf(
            "Generated UTC",
            "0.4.44 (54)",
            "abc123",
            "release",
            "Android",
            "Locale/timezone",
            "online-wifi",
            "CLIENT_SERVER_INCOMPATIBLE",
            "operation-123",
            "UPSERT_SET",
            "request-safe-123",
            "ApiException",
            "sanitizedStackTrace",
            "Sanitized machine-readable details",
        )) {
            assertTrue("Missing $required", report.contains(required))
        }
        assertFalse(report.contains("super-secret"))
        assertFalse(report.contains("person@example.com"))
        assertFalse(report.contains("private-training-data"))
        assertFalse(report.contains("Authorization: Bearer super-secret"))
    }
}
