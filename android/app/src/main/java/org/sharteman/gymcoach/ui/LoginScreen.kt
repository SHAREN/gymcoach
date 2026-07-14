package org.sharteman.gymcoach.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CloudDone
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.sharteman.gymcoach.R
import org.sharteman.gymcoach.data.repository.GymCoachRepository

@Composable
fun LoginScreen(repository: GymCoachRepository, onLoggedIn: () -> Unit) {
    var email by remember { mutableStateOf(repository.email.orEmpty()) }
    var password by remember { mutableStateOf("") }
    var server by remember { mutableStateOf(repository.primaryServerUrl) }
    var fallbackServer by remember { mutableStateOf(repository.fallbackServerUrl.orEmpty()) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<LoginErrorKind?>(null) }
    val scope = rememberCoroutineScope()

    Surface(modifier = Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp, vertical = 40.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Icon(
                imageVector = Icons.Outlined.CloudDone,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
            )
            Spacer(Modifier.height(16.dp))
            Text(stringResource(R.string.login_title), style = MaterialTheme.typography.headlineSmall)
            Spacer(Modifier.height(24.dp))
            OutlinedTextField(
                value = email,
                onValueChange = {
                    email = it
                    error = null
                },
                label = { Text(stringResource(R.string.email)) },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                value = password,
                onValueChange = {
                    password = it
                    error = null
                },
                label = { Text(stringResource(R.string.password)) },
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                value = server,
                onValueChange = {
                    server = it
                    error = null
                },
                label = { Text(stringResource(R.string.primary_server)) },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                value = fallbackServer,
                onValueChange = {
                    fallbackServer = it
                    error = null
                },
                label = { Text(stringResource(R.string.fallback_server)) },
                supportingText = { Text(stringResource(R.string.fallback_server_hint)) },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            error?.let { errorKind ->
                Spacer(Modifier.height(8.dp))
                LoginErrorBanner(message = loginErrorMessage(errorKind))
            }
            Spacer(Modifier.height(20.dp))
            Button(
                onClick = {
                    scope.launch {
                        loading = true
                        error = null
                        runCatching { repository.login(email, password, server, fallbackServer) }
                            .onSuccess { onLoggedIn() }
                            .onFailure { error = classifyLoginError(it) }
                        loading = false
                    }
                },
                enabled = !loading && email.isNotBlank() && password.isNotBlank(),
                modifier = Modifier.fillMaxWidth().height(52.dp),
            ) {
                if (loading) CircularProgressIndicator(strokeWidth = 2.dp)
                else Text(stringResource(R.string.sign_in))
            }
            Spacer(Modifier.height(16.dp))
            Text(
                stringResource(R.string.offline_cache_hint),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun LoginErrorBanner(message: String) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(8.dp),
        color = MaterialTheme.colorScheme.errorContainer,
        contentColor = MaterialTheme.colorScheme.onErrorContainer,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(12.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.Top,
        ) {
            Icon(Icons.Outlined.ErrorOutline, contentDescription = null)
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    stringResource(R.string.login_error_title),
                    style = MaterialTheme.typography.labelLarge,
                )
                Text(message, style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

@Composable
private fun loginErrorMessage(kind: LoginErrorKind): String = stringResource(
    when (kind) {
        LoginErrorKind.INVALID_CREDENTIALS -> R.string.login_error_invalid_credentials
        LoginErrorKind.INVALID_REQUEST -> R.string.login_error_invalid_request
        LoginErrorKind.RATE_LIMITED -> R.string.login_error_rate_limited
        LoginErrorKind.MOBILE_API_NOT_FOUND -> R.string.login_error_api_not_found
        LoginErrorKind.SERVER_ERROR -> R.string.login_error_server
        LoginErrorKind.HOST_NOT_FOUND -> R.string.login_error_host_not_found
        LoginErrorKind.SERVER_UNREACHABLE -> R.string.login_error_server_unreachable
        LoginErrorKind.TIMEOUT -> R.string.login_error_timeout
        LoginErrorKind.TLS_ERROR -> R.string.login_error_tls
        LoginErrorKind.INVALID_SERVER_URL -> R.string.login_error_invalid_server_url
        LoginErrorKind.HTTPS_REQUIRED -> R.string.login_error_https_required
        LoginErrorKind.CLEARTEXT_NOT_ALLOWED -> R.string.login_error_cleartext
        LoginErrorKind.INCOMPATIBLE_RESPONSE -> R.string.login_error_incompatible_response
        LoginErrorKind.INITIAL_SYNC_FAILED -> R.string.login_error_initial_sync
        LoginErrorKind.NETWORK_ERROR -> R.string.login_error_network
        LoginErrorKind.UNKNOWN -> R.string.login_error
    },
)
