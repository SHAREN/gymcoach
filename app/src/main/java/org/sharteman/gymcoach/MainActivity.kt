package org.sharteman.gymcoach

import android.graphics.Color
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import org.sharteman.gymcoach.ui.GymCoachApp
import org.sharteman.gymcoach.ui.WorkoutScreenPreview
import org.sharteman.gymcoach.ui.theme.GymCoachTheme

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
                GymCoachTheme(darkTheme = true) { GymCoachApp(repository) }
            }
        }
    }
}
