package org.sharteman.gymcoach.ui

import android.content.Intent
import android.net.Uri
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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import kotlinx.coroutines.launch
import org.sharteman.gymcoach.BuildConfig
import org.sharteman.gymcoach.data.repository.GymCoachRepository
import org.sharteman.gymcoach.data.repository.MobileAuthenticationRequiredException
import org.sharteman.gymcoach.data.network.androidDownloadUrl

@Composable
fun GymCoachApp(repository: GymCoachRepository) {
    var loggedIn by remember { mutableStateOf(repository.isLoggedIn) }
    if (!loggedIn) {
        LoginScreen(repository = repository, onLoggedIn = { loggedIn = true })
        return
    }

    val navController = rememberNavController()
    val context = LocalContext.current
    val bootstrap by repository.bootstrap.collectAsState(initial = null)
    val openSessions by repository.openSessions.collectAsState(initial = emptyList())
    val progress by repository.progress.collectAsState(initial = null)
    val pendingCount by repository.pendingCount.collectAsState(initial = 0)
    val syncIssue by repository.syncIssue.collectAsState(initial = null)
    val online by rememberIsOnline()
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    var syncing by remember { mutableStateOf(false) }
    var progressRefreshing by remember { mutableStateOf(false) }
    var webStartPath by rememberSaveable { mutableStateOf("/") }
    val syncFailedMessage = stringResource(org.sharteman.gymcoach.R.string.sync_error)
    val syncBlockedMessage = stringResource(org.sharteman.gymcoach.R.string.sync_blocked)
    val openProgress: (String?) -> Unit = { exerciseId ->
        val route = exerciseId?.let { "progress?exerciseId=${Uri.encode(it)}" } ?: "progress"
        navController.navigate(route)
        if (online) {
            scope.launch {
                progressRefreshing = true
                runCatching { repository.refreshProgress() }
                    .onFailure { snackbar.showSnackbar(it.message ?: syncFailedMessage) }
                progressRefreshing = false
            }
        }
    }

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
        NavHost(navController = navController, startDestination = "web") {
            composable("home") {
                HomeScreen(
                bootstrap = bootstrap,
                    openSessions = openSessions,
                    pendingCount = pendingCount,
                    syncIssue = syncIssue,
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
                    onRetrySyncIssue = {
                        scope.launch { repository.retryBlockedChange() }
                    },
                    onDiscardSyncIssue = {
                        scope.launch { repository.discardBlockedChange() }
                    },
                onProgress = { openProgress(null) },
                onWebPanel = {
                    webStartPath = "/"
                    navController.navigate("web")
                },
                currentVersion = BuildConfig.VERSION_NAME,
                onDownloadUpdate = {
                    runCatching {
                        context.startActivity(
                            Intent(
                                Intent.ACTION_VIEW,
                                Uri.parse(androidDownloadUrl(repository.serverUrl)),
                            ),
                        )
                    }
                },
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
                route = "progress?exerciseId={exerciseId}",
                arguments = listOf(
                    navArgument("exerciseId") {
                        type = NavType.StringType
                        nullable = true
                        defaultValue = null
                    },
                ),
            ) { entry ->
                ProgressScreen(
                    snapshot = progress,
                    unit = bootstrap?.profile?.unit ?: "KG",
                    initialExerciseId = entry.arguments?.getString("exerciseId"),
                    refreshing = progressRefreshing,
                    onRefresh = {
                        if (online && !progressRefreshing) {
                            scope.launch {
                                progressRefreshing = true
                                runCatching { repository.refreshProgress() }
                                    .onFailure { snackbar.showSnackbar(it.message ?: syncFailedMessage) }
                                progressRefreshing = false
                            }
                        }
                    },
                    onBack = { navController.popBackStack() },
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
                    online = online,
                    onAskCoach = {
                        webStartPath = "/chat?sessionId=${Uri.encode(entry.arguments?.getString("sessionId").orEmpty())}"
                        navController.navigate("web")
                    },
                    onOpenProgress = { exerciseId -> openProgress(exerciseId) },
                    onOpenHistory = { historySessionId ->
                        webStartPath = "/history/${Uri.encode(historySessionId)}"
                        navController.navigate("web")
                    },
                    onExit = { navController.popBackStack() },
                )
            }
            composable("web") {
                WebPanelScreen(
                    repository = repository,
                    online = online,
                    startPath = webStartPath,
                ) {
                    if (!navController.popBackStack()) navController.navigate("home")
                }
            }
        }
        SnackbarHost(hostState = snackbar)
    }
}
