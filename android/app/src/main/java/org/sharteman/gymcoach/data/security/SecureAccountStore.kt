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
    var userId: String?
    var userEmail: String?
    fun getAccessToken(): String?
    fun setAccessToken(token: String)
    fun clearAccessToken()
    fun clearAccount()
}

class SecureAccountStore(context: Context) : AccountStore {
    private val preferences = context.getSharedPreferences("gymcoach-account", Context.MODE_PRIVATE)

    override val deviceId: String
        get() = preferences.getString(KEY_DEVICE_ID, null) ?: UUID.randomUUID().toString().also {
            preferences.edit().putString(KEY_DEVICE_ID, it).apply()
        }

    override var serverUrl: String
        get() = preferences.getString(KEY_SERVER_URL, BuildConfig.DEFAULT_SERVER_URL)
            ?: BuildConfig.DEFAULT_SERVER_URL
        set(value) {
            preferences.edit().putString(KEY_SERVER_URL, normalizeServerUrl(value)).apply()
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
        preferences.edit().putString(KEY_TOKEN, encrypt(token)).apply()
    }

    override fun clearAccessToken() {
        preferences.edit().remove(KEY_TOKEN).apply()
    }

    override fun clearAccount() {
        preferences.edit().remove(KEY_TOKEN).remove(KEY_USER_ID).remove(KEY_EMAIL).apply()
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
        const val KEY_DEVICE_ID = "device-id"
        const val KEY_SERVER_URL = "server-url"
        const val KEY_USER_ID = "user-id"
        const val KEY_EMAIL = "email"
    }
}

fun normalizeServerUrl(value: String): String {
    val candidate = value.trim().trimEnd('/').let {
        if (it.startsWith("http://") || it.startsWith("https://")) it else "https://$it"
    }
    val url = candidate.toHttpUrlOrNull() ?: throw IllegalArgumentException("Invalid server URL.")
    if (url.scheme == "http" && (!BuildConfig.DEBUG || !isPrivateDevelopmentHost(url.host))) {
        throw IllegalArgumentException("HTTPS is required for this server.")
    }
    return url.toString().trimEnd('/')
}

private fun isPrivateDevelopmentHost(host: String): Boolean {
    if (host == "localhost" || host == "127.0.0.1" || host == "10.0.2.2") return true
    if (host.startsWith("192.168.")) return true
    if (host.startsWith("10.")) return true
    val parts = host.split('.')
    return parts.size == 4 && parts[0] == "172" && (parts[1].toIntOrNull() in 16..31)
}
