package org.sharteman.gymcoach

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import org.sharteman.gymcoach.ui.GymCoachApp
import org.sharteman.gymcoach.ui.theme.GymCoachTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val repository = (application as GymCoachApplication).repository
        setContent {
            GymCoachTheme {
                GymCoachApp(repository)
            }
        }
    }
}
