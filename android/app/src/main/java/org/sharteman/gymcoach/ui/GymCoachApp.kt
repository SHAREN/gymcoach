package org.sharteman.gymcoach.ui

import android.webkit.CookieManager
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import kotlinx.coroutines.launch
import org.sharteman.gymcoach.data.repository.GymCoachRepository
import org.sharteman.gymcoach.data.repository.MobileAuthenticationRequiredException

@Composable
fun GymCoachApp(repository: GymCoachRepository) {
    var loggedIn by remember { mutableStateOf(repository.isLoggedIn) }
    if (!loggedIn) {
        LoginScreen(repository = repository, onLoggedIn = { loggedIn = true })
        return
    }

    val navController = rememberNavController()
    val bootstrap by repository.bootstrap.collectAsState(initial = null)
    val openSessions by repository.openSessions.collectAsState(initial = emptyList())
    val pendingCount by repository.pendingCount.collectAsState(initial = 0)
    val online by rememberIsOnline()
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    var syncing by remember { mutableStateOf(false) }
    val syncFailedMessage = stringResource(org.sharteman.gymcoach.R.string.sync_error)
    val syncBlockedMessage = stringResource(org.sharteman.gymcoach.R.string.sync_blocked)

    LaunchedEffect(online) {
        if (online) {
            syncing = true
            runCatching { repository.syncPending() }
                .onSuccess { if (!it) snackbar.showSnackbar(syncBlockedMessage) }
                .onFailure {
                    if (it is MobileAuthenticationRequiredException) loggedIn = false
                    else snackbar.showSnackbar(it.message ?: syncFailedMessage)
                }
            syncing = false
        }
    }

    Box(Modifier.fillMaxSize()) {
        NavHost(navController = navController, startDestination = "home") {
            composable("home") {
                HomeScreen(
                bootstrap = bootstrap,
                openSessions = openSessions,
                pendingCount = pendingCount,
                online = online,
                syncing = syncing,
                onStartWorkout = { workout, gymId ->
                    scope.launch {
                        val sessionId = repository.startWorkout(workout, gymId)
                        navController.navigate("session/$sessionId")
                    }
                },
                onSync = {
                    scope.launch {
                        syncing = true
                        runCatching { repository.syncPending() }
                            .onSuccess { if (!it) snackbar.showSnackbar(syncBlockedMessage) }
                            .onFailure {
                                if (it is MobileAuthenticationRequiredException) loggedIn = false
                                else snackbar.showSnackbar(it.message ?: syncFailedMessage)
                            }
                        syncing = false
                    }
                },
                onWebPanel = { navController.navigate("web") },
                onLogout = {
                    scope.launch {
                        repository.logout()
                        CookieManager.getInstance().removeAllCookies(null)
                        loggedIn = false
                    }
                },
                )
            }
            composable(
                route = "session/{sessionId}",
                arguments = listOf(navArgument("sessionId") { type = NavType.StringType }),
            ) { entry ->
                WorkoutScreen(
                    repository = repository,
                    sessionId = entry.arguments?.getString("sessionId").orEmpty(),
                    bootstrap = bootstrap,
                    onExit = { navController.popBackStack() },
                )
            }
            composable("web") {
                WebPanelScreen(repository = repository, online = online) {
                    navController.popBackStack()
                }
            }
        }
        SnackbarHost(hostState = snackbar)
    }
}
