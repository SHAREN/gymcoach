package org.sharteman.gymcoach.data.security

import android.app.Application
import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.security.KeyStore
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertFalse
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.sharteman.gymcoach.data.diagnostics.SettingsDiagnostics
import org.sharteman.gymcoach.data.diagnostics.SettingsRequestDiagnostic
import org.sharteman.gymcoach.data.local.GymCoachDatabase
import org.sharteman.gymcoach.data.network.ApiClient
import org.sharteman.gymcoach.data.repository.GymCoachRepository
import org.sharteman.gymcoach.data.settings.SettingsRepository

/**
 * Phase methods invoked separately by scripts/verify-android-auth-upgrade.ps1.
 * The target app is replaced with adb install -r between seed and verification.
 */
@RunWith(AndroidJUnit4::class)
class SecureAccountUpgradeTest {
    private val context: Context
        get() = InstrumentationRegistry.getInstrumentation().targetContext

    @Test
    fun verifyFreshInstallRequiresAuthentication() {
        assertNull(SecureAccountStore(context).getAccessToken())
        assertFalse(accountPreferences().contains(KEY_TOKEN))
    }

    @Test
    fun seedEncryptedAccountForUpgrade() {
        clearFixture()
        val store = SecureAccountStore(context)
        store.configureServerUrls(fixtureServerUrl(), null)
        store.userId = TEST_USER_ID
        store.userEmail = TEST_EMAIL
        store.setAccessToken(TEST_TOKEN)
        assertTrue(
            "The baseline fixture could not flush its encrypted account state.",
            accountPreferences().edit().putBoolean(KEY_FIXTURE_READY, true).commit(),
        )

        assertTrue(
            "The seed phase could not read its encrypted access token.",
            SecureAccountStore(context).getAccessToken() == TEST_TOKEN,
        )
        val diagnostics = SettingsDiagnostics.create(context)
        assertTrue(diagnostics.clear())
        diagnostics.recordRequest(
            SettingsRequestDiagnostic(
                attemptId = DIAGNOSTIC_ATTEMPT_ID,
                correlationId = DIAGNOSTIC_CORRELATION_ID,
                subrequest = "bootstrap",
                origin = fixtureServerUrl(),
                path = "/api/mobile/bootstrap",
                method = "GET",
                statusCode = 200,
                category = DIAGNOSTIC_SEEDED_CATEGORY,
                durationMs = 1,
            ),
        )
        assertDiagnosticEvidence(expectMigration = false)
    }

    @Test
    fun seedLegacyAccountWithoutSessionAuthorityForUpgrade() {
        seedEncryptedAccountForUpgrade()
        assertTrue(accountPreferences().edit().remove(KEY_SESSION_SERVER_URL).commit())
        assertNull(SecureAccountStore(context).sessionServerUrl)
        assertEquals(TEST_TOKEN, SecureAccountStore(context).getAccessToken())
    }

    @Test
    fun verifyEncryptedAccountAfterUpgrade() {
        val restored = SecureAccountStore(context)

        assertTrue(
            "Encrypted account preference was removed during the in-place update.",
            accountPreferences().contains(KEY_TOKEN),
        )
        assertTrue(
            "AndroidKeyStore account key was removed during the in-place update.",
            accountKeyExists(),
        )
        assertTrue(
            "The encrypted access token was not readable after the update.",
            restored.getAccessToken() == TEST_TOKEN,
        )
        assertEquals(TEST_USER_ID, restored.userId)
        assertEquals(TEST_EMAIL, restored.userEmail)
        assertEquals(Application::class.java, context.applicationContext.javaClass)
    }

    @Test
    fun migrateLegacyAuthorityThroughProductionSettingsRepository() {
        verifyEncryptedAccountAfterUpgrade()
        val legacy = SecureAccountStore(context)
        assertNull(legacy.sessionServerUrl)

        val profile = runBlocking { SettingsRepository.create(context).loadProfile() }
        val recovered = SecureAccountStore(context)

        assertEquals(TEST_EMAIL, profile.email)
        assertEquals(TEST_TOKEN, recovered.getAccessToken())
        assertEquals(fixtureServerUrl(), recovered.primaryServerUrl)
        assertEquals(fixtureServerUrl(), recovered.serverUrl)
        assertEquals(fixtureServerUrl(), recovered.sessionServerUrl)
        assertEquals(TEST_USER_ID, recovered.userId)
        assertEquals(TEST_EMAIL, recovered.userEmail)
        assertDiagnosticEvidence(expectMigration = true)
    }

    @Test
    fun verifyRecoveredAuthorityAndDiagnosticsAfterRestartOrUpdate() {
        verifyEncryptedAccountAfterUpgrade()
        val recovered = SecureAccountStore(context)

        assertEquals(fixtureServerUrl(), recovered.primaryServerUrl)
        assertEquals(fixtureServerUrl(), recovered.serverUrl)
        assertEquals(fixtureServerUrl(), recovered.sessionServerUrl)
        assertDiagnosticEvidence(expectMigration = true)
    }

