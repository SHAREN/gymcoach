package org.sharteman.gymcoach.data.security

import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.security.KeyStore
import org.junit.Assert.assertFalse
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.sharteman.gymcoach.GymCoachApplication

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
        assertFalse((context.applicationContext as GymCoachApplication).repository.isLoggedIn)
    }

    @Test
    fun seedEncryptedAccountForUpgrade() {
        clearFixture()
        val store = SecureAccountStore(context)
        store.configureServerUrls(UNREACHABLE_SERVER_URL, null)
        store.userId = TEST_USER_ID
        store.userEmail = TEST_EMAIL
        store.setAccessToken(TEST_TOKEN)

        assertTrue(
            "The seed phase could not read its encrypted access token.",
            SecureAccountStore(context).getAccessToken() == TEST_TOKEN,
        )
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
        assertTrue((context.applicationContext as GymCoachApplication).repository.isLoggedIn)
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

    private fun accountPreferences() =
        context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

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
        const val TEST_TOKEN = "upgrade-regression-sentinel"
        const val TEST_USER_ID = "upgrade-regression-user"
        const val TEST_EMAIL = "upgrade-regression@example.invalid"
        const val UNREACHABLE_SERVER_URL = "http://127.0.0.1:65534"
    }
}
