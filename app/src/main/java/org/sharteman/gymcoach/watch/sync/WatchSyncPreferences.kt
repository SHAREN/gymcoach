package org.sharteman.gymcoach.watch.sync

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

class WatchSyncPreferences(context: Context) : AutoCloseable {
    private val preferences = context.applicationContext.getSharedPreferences(
        "gymcoach-watch-sync",
        Context.MODE_PRIVATE,
    )
    private val mutableEnabled = MutableStateFlow(preferences.getBoolean(KEY_ENABLED, false))
    private val listener = SharedPreferences.OnSharedPreferenceChangeListener { shared, key ->
        if (key == KEY_ENABLED) mutableEnabled.value = shared.getBoolean(KEY_ENABLED, false)
    }

    val enabled: StateFlow<Boolean> = mutableEnabled.asStateFlow()

    init {
        preferences.registerOnSharedPreferenceChangeListener(listener)
    }

    fun setEnabled(enabled: Boolean) {
        preferences.edit().putBoolean(KEY_ENABLED, enabled).apply()
    }

    override fun close() {
        preferences.unregisterOnSharedPreferenceChangeListener(listener)
    }

    private companion object {
        const val KEY_ENABLED = "enabled"
    }
}
