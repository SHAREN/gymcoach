package org.sharteman.gymcoach.ui

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
import org.sharteman.gymcoach.R
import org.sharteman.gymcoach.data.offline.OfflineRuntime
import org.sharteman.gymcoach.data.repository.GymCoachRepository
import org.sharteman.gymcoach.data.repository.MobileAuthenticationRequiredException
import org.sharteman.gymcoach.data.repository.SyncIssue
import org.sharteman.gymcoach.data.repository.syncIssueKind
import org.sharteman.gymcoach.data.security.SecureAccountStore
import org.sharteman.gymcoach.ui.coach.ChatScreen
import org.sharteman.gymcoach.ui.coach.CoachScreen
import org.sharteman.gymcoach.ui.programs.ExerciseCatalogScreen
import org.sharteman.gymcoach.ui.programs.ProgramsScreen

private const val HOME_ROUTE = "home"
private const val WEB_ROUTE = "web"
private const val SETTINGS_ROUTE = "settings"

@Composable
fun GymCoachApp(
    repository: GymCoachRepository,
    settingsContent: (@Composable (
        onBack: () -> Unit,
        onOpenWebPath: (String) -> Unit,
    ) -> Unit)? = null,
) {
    var loggedIn by remember { mutableStateOf(repository.isLoggedIn) }
    if (!loggedIn) {
        LoginScreen(repository = repository, onLoggedIn = { loggedIn = true })
        return
    }

    val navController = rememberNavController()
    val context = LocalContext.current
    val accountStore = remember(context, loggedIn) { SecureAccountStore(context.applicationContext) }
    val accessToken = remember(accountStore, loggedIn) { accountStore.getAccessToken() }
    val bootstrap by repository.bootstrap.collectAsState(initial = null)
    val openSessions by repository.openSessions.collectAsState(initial = emptyList())
    val progress by repository.progress.collectAsState(initial = null)
    val pendingCount by repository.pendingCount.collectAsState(initial = 0)
    val syncIssue by repository.syncIssue.collectAsState(initial = null)
    val offlinePendingFlow = remember(loggedIn) { OfflineRuntime.pendingCount() }
    val offlineIssuesFlow = remember(loggedIn) { OfflineRuntime.issues() }
    val offlinePendingCount by offlinePendingFlow.collectAsState(initial = 0)
    val offlineIssues by offlineIssuesFlow.collectAsState(initial = emptyList())
    val offlineIssue = offlineIssues.firstOrNull()
    val displayedSyncIssue = syncIssue ?: offlineIssue?.let {
        SyncIssue(
            operationId = it.operationId,
            message = it.message,
            kind = syncIssueKind(it.message),
            canRetry = true,
        )
    }
    val totalPendingCount = pendingCount + offlinePendingCount
    val online by rememberIsOnline()
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    var syncing by remember { mutableStateOf(false) }
    var progressRefreshing by remember { mutableStateOf(false) }
    var webStartPath by rememberSaveable { mutableStateOf("/") }
    val syncFailedMessage = stringResource(R.string.sync_error)
    val syncBlockedMessage = stringResource(R.string.sync_blocked)
    val readinessSavedMessage = stringResource(R.string.readiness_saved)

    suspend fun syncAllPending(): Boolean {
        val workoutAccepted = repository.syncPending()
        val offlineAccepted = OfflineRuntime.syncPending()
        return workoutAccepted && offlineAccepted
    }

    fun openWebPath(path: String) {
        webStartPath = path
        navController.navigate(WEB_ROUTE)
    }

    fun returnHome() {
        navController.navigate(HOME_ROUTE) {
            popUpTo(HOME_ROUTE) { inclusive = false }
            launchSingleTop = true
        }
    }

    val openProgress: (String?) -> Unit = { exerciseId ->
        val route = exerciseId?.let { "progress?exerciseId=${Uri.encode(it)}" } ?: "progress"
        navController.navigate(route)
        if (online) {
            scope.launch {
                progressRefreshing = true
                runCatching { repository.refreshProgress(exerciseId) }
                    .onFailure { snackbar.showSnackbar(it.message ?: syncFailedMessage) }
                progressRefreshing = false
            }
        }
    }

    LaunchedEffect(online) {
        if (online) {
            syncing = true
            runCatching { syncAllPending() }
                .onSuccess { if (!it) snackbar.showSnackbar(syncBlockedMessage) }
                .onFailure {
                    if (it is MobileAuthenticationRequiredException) loggedIn = false
                    else snackbar.showSnackbar(it.message ?: syncFailedMessage)
                }
            syncing = false
        }
    }

    Box(Modifier.fillMaxSize()) {
        NavHost(navController = navController, startDestination = HOME_ROUTE) {
            composable(HOME_ROUTE) {
                HomeScreen(
                    email = repository.email,
                    bootstrap = bootstrap,
                    openSessions = openSessions,
                    pendingCount = totalPendingCount,
                    syncIssue = displayedSyncIssue,
                    online = online,
                    syncing = syncing,
                    onOpenSession = { sessionId -> navController.navigate("session/$sessionId") },
                    onStartWorkout = { workout, gymId ->
                        scope.launch {
                            val sessionId = repository.startWorkout(workout, gymId)
                            navController.navigate("session/$sessionId")
                        }
                    },
                    onSync = {
                        scope.launch {
                            syncing = true
                            runCatching { syncAllPending() }
                                .onSuccess { if (!it) snackbar.showSnackbar(syncBlockedMessage) }
                                .onFailure {
                                    if (it is MobileAuthenticationRequiredException) loggedIn = false
                                    else snackbar.showSnackbar(it.message ?: syncFailedMessage)
                                }
                            syncing = false
                        }
                    },
                    onRetrySyncIssue = {
                        scope.launch {
                            syncing = true
                            runCatching {
                                if (syncIssue != null) {
                                    repository.retryBlockedChange()
                                } else {
                                    offlineIssue?.let { OfflineRuntime.controller()?.retry(it.operationId) }
                                }
                                syncAllPending()
                            }
                                .onSuccess { if (!it) snackbar.showSnackbar(syncBlockedMessage) }
                                .onFailure {
                                    if (it is MobileAuthenticationRequiredException) loggedIn = false
                                    else snackbar.showSnackbar(it.message ?: syncFailedMessage)
                                }
                            syncing = false
                        }
                    },
                    onDiscardSyncIssue = {
                        scope.launch {
                            runCatching {
                                if (syncIssue != null) {
                                    repository.discardBlockedChange()
                                } else {
                                    offlineIssue?.let { OfflineRuntime.controller()?.discard(it.operationId) }
                                }
                            }
                                .onFailure { snackbar.showSnackbar(it.message ?: syncFailedMessage) }
                        }
                    },
                    onSaveReadiness = { readiness, sleepQuality, note ->
                        if (!online) {
                            false
                        } else {
                            runCatching { repository.saveReadiness(readiness, sleepQuality, note) }
                                .onSuccess { snackbar.showSnackbar(readinessSavedMessage) }
                                .onFailure { snackbar.showSnackbar(it.message ?: syncFailedMessage) }
                                .isSuccess
                        }
                    },
                    onPrograms = { navController.navigate("programs") },
                    onExerciseCatalog = { navController.navigate("exercises") },
                    onHistory = { navController.navigate("history") },
                    onProgress = { openProgress(null) },
                    onCoach = { navController.navigate("coach") },
                    onChat = { navController.navigate("chat") },
                    onSettings = { navController.navigate(SETTINGS_ROUTE) },
                    onWebPanel = { openWebPath("/") },
                    currentVersion = BuildConfig.VERSION_NAME,
                    onDownloadUpdate = { navController.navigate(SETTINGS_ROUTE) },
                    onLogout = {
                        scope.launch {
                            repository.logout()
                            CookieManager.getInstance().removeAllCookies(null)
                            loggedIn = false
                        }
                    },
                )
            }
            composable("programs") {
                if (accessToken == null) {
                    LaunchedEffect(Unit) { loggedIn = false }
                } else {
                    ProgramsScreen(
                        baseUrl = repository.serverUrl,
                        token = accessToken,
                        onBack = { navController.popBackStack() },
                        onOpenWebPath = { path -> openWebPath(path) },
                    )
                }
            }
            composable("exercises") {
                if (accessToken == null) {
                    LaunchedEffect(Unit) { loggedIn = false }
                } else {
                    LaunchedEffect(online) {
                        if (online) {
                            runCatching { repository.refreshBootstrap() }
                                .onFailure { snackbar.showSnackbar(it.message ?: syncFailedMessage) }
                        }
                    }
                    ExerciseCatalogScreen(
                        baseUrl = repository.serverUrl,
                        token = accessToken,
                        onBack = { navController.popBackStack() },
                        historyByExerciseId = bootstrap?.exerciseHistoryByExerciseId.orEmpty(),
                        progressPointsByExerciseId = progress?.exercises
                            ?.associate { it.id to it.points }
                            .orEmpty(),
                        unit = bootstrap?.profile?.unit ?: progress?.unit ?: "KG",
                        bodyweightKg = bootstrap?.profile?.bodyweight,
                        canFetchProgress = online,
                        onOpenProgress = { exerciseId -> openProgress(exerciseId) },
                        onOpenHistory = { historySessionId, startedAt ->
                            val month = nativeHistoryDateKey(startedAt).take(7)
                            navController.navigate(
                                "history?sessionId=${Uri.encode(historySessionId)}&month=${Uri.encode(month)}",
                            )
                        },
                    )
                }
            }
            composable(
                route = "history?sessionId={sessionId}&month={month}",
                arguments = listOf(
                    navArgument("sessionId") {
                        type = NavType.StringType
                        nullable = true
                        defaultValue = null
                    },
                    navArgument("month") {
                        type = NavType.StringType
                        nullable = true
                        defaultValue = null
                    },
                ),
            ) { entry ->
                HistoryScreen(
                    onBack = { navController.popBackStack() },
                    initialSessionId = entry.arguments?.getString("sessionId"),
                    initialMonthKey = entry.arguments?.getString("month"),
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
                                runCatching {
                                    repository.refreshProgress(entry.arguments?.getString("exerciseId"))
                                }
                                    .onFailure { snackbar.showSnackbar(it.message ?: syncFailedMessage) }
                                progressRefreshing = false
                            }
                        }
                    },
                    onBack = { navController.popBackStack() },
                )
            }
            composable("coach") {
                CoachScreen(
                    onBack = { navController.popBackStack() },
                    onOpenChat = { navController.navigate("chat") },
                )
            }
            composable(
                route = "chat?sessionId={sessionId}",
                arguments = listOf(
                    navArgument("sessionId") {
                        type = NavType.StringType
                        nullable = true
                        defaultValue = null
                    },
                ),
            ) { entry ->
                ChatScreen(
                    sessionId = entry.arguments?.getString("sessionId"),
                    onBack = { navController.popBackStack() },
                )
            }
            composable(
                route = "session/{sessionId}",
                arguments = listOf(navArgument("sessionId") { type = NavType.StringType }),
            ) { entry ->
                val sessionId = entry.arguments?.getString("sessionId").orEmpty()
                WorkoutScreen(
                    repository = repository,
                    sessionId = sessionId,
                    bootstrap = bootstrap,
                    online = online,
                    onAskCoach = {
                        navController.navigate("chat?sessionId=${Uri.encode(sessionId)}")
                    },
                    onOpenProgress = { exerciseId -> openProgress(exerciseId) },
                    onOpenHistory = { historySessionId, startedAt ->
                        val month = nativeHistoryDateKey(startedAt).take(7)
                        navController.navigate(
                            "history?sessionId=${Uri.encode(historySessionId)}&month=${Uri.encode(month)}",
                        )
                    },
                    onExit = { returnHome() },
                )
            }
            composable(SETTINGS_ROUTE) {
                val back: () -> Unit = { navController.popBackStack() }
                if (settingsContent != null) {
                    settingsContent(back, ::openWebPath)
                } else {
                    WebPanelScreen(
                        repository = repository,
                        online = online,
                        startPath = "/settings",
                        onBack = back,
                    )
                }
            }
            composable(WEB_ROUTE) {
                WebPanelScreen(
                    repository = repository,
                    online = online,
                    startPath = webStartPath,
                ) {
                    if (!navController.popBackStack()) returnHome()
                }
            }
        }
        SnackbarHost(hostState = snackbar)
    }
}
