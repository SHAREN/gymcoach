package org.sharteman.gymcoach.ui

import android.content.Context
import android.content.res.Configuration
import java.util.Locale

internal fun historyLocaleContext(context: Context): Context {
    val locale = Locale.getDefault()
    val configuredLocale = context.resources.configuration.locales[0]
    if (configuredLocale == locale) return context
    return context.createConfigurationContext(
        Configuration(context.resources.configuration).apply { setLocale(locale) },
    )
}

internal fun formatHistoryDuration(value: Int?): String {
    val seconds = value ?: return "-"
    val hours = seconds / 3_600
    val minutes = (seconds % 3_600) / 60
    val remainingSeconds = seconds % 60
    return if (hours > 0) {
        "%d:%02d:%02d".format(Locale.ROOT, hours, minutes, remainingSeconds)
    } else {
        "%d:%02d".format(Locale.ROOT, minutes, remainingSeconds)
    }
}

internal fun formatHistoryDistance(
    value: Double?,
    kilometerUnit: String,
    meterUnit: String,
): String = when {
    value == null || value <= 0 -> "-"
    value >= 1_000 -> "%s %s".format(
        String.format(Locale.getDefault(), "%.2f", value / 1_000.0),
        kilometerUnit,
    )
    else -> "%d %s".format(value.toInt(), meterUnit)
}
