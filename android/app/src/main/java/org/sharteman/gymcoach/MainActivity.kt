package org.sharteman.gymcoach

import android.graphics.Color
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import org.sharteman.gymcoach.data.settings.AndroidPreferences
import org.sharteman.gymcoach.data.settings.AppThemeMode
import org.sharteman.gymcoach.ui.GymCoachApp
import org.sharteman.gymcoach.ui.WorkoutScreenPreview
import org.sharteman.gymcoach.ui.settings.SettingsScreen
import org.sharteman.gymcoach.ui.theme.GymCoachTheme
import org.sharteman.gymcoach.watch.ui.diagnostics.WatchDiagnosticsFeature

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val repository = (application as GymCoachApplication).repository
        val workoutPreview = BuildConfig.DEBUG &&
            intent.getBooleanExtra("workout_preview", false)
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
        )
        setContent {
            if (workoutPreview) {
                GymCoachTheme(darkTheme = true) { WorkoutScreenPreview() }
            } else {
                val preferences = remember { AndroidPreferences(applicationContext) }
                val watchDiagnosticsDestination = remember {
                    WatchDiagnosticsFeature.create(applicationContext)
                }
                var preferenceState by remember { mutableStateOf(preferences.load()) }
                DisposableEffect(preferences) {
                    val registration = preferences.registerThemeListener {
                        preferenceState = preferences.load()
                    }
                    onDispose { registration.close() }
                }
                val darkTheme = when (preferenceState.theme) {
                    AppThemeMode.DARK -> true
                    AppThemeMode.LIGHT -> false
                    AppThemeMode.SYSTEM -> isSystemInDarkTheme()
                }
                GymCoachTheme(darkTheme = darkTheme) {
                    GymCoachApp(
                        repository = repository,
                        watchDiagnosticsDestination = watchDiagnosticsDestination,
                    ) { onBack, onOpenWebPath, onAuthenticationRequired, watchDiagnosticsLabel,
                        onOpenWatchDiagnostics ->
                        SettingsScreen(
                            onBack = onBack,
                            onOpenWebPath = onOpenWebPath,
                            onAuthenticationRequired = onAuthenticationRequired,
                            appRepository = repository,
                            watchDiagnosticsLabel = watchDiagnosticsLabel,
                            onOpenWatchDiagnostics = onOpenWatchDiagnostics,
                        )
                    }
                }
            }
        }
    }
}
