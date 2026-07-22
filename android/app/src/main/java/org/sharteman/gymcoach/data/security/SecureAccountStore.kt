package org.sharteman.gymcoach.data.security

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.sharteman.gymcoach.BuildConfig
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import java.security.KeyStore
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

interface AccountStore {
    val deviceId: String
    var serverUrl: String
    val sessionServerUrl: String?
        get() = null
    val primaryServerUrl: String
        get() = serverUrl
    var fallbackServerUrl: String?
        get() = null
        set(value) {
            value?.let(::normalizeOptionalServerUrl)
        }
    var userId: String?
    var userEmail: String?
    fun getAccessToken(): String?
    fun setAccessToken(token: String)
    fun clearAccessToken()
    fun clearAccount()
    fun configureServerUrls(primaryServerUrl: String, fallbackServerUrl: String?) {
        serverUrl = normalizeServerUrl(primaryServerUrl)
        this.fallbackServerUrl = normalizeOptionalServerUrl(fallbackServerUrl)
    }

    fun activateServerUrl(serverUrl: String) {
        this.serverUrl = normalizeServerUrl(serverUrl)
    }
}

class SecureAccountStore(context: Context) : AccountStore {
    private val preferences = context.getSharedPreferences("gymcoach-account", Context.MODE_PRIVATE)

    init {
        migrateLegacyServerSettings()
    }

    override val deviceId: String
        get() = preferences.getString(KEY_DEVICE_ID, null) ?: UUID.randomUUID().toString().also {
            preferences.edit().putString(KEY_DEVICE_ID, it).apply()
        }

    override var serverUrl: String
        get() = preferences.getString(KEY_ACTIVE_SERVER_URL, null)
            ?.let(::normalizeServerUrl)
            ?: primaryServerUrl
        set(value) {
            preferences.edit().putString(KEY_ACTIVE_SERVER_URL, normalizeServerUrl(value)).apply()
        }

    override val sessionServerUrl: String?
        get() = preferences.getString(KEY_SESSION_SERVER_URL, null)
            ?.let { runCatching { normalizeServerUrl(it) }.getOrNull() }

    override val primaryServerUrl: String
        get() = preferences.getString(KEY_SERVER_URL, BuildConfig.DEFAULT_SERVER_URL)
            ?.let(::normalizeServerUrl)
            ?: BuildConfig.DEFAULT_SERVER_URL

    override var fallbackServerUrl: String?
        get() = if (preferences.contains(KEY_FALLBACK_SERVER_URL)) {
            normalizeOptionalServerUrl(preferences.getString(KEY_FALLBACK_SERVER_URL, null))
        } else {
            BuildConfig.DEFAULT_FALLBACK_SERVER_URL
        }
        set(value) {
            val normalized = normalizeOptionalServerUrl(value)
            preferences.edit().putString(KEY_FALLBACK_SERVER_URL, normalized.orEmpty()).apply()
        }

    override var userId: String?
        get() = preferences.getString(KEY_USER_ID, null)
        set(value) {
            preferences.edit().putString(KEY_USER_ID, value).apply()
        }

    override var userEmail: String?
        get() = preferences.getString(KEY_EMAIL, null)
        set(value) {
            preferences.edit().putString(KEY_EMAIL, value).apply()
        }

    override fun getAccessToken(): String? {
        val encoded = preferences.getString(KEY_TOKEN, null) ?: return null
        return runCatching { decrypt(encoded) }.getOrNull()
    }

    override fun setAccessToken(token: String) {
        check(
            preferences.edit()
                .putString(KEY_TOKEN, encrypt(token))
                .putString(KEY_SESSION_SERVER_URL, serverUrl)
                .commit(),
        ) {
            "Failed to persist encrypted account state."
        }
    }

    override fun clearAccessToken() {
        check(
            preferences.edit()
                .remove(KEY_TOKEN)
                .remove(KEY_SESSION_SERVER_URL)
                .commit(),
        ) {
            "Failed to clear encrypted account state."
        }
    }

    override fun clearAccount() {
        check(
            preferences.edit()
                .remove(KEY_TOKEN)
                .remove(KEY_SESSION_SERVER_URL)
                .remove(KEY_USER_ID)
                .remove(KEY_EMAIL)
                .commit(),
        ) {
            "Failed to clear account state."
        }
    }

