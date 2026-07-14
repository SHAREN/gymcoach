package org.sharteman.gymcoach.ui

import kotlinx.serialization.SerializationException
import org.junit.Assert.assertEquals
import org.junit.Test
import org.sharteman.gymcoach.data.network.ApiException
import org.sharteman.gymcoach.data.repository.LoginInitializationException
import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import javax.net.ssl.SSLHandshakeException

class LoginErrorTest {
    @Test
    fun classifiesHttpFailures() {
        assertEquals(LoginErrorKind.INVALID_REQUEST, classifyLoginError(ApiException(400, null)))
        assertEquals(LoginErrorKind.INVALID_CREDENTIALS, classifyLoginError(ApiException(401, null)))
        assertEquals(LoginErrorKind.MOBILE_API_NOT_FOUND, classifyLoginError(ApiException(404, null)))
        assertEquals(LoginErrorKind.RATE_LIMITED, classifyLoginError(ApiException(429, null)))
        assertEquals(LoginErrorKind.SERVER_ERROR, classifyLoginError(ApiException(503, null)))
    }

    @Test
    fun classifiesTransportFailures() {
        assertEquals(LoginErrorKind.HOST_NOT_FOUND, classifyLoginError(UnknownHostException()))
        assertEquals(LoginErrorKind.SERVER_UNREACHABLE, classifyLoginError(ConnectException()))
        assertEquals(LoginErrorKind.TIMEOUT, classifyLoginError(SocketTimeoutException()))
        assertEquals(LoginErrorKind.TLS_ERROR, classifyLoginError(SSLHandshakeException("TLS")))
        assertEquals(LoginErrorKind.NETWORK_ERROR, classifyLoginError(IOException("network")))
    }

    @Test
    fun classifiesLocalValidationAndResponseFailures() {
        assertEquals(
            LoginErrorKind.HTTPS_REQUIRED,
            classifyLoginError(IllegalArgumentException("HTTPS is required for this server.")),
        )
        assertEquals(
            LoginErrorKind.INVALID_SERVER_URL,
            classifyLoginError(IllegalArgumentException("Invalid server URL.")),
        )
        assertEquals(
            LoginErrorKind.CLEARTEXT_NOT_ALLOWED,
            classifyLoginError(IOException("CLEARTEXT communication not permitted")),
        )
        assertEquals(
            LoginErrorKind.INCOMPATIBLE_RESPONSE,
            classifyLoginError(SerializationException("invalid JSON")),
        )
        assertEquals(
            LoginErrorKind.INITIAL_SYNC_FAILED,
            classifyLoginError(LoginInitializationException(IOException("offline"))),
        )
    }
}
