package org.sharteman.gymcoach.data.settings

import android.content.Context
import org.sharteman.gymcoach.data.security.SecureAccountStore

class SettingsRepository(
    private val remote: SettingsDataSource,
) : SettingsDataSource by remote {
    companion object {
        fun create(context: Context): SettingsRepository {
            val account = SecureAccountStore(context.applicationContext)
            val token = account.getAccessToken()
                ?: throw SettingsException(SettingsErrorKind.AUTHENTICATION)
            return SettingsRepository(SettingsApi(account.serverUrl, token))
        }
    }
}
