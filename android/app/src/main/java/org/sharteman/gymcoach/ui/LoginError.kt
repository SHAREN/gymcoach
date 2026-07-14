package org.sharteman.gymcoach.ui

import kotlinx.serialization.SerializationException
import org.sharteman.gymcoach.data.network.ApiException
import org.sharteman.gymcoach.data.repository.LoginInitializationException
import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import javax.net.ssl.SSLException

internal enum class LoginErrorKind {
    INVALID_CREDENTIALS,
    INVALID_REQUEST,
    RATE_LIMITED,
    MOBILE_API_NOT_FOUND,
    SERVER_ERROR,
    HOST_NOT_FOUND,
    SERVER_UNREACHABLE,
    TIMEOUT,
    TLS_ERROR,
    INVALID_SERVER_URL,
    HTTPS_REQUIRED,
    CLEARTEXT_NOT_ALLOWED,
    INCOMPATIBLE_RESPONSE,
    INITIAL_SYNC_FAILED,
    NETWORK_ERROR,
    UNKNOWN,
}

internal fun classifyLoginError(error: Throwable): LoginErrorKind {
    if (error is LoginInitializationException) return LoginErrorKind.INITIAL_SYNC_FAILED
    val causes = generateSequence(error) { it.cause }.take(8).toList()

    causes.filterIsInstance<ApiException>().firstOrNull()?.let { apiError ->
        return when (apiError.statusCode) {
            400 -> LoginErrorKind.INVALID_REQUEST
            401, 403 -> LoginErrorKind.INVALID_CREDENTIALS
            404, 405 -> LoginErrorKind.MOBILE_API_NOT_FOUND
            408 -> LoginErrorKind.TIMEOUT
            429 -> LoginErrorKind.RATE_LIMITED
            in 500..599 -> LoginErrorKind.SERVER_ERROR
            else -> LoginErrorKind.UNKNOWN
        }
    }
    if (causes.any { it is SerializationException }) return LoginErrorKind.INCOMPATIBLE_RESPONSE
    if (causes.any { it is SSLException }) return LoginErrorKind.TLS_ERROR
    if (causes.any { it is UnknownHostException }) return LoginErrorKind.HOST_NOT_FOUND
    if (causes.any { it is ConnectException }) return LoginErrorKind.SERVER_UNREACHABLE
    if (causes.any { it is SocketTimeoutException }) return LoginErrorKind.TIMEOUT

    val combinedMessage = causes.mapNotNull { it.message }.joinToString(" ")
    if (combinedMessage.contains("CLEARTEXT", ignoreCase = true)) {
        return LoginErrorKind.CLEARTEXT_NOT_ALLOWED
    }
    causes.filterIsInstance<IllegalArgumentException>().firstOrNull()?.let { invalidArgument ->
        return if (invalidArgument.message?.contains("HTTPS is required", ignoreCase = true) == true) {
            LoginErrorKind.HTTPS_REQUIRED
        } else {
            LoginErrorKind.INVALID_SERVER_URL
        }
    }
    if (causes.any { it is IOException }) return LoginErrorKind.NETWORK_ERROR
    return LoginErrorKind.UNKNOWN
}
