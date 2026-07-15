package org.sharteman.gymcoach.watch.ui.diagnostics

import android.content.Context
import org.sharteman.gymcoach.R
import org.sharteman.gymcoach.ui.WatchDiagnosticsDestination

object WatchDiagnosticsFeature {
    fun create(context: Context): WatchDiagnosticsDestination = WatchDiagnosticsDestination(
        settingsLabel = context.getString(R.string.watch_diagnostics_settings_label),
        content = { onBack -> WatchDiagnosticsRoute(onBack) },
    )
}
