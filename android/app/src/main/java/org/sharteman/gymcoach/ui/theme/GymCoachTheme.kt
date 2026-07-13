package org.sharteman.gymcoach.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val colors = lightColorScheme(
    primary = Color(0xFF176B4D),
    onPrimary = Color.White,
    primaryContainer = Color(0xFFD7F2E5),
    onPrimaryContainer = Color(0xFF0B3B2A),
    secondary = Color(0xFFB23A32),
    onSecondary = Color.White,
    background = Color(0xFFF7F8FA),
    surface = Color.White,
    surfaceVariant = Color(0xFFE8ECEF),
    onSurface = Color(0xFF202427),
    onSurfaceVariant = Color(0xFF596167),
    outline = Color(0xFFB9C0C5),
    error = Color(0xFFB3261E),
)

@Composable
fun GymCoachTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = colors, content = content)
}
