package org.sharteman.gymcoach.ui

import android.content.Intent
import android.net.Uri
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.viewinterop.AndroidView
import org.sharteman.gymcoach.R
import org.sharteman.gymcoach.data.repository.GymCoachRepository

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WebPanelScreen(
    repository: GymCoachRepository,
    online: Boolean,
    startPath: String = "/",
    onBack: () -> Unit,
) {
    var webView by remember { mutableStateOf<WebView?>(null) }
    var ready by remember { mutableStateOf(!online) }
    val allowedHost = remember(repository.serverUrl) { Uri.parse(repository.serverUrl).host }
    val startUrl = remember(repository.serverUrl, startPath) {
        repository.serverUrl.trimEnd('/') + "/" + startPath.trimStart('/')
    }

    LaunchedEffect(online) {
        if (!online) {
            ready = true
            return@LaunchedEffect
        }
        runCatching { repository.createWebSessionCookies() }.onSuccess { cookies ->
            val manager = CookieManager.getInstance()
            manager.setAcceptCookie(true)
            cookies.forEach { manager.setCookie(repository.serverUrl, it) }
            manager.flush()
            webView?.reload()
        }
        ready = true
    }
    BackHandler(enabled = webView?.canGoBack() == true) { webView?.goBack() }
    DisposableEffect(Unit) {
        onDispose { webView?.destroy() }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.web_panel)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = null)
                    }
                },
            )
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            if (ready) {
                AndroidView(
                    factory = { context ->
                        WebView(context).apply {
                            settings.javaScriptEnabled = true
                            settings.domStorageEnabled = true
                            settings.cacheMode = if (online) {
                                WebSettings.LOAD_DEFAULT
                            } else {
                                WebSettings.LOAD_CACHE_ELSE_NETWORK
                            }
                            settings.allowFileAccess = false
                            settings.allowContentAccess = false
                            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                            CookieManager.getInstance().setAcceptThirdPartyCookies(this, false)
                            webViewClient = object : WebViewClient() {
                                override fun shouldOverrideUrlLoading(
                                    view: WebView,
                                    request: WebResourceRequest,
                                ): Boolean {
                                    if (request.url.host == allowedHost) return false
                                    runCatching {
                                        context.startActivity(Intent(Intent.ACTION_VIEW, request.url))
                                    }
                                    return true
                                }
                            }
                            loadUrl(startUrl)
                            webView = this
                        }
                    },
                    update = { view ->
                        view.settings.cacheMode = if (online) {
                            WebSettings.LOAD_DEFAULT
                        } else {
                            WebSettings.LOAD_CACHE_ELSE_NETWORK
                        }
                    },
                    modifier = Modifier.fillMaxSize(),
                )
            } else {
                CircularProgressIndicator()
            }
        }
    }
}
