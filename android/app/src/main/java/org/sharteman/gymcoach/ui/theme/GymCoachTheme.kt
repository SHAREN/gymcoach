package org.sharteman.gymcoach.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val colors = lightColorScheme(
    primary = Color(0xFF171717),
    onPrimary = Color.White,
    primaryContainer = Color(0xFFE9E9E9),
    onPrimaryContainer = Color(0xFF171717),
    secondary = Color(0xFF4B5563),
    onSecondary = Color(0xFFFFFFFF),
    background = Color(0xFFFAFAFA),
    surface = Color(0xFFFFFFFF),
    surfaceVariant = Color(0xFFF1F1F1),
    onSurface = Color(0xFF171717),
    onSurfaceVariant = Color(0xFF666666),
    outline = Color(0xFFD1D1D1),
    error = Color(0xFFB3261E),
)

private val darkColors = darkColorScheme(
    primary = Color(0xFFF2F2F2),
    onPrimary = Color(0xFF171717),
    primaryContainer = Color(0xFF2A2A2A),
    onPrimaryContainer = Color(0xFFF2F2F2),
    secondary = Color(0xFFCACACA),
    onSecondary = Color(0xFF171717),
    background = Color(0xFF090B0A),
    surface = Color(0xFF0F1110),
    surfaceVariant = Color(0xFF242625),
    onSurface = Color(0xFFF1F1F1),
    onSurfaceVariant = Color(0xFFA9AAA9),
    outline = Color(0xFF4A4D4B),
    error = Color(0xFFFFB4AB),
)

@Composable
fun GymCoachTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(colorScheme = if (darkTheme) darkColors else colors, content = content)
}