    @Test
    fun verifyDiagnosticsSurviveProductionLogout() {
        verifyRecoveredAuthorityAndDiagnosticsAfterRestartOrUpdate()
        val beforeLogout = SettingsDiagnostics.create(context).snapshot().map { it.eventId }.toSet()
        val accountStore = SecureAccountStore(context)
        val repository = GymCoachRepository(
            dao = GymCoachDatabase.get(context).dao(),
            accountStore = accountStore,
            api = ApiClient(),
            scheduleSyncNow = {},
            schedulePeriodicSync = {},
        )

        runBlocking { repository.logout() }

        assertNull(accountStore.getAccessToken())
        assertNull(accountStore.userId)
        assertNull(accountStore.userEmail)
        val afterLogout = SettingsDiagnostics.create(context).snapshot()
        assertTrue(afterLogout.isNotEmpty())
        assertTrue(afterLogout.map { it.eventId }.toSet().containsAll(beforeLogout))
        assertDiagnosticEvidence(expectMigration = true)
    }

    @Test
    fun corruptEncryptedAccountFailsClosedAfterUpgrade() {
        val store = SecureAccountStore(context)
        assertTrue(
            "The upgrade fixture was unavailable before corruption.",
            store.getAccessToken() == TEST_TOKEN,
        )
        accountPreferences().edit().putString(KEY_TOKEN, "corrupt-upgrade-state").commit()

        assertNull(SecureAccountStore(context).getAccessToken())
        clearFixture()
    }

    @Test
    fun legacySessionAuthorityRecoverySurvivesStoreRecreation() {
        clearFixture()
        val legacy = SecureAccountStore(context)
        legacy.configureServerUrls(fixtureServerUrl(), null)
        legacy.userId = TEST_USER_ID
        legacy.userEmail = TEST_EMAIL
        legacy.setAccessToken(TEST_TOKEN)
        assertTrue(accountPreferences().edit().remove(KEY_SESSION_SERVER_URL).commit())
        assertNull(SecureAccountStore(context).sessionServerUrl)

        runBlocking { SettingsRepository.create(context).loadProfile() }
        val restarted = SecureAccountStore(context)

        assertEquals(TEST_TOKEN, restarted.getAccessToken())
        assertEquals(fixtureServerUrl(), restarted.sessionServerUrl)
        assertEquals(TEST_USER_ID, restarted.userId)
        assertEquals(TEST_EMAIL, restarted.userEmail)
        clearFixture()
    }

    private fun accountPreferences() =
        context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

    private fun fixtureServerUrl(): String = requireNotNull(
        InstrumentationRegistry.getArguments().getString(ARG_SERVER_URL),
    ) { "The production bootstrap fixture URL was not supplied." }

    private fun assertDiagnosticEvidence(expectMigration: Boolean) {
        val events = SettingsDiagnostics.create(context).snapshot()
        assertTrue(events.any { it.correlationId == DIAGNOSTIC_CORRELATION_ID })
        assertTrue(events.any { it.category == DIAGNOSTIC_SEEDED_CATEGORY })
        if (expectMigration) {
            assertTrue(events.any { it.category == "legacy-authority-restored" })
        }
    }

    private fun clearFixture() {
        accountPreferences().edit().clear().commit()
        KeyStore.getInstance("AndroidKeyStore").apply {
            load(null)
            if (containsAlias(KEY_ALIAS)) deleteEntry(KEY_ALIAS)
        }
    }

    private fun accountKeyExists(): Boolean = KeyStore.getInstance("AndroidKeyStore").run {
        load(null)
        containsAlias(KEY_ALIAS)
    }

    private companion object {
        const val PREFERENCES_NAME = "gymcoach-account"
        const val KEY_ALIAS = "gymcoach-mobile-token"
        const val KEY_TOKEN = "access-token"
        const val KEY_SESSION_SERVER_URL = "session-server-url"
        const val KEY_FIXTURE_READY = "auth-upgrade-fixture-ready"
        const val TEST_TOKEN = "upgrade-regression-sentinel"
        const val TEST_USER_ID = "upgrade-regression-user"
        const val TEST_EMAIL = "upgrade-regression@example.invalid"
        const val ARG_SERVER_URL = "serverUrl"
        const val DIAGNOSTIC_ATTEMPT_ID = "upgrade-diagnostics-attempt"
        const val DIAGNOSTIC_CORRELATION_ID = "upgrade-diagnostics-correlation"
        const val DIAGNOSTIC_SEEDED_CATEGORY = "upgrade-fixture-seeded"
    }
}
