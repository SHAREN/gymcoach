package org.sharteman.gymcoach.data.settings

import java.net.SocketTimeoutException
import java.net.UnknownHostException
import javax.net.ssl.SSLHandshakeException
import org.junit.Assert.assertEquals
import org.junit.Test

class SettingsApiTest {
    @Test
    fun `maps actionable HTTP update errors`() {
        assertEquals(SettingsErrorKind.AUTHENTICATION, settingsErrorKindForStatus(401))
        assertEquals(SettingsErrorKind.NOT_FOUND, settingsErrorKindForStatus(404))
        assertEquals(SettingsErrorKind.BAD_GATEWAY, settingsErrorKindForStatus(502))
        assertEquals(SettingsErrorKind.SERVER_UNAVAILABLE, settingsErrorKindForStatus(503))
        assertEquals(SettingsErrorKind.RATE_LIMIT, settingsErrorKindForStatus(429))
    }

    @Test
    fun `maps DNS timeout and TLS failures separately`() {
        assertEquals(SettingsErrorKind.DNS, classifySettingsError(UnknownHostException()))
        assertEquals(SettingsErrorKind.TIMEOUT, classifySettingsError(SocketTimeoutException()))
        assertEquals(SettingsErrorKind.TLS, classifySettingsError(SSLHandshakeException("certificate")))
    }
}
