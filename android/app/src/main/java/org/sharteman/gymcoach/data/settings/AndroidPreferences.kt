package org.sharteman.gymcoach.data.settings

import android.content.Context
import org.sharteman.gymcoach.training.SetTableMetric
import org.sharteman.gymcoach.training.normalizeSetTableMetrics

enum class AppThemeMode { DARK, LIGHT, SYSTEM }

data class AndroidPreferenceState(
    val theme: AppThemeMode = AppThemeMode.DARK,
    val vibration: Boolean = true,
    val restTimerSound: Boolean = true,
    val readinessAutoRegulation: Boolean = true,
    val setTableMetrics: List<SetTableMetric> = listOf(SetTableMetric.ONE_RM),
)

class AndroidPreferences(context: Context) {
    private val appPreferences = context.applicationContext.getSharedPreferences(
        APP_PREFERENCES,
        Context.MODE_PRIVATE,
    )
    private val workoutPreferences = context.applicationContext.getSharedPreferences(
        WORKOUT_UI_PREFERENCES,
        Context.MODE_PRIVATE,
    )

    fun load(): AndroidPreferenceState = AndroidPreferenceState(
        theme = runCatching {
            AppThemeMode.valueOf(appPreferences.getString(KEY_THEME, AppThemeMode.DARK.name).orEmpty())
        }.getOrDefault(AppThemeMode.DARK),
        vibration = appPreferences.getBoolean(KEY_VIBRATION, true),
        restTimerSound = appPreferences.getBoolean(KEY_TIMER_SOUND, true),
        readinessAutoRegulation = appPreferences.getBoolean(KEY_READINESS, true),
        setTableMetrics = normalizeSetTableMetrics(
            workoutPreferences.getString(KEY_SET_TABLE_METRIC, null)
                ?.split(',')
                ?.mapNotNull { stored -> SetTableMetric.entries.firstOrNull { it.name == stored } },
        ),
    )

    fun save(state: AndroidPreferenceState) {
        appPreferences.edit()
            .putString(KEY_THEME, state.theme.name)
            .putBoolean(KEY_VIBRATION, state.vibration)
            .putBoolean(KEY_TIMER_SOUND, state.restTimerSound)
            .putBoolean(KEY_READINESS, state.readinessAutoRegulation)
            .apply()
        workoutPreferences.edit()
            .putString(KEY_SET_TABLE_METRIC, state.setTableMetrics.joinToString(",") { it.name })
            .apply()
    }

    fun registerThemeListener(listener: () -> Unit): AutoCloseable {
        val callback = android.content.SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
            if (key == KEY_THEME) listener()
        }
        appPreferences.registerOnSharedPreferenceChangeListener(callback)
        return AutoCloseable { appPreferences.unregisterOnSharedPreferenceChangeListener(callback) }
    }

    private companion object {
        const val APP_PREFERENCES = "gymcoach-app-preferences"
        const val WORKOUT_UI_PREFERENCES = "gymcoach-workout-ui"
        const val KEY_THEME = "theme"
        const val KEY_VIBRATION = "vibration"
        const val KEY_TIMER_SOUND = "rest-timer-sound"
        const val KEY_READINESS = "readiness-autoregulation"
        const val KEY_SET_TABLE_METRIC = "set-table-metric"
    }
}