    override fun configureServerUrls(primaryServerUrl: String, fallbackServerUrl: String?) {
        val primary = normalizeServerUrl(primaryServerUrl)
        val fallback = normalizeOptionalServerUrl(fallbackServerUrl)?.takeUnless { it == primary }
        preferences.edit()
            .putString(KEY_SERVER_URL, primary)
            .putString(KEY_ACTIVE_SERVER_URL, primary)
            .putString(KEY_FALLBACK_SERVER_URL, fallback.orEmpty())
            .apply()
    }

    private fun migrateLegacyServerSettings() {
        if (preferences.contains(KEY_ACTIVE_SERVER_URL) || preferences.contains(KEY_FALLBACK_SERVER_URL)) {
            return
        }
        val hadStoredServer = preferences.contains(KEY_SERVER_URL)
        val legacyServer = preferences.getString(KEY_SERVER_URL, BuildConfig.DEFAULT_SERVER_URL)
            ?.let { runCatching { normalizeServerUrl(it) }.getOrNull() }
            ?: BuildConfig.DEFAULT_SERVER_URL
        val legacyUrl = legacyServer.toHttpUrlOrNull()
        val legacyPrivateHttp = hadStoredServer && legacyUrl?.scheme == "http" &&
            isPrivateDevelopmentHost(legacyUrl.host)
        val primary = if (legacyPrivateHttp) BuildConfig.DEFAULT_SERVER_URL else legacyServer
        val fallback = if (legacyPrivateHttp) legacyServer else BuildConfig.DEFAULT_FALLBACK_SERVER_URL
        preferences.edit()
            .putString(KEY_SERVER_URL, primary)
            .putString(KEY_ACTIVE_SERVER_URL, primary)
            .putString(KEY_FALLBACK_SERVER_URL, fallback)
            .apply()
    }

    private fun encrypt(value: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val combined = cipher.iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(combined, Base64.NO_WRAP)
    }

    private fun decrypt(encoded: String): String {
        val combined = Base64.decode(encoded, Base64.NO_WRAP)
        val iv = combined.copyOfRange(0, GCM_IV_BYTES)
        val encrypted = combined.copyOfRange(GCM_IV_BYTES, combined.size)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, iv))
        return cipher.doFinal(encrypted).toString(Charsets.UTF_8)
    }

    private fun secretKey(): SecretKey {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build(),
        )
        return generator.generateKey()
    }

    private companion object {
        const val KEY_ALIAS = "gymcoach-mobile-token"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val GCM_IV_BYTES = 12
        const val KEY_TOKEN = "access-token"
        const val KEY_SESSION_SERVER_URL = "session-server-url"
        const val KEY_DEVICE_ID = "device-id"
        const val KEY_SERVER_URL = "server-url"
        const val KEY_ACTIVE_SERVER_URL = "active-server-url"
        const val KEY_FALLBACK_SERVER_URL = "fallback-server-url"
        const val KEY_USER_ID = "user-id"
        const val KEY_EMAIL = "email"
    }
}

fun normalizeServerUrl(value: String): String {
    val candidate = value.trim().trimEnd('/').let {
        if (it.startsWith("http://") || it.startsWith("https://")) it else "https://$it"
    }
    val url = candidate.toHttpUrlOrNull() ?: throw IllegalArgumentException("Invalid server URL.")
    if (url.scheme == "http" && !isPrivateDevelopmentHost(url.host)) {
        throw IllegalArgumentException("HTTPS is required for this server.")
    }
    return url.toString().trimEnd('/')
}

fun normalizeOptionalServerUrl(value: String?): String? = value
    ?.trim()
    ?.takeIf { it.isNotEmpty() }
    ?.let(::normalizeServerUrl)

private fun isPrivateDevelopmentHost(host: String): Boolean {
    if (host == "localhost" || host == "127.0.0.1" || host == "10.0.2.2") return true
    if (host.startsWith("192.168.")) return true
    if (host.startsWith("10.")) return true
    val parts = host.split('.')
    return parts.size == 4 && parts[0] == "172" && (parts[1].toIntOrNull() in 16..31)
}
