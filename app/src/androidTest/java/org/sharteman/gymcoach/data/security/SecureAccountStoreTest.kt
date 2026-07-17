package org.sharteman.gymcoach.data.security

import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.security.KeyStore
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SecureAccountStoreTest {
    private val context: Context
        get() = InstrumentationRegistry.getInstrumentation().targetContext

    @Before
    fun resetBeforeTest() {
        clearAccountFixture()
    }

    @After
    fun resetAfterTest() {
        clearAccountFixture()
    }

    @Test
    fun encryptedAccountSurvivesStoreRecreation() {
        val original = SecureAccountStore(context)
        original.configureServerUrls(UNREACHABLE_SERVER_URL, null)
        original.userId = TEST_USER_ID
        original.userEmail = TEST_EMAIL
        original.setAccessToken(TEST_TOKEN)

        val restored = SecureAccountStore(context)

        assertTrue(
            "The encrypted access token was not restored.",
            restored.getAccessToken() == TEST_TOKEN,
        )
        assertEquals(TEST_USER_ID, restored.userId)
        assertEquals(TEST_EMAIL, restored.userEmail)
        assertEquals(UNREACHABLE_SERVER_URL, restored.serverUrl)
    }

    @Test
    fun corruptEncryptedTokenFailsClosed() {
        val store = SecureAccountStore(context)
        store.setAccessToken(TEST_TOKEN)
        accountPreferences().edit().putString(KEY_TOKEN, "not-valid-base64").commit()

        assertNull(SecureAccountStore(context).getAccessToken())
    }

    @Test
    fun missingDeviceKeyFailsClosed() {
        val store = SecureAccountStore(context)
        store.setAccessToken(TEST_TOKEN)
        deleteAccountKey()

        assertNull(SecureAccountStore(context).getAccessToken())
    }

    @Test
    fun explicitAccountClearRemovesAuthenticationOnly() {
        val store = SecureAccountStore(context)
        val deviceId = store.deviceId
        store.configureServerUrls(UNREACHABLE_SERVER_URL, null)
        store.userId = TEST_USER_ID
        store.userEmail = TEST_EMAIL
        store.setAccessToken(TEST_TOKEN)

        store.clearAccount()

        val cleared = SecureAccountStore(context)
        assertNull(cleared.getAccessToken())
        assertNull(cleared.userId)
        assertNull(cleared.userEmail)
        assertEquals(deviceId, cleared.deviceId)
        assertEquals(UNREACHABLE_SERVER_URL, cleared.serverUrl)
    }

    private fun accountPreferences() =
        context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

    private fun clearAccountFixture() {
        accountPreferences().edit().clear().commit()
        deleteAccountKey()
    }

    private fun deleteAccountKey() {
        KeyStore.getInstance("AndroidKeyStore").apply {
            load(null)
            if (containsAlias(KEY_ALIAS)) deleteEntry(KEY_ALIAS)
        }
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
