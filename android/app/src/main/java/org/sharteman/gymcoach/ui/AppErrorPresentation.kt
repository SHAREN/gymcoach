package org.sharteman.gymcoach.ui

import android.content.Context
import org.sharteman.gymcoach.GymCoachApplication
import org.sharteman.gymcoach.R
import org.sharteman.gymcoach.data.errors.AppErrorCategory
import org.sharteman.gymcoach.data.errors.AppErrorContext
import org.sharteman.gymcoach.data.errors.AppErrorDataState
import org.sharteman.gymcoach.data.errors.AppErrorRecoveryAction
import org.sharteman.gymcoach.data.errors.UserFacingError
import org.sharteman.gymcoach.data.errors.classifyAppError
import org.sharteman.gymcoach.data.repository.SyncIssue
import org.sharteman.gymcoach.data.repository.SyncIssueDiscardScope

data class AppErrorCopy(
    val title: String,
    val message: String,
)

fun Context.appErrorCopy(error: UserFacingError): AppErrorCopy {
    val whatHappened = getString(error.category.whatHappenedResource())
    val dataState = getString(error.dataState.messageResource())
    val nextStep = getString(error.recoveryAction.messageResource())
    return AppErrorCopy(
        title = getString(error.category.titleResource()),
        message = listOf(whatHappened, dataState, nextStep).joinToString("\n\n"),
    )
}

fun Context.friendlyErrorMessage(
    throwable: Throwable,
    errorContext: AppErrorContext = AppErrorContext(),
): String {
    val classified = classifyAppError(throwable, errorContext)
    (applicationContext as? GymCoachApplication)?.settingsDiagnostics?.recordAppError(classified)
    return appErrorCopy(classified).message
}

internal fun Context.syncIssueSummary(error: UserFacingError): String = getString(
    when (error.category) {
        AppErrorCategory.NOT_FOUND_OR_DELETED -> R.string.sync_problem_summary_deleted
        AppErrorCategory.OFFLINE,
        AppErrorCategory.TIMEOUT,
        AppErrorCategory.SERVER_TEMPORARY,
        AppErrorCategory.CONFLICT,
        -> R.string.sync_problem_summary_retryable
        else -> R.string.sync_problem_summary_permanent
    },
)

internal fun Context.syncOperationDescription(type: String?): String = getString(
    when (type) {
        "START_SESSION" -> R.string.sync_operation_start_session
        "UPSERT_SET" -> R.string.sync_operation_upsert_set
        "DELETE_SET" -> R.string.sync_operation_delete_set
        "FINISH_SESSION" -> R.string.sync_operation_finish_session
        "DELETE_SESSION" -> R.string.sync_operation_delete_session
        "UPDATE_TARGET_SETS" -> R.string.sync_operation_target_sets
        "UPDATE_PREFERRED_EQUIPMENT" -> R.string.sync_operation_preferred_equipment
        "MUTATE_WORKOUT_EXERCISES" -> R.string.sync_operation_workout_exercises
        "REPLACE_PROGRAM_EXERCISE" -> R.string.sync_operation_replace_exercise
        else -> R.string.sync_operation_generic
    },
)

internal fun Context.syncDiscardConsequence(issue: SyncIssue?): String = getString(
    when {
        issue?.discardScope == SyncIssueDiscardScope.SESSION_AND_RELATED_CHANGES -> {
            R.string.sync_delete_start_session_consequence
        }
        issue?.type == "UPDATE_TARGET_SETS" -> R.string.sync_delete_target_sets_consequence
        issue?.type in setOf("MUTATE_WORKOUT_EXERCISES", "REPLACE_PROGRAM_EXERCISE") -> {
            R.string.sync_delete_program_change_consequence
        }
        else -> R.string.sync_delete_generic_consequence
    },
)

internal fun technicalDetailsText(error: UserFacingError): String {
    val details = error.technical
    return buildString {
        appendLine("Category: ${details.category.name}")
        appendLine("Retryable: ${error.retryable}")
        appendLine("Recovery action: ${error.recoveryAction.name}")
        appendLine("Data state: ${error.dataState.name}")
        appendLine("Operation: ${error.operation.name}")
        appendLine("Operation type: ${details.operationType ?: "not available"}")
        appendLine("Queue item: ${details.queueItemId ?: "not available"}")
        appendLine("Attempts: ${details.attemptCount ?: "not available"}")
        appendLine("HTTP status: ${details.httpStatus ?: "not available"}")
        appendLine("Error code: ${details.errorCode ?: "not available"}")
        appendLine("Correlation ID: ${details.correlationId ?: "not available"}")
        details.sanitizedServerResponse?.let {
            appendLine()
            appendLine("Sanitized server response:")
            appendLine(it)
        }
        details.exceptionClass?.let {
            appendLine()
            appendLine("Exception: $it")
        }
        details.sanitizedStackTrace?.let {
            appendLine()
            appendLine("Sanitized stack trace:")
            appendLine(it)
        }
    }.trim()
}

