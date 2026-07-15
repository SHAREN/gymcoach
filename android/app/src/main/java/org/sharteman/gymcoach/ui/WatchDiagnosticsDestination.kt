package org.sharteman.gymcoach.ui

import androidx.compose.runtime.Composable

data class WatchDiagnosticsDestination(
    val settingsLabel: String,
    val content: @Composable (onBack: () -> Unit) -> Unit,
)