private fun AppErrorCategory.titleResource(): Int = when (this) {
    AppErrorCategory.OFFLINE -> R.string.app_error_title_offline
    AppErrorCategory.TIMEOUT -> R.string.app_error_title_timeout
    AppErrorCategory.SERVER_TEMPORARY -> R.string.app_error_title_server_temporary
    AppErrorCategory.AUTH_REQUIRED -> R.string.app_error_title_auth
    AppErrorCategory.APP_UPDATE_REQUIRED -> R.string.app_error_title_update
    AppErrorCategory.CLIENT_SERVER_INCOMPATIBLE -> R.string.app_error_title_incompatible
    AppErrorCategory.VALIDATION_OR_LEGACY_OPERATION -> R.string.app_error_title_validation
    AppErrorCategory.CONFLICT -> R.string.app_error_title_conflict
    AppErrorCategory.NOT_FOUND_OR_DELETED -> R.string.app_error_title_not_found
    AppErrorCategory.LOCAL_STORAGE -> R.string.app_error_title_storage
    AppErrorCategory.PERMISSION_OR_FILE_EXPORT -> R.string.app_error_title_file
    AppErrorCategory.UNKNOWN -> R.string.app_error_title_unknown
}

private fun AppErrorCategory.whatHappenedResource(): Int = when (this) {
    AppErrorCategory.OFFLINE -> R.string.app_error_what_offline
    AppErrorCategory.TIMEOUT -> R.string.app_error_what_timeout
    AppErrorCategory.SERVER_TEMPORARY -> R.string.app_error_what_server_temporary
    AppErrorCategory.AUTH_REQUIRED -> R.string.app_error_what_auth
    AppErrorCategory.APP_UPDATE_REQUIRED -> R.string.app_error_what_update
    AppErrorCategory.CLIENT_SERVER_INCOMPATIBLE -> R.string.app_error_what_incompatible
    AppErrorCategory.VALIDATION_OR_LEGACY_OPERATION -> R.string.app_error_what_validation
    AppErrorCategory.CONFLICT -> R.string.app_error_what_conflict
    AppErrorCategory.NOT_FOUND_OR_DELETED -> R.string.app_error_what_not_found
    AppErrorCategory.LOCAL_STORAGE -> R.string.app_error_what_storage
    AppErrorCategory.PERMISSION_OR_FILE_EXPORT -> R.string.app_error_what_file
    AppErrorCategory.UNKNOWN -> R.string.app_error_what_unknown
}

private fun AppErrorDataState.messageResource(): Int = when (this) {
    AppErrorDataState.SAVED_LOCALLY -> R.string.app_error_data_saved
    AppErrorDataState.QUEUED_LOCALLY -> R.string.app_error_data_queued
    AppErrorDataState.NOT_SAVED -> R.string.app_error_data_not_saved
    AppErrorDataState.UNKNOWN -> R.string.app_error_data_unknown
}

private fun AppErrorRecoveryAction.messageResource(): Int = when (this) {
    AppErrorRecoveryAction.RETRY -> R.string.app_error_next_retry
    AppErrorRecoveryAction.SIGN_IN -> R.string.app_error_next_sign_in
    AppErrorRecoveryAction.UPDATE_APP -> R.string.app_error_next_update
    AppErrorRecoveryAction.REVIEW_INPUT -> R.string.app_error_next_review
    AppErrorRecoveryAction.REFRESH -> R.string.app_error_next_refresh
    AppErrorRecoveryAction.REMOVE_QUEUED_OPERATION -> R.string.app_error_next_remove_operation
    AppErrorRecoveryAction.CHOOSE_ANOTHER_FILE -> R.string.app_error_next_file
    AppErrorRecoveryAction.CONTACT_SUPPORT -> R.string.app_error_next_support
    AppErrorRecoveryAction.NONE -> R.string.app_error_next_none
}
