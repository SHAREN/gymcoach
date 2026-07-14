package org.sharteman.gymcoach.data.network

import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import okhttp3.HttpUrl.Companion.toHttpUrl

fun androidLatestUrl(serverUrl: String): String =
    "${serverUrl.trimEnd('/')}/api/android/latest"

fun androidDownloadUrl(serverUrl: String): String =
    "${serverUrl.trimEnd('/')}/api/android/download"

fun resolveAndroidDownloadUrl(serverUrl: String, advertisedUrl: String): String {
    val base = "${serverUrl.trimEnd('/')}/".toHttpUrl()
    val resolved = base.resolve(advertisedUrl)
        ?: throw IllegalArgumentException("Invalid Android download URL.")
    if (resolved.scheme != base.scheme || resolved.host != base.host || resolved.port != base.port) {
        throw IllegalArgumentException("Android download URL must use the configured server.")
    }
    return resolved.toString()
}

fun enqueueAndroidUpdate(
    context: Context,
    downloadUrl: String,
    versionName: String,
): Long {
    val request = DownloadManager.Request(Uri.parse(downloadUrl))
        .setTitle("GymCoach $versionName")
        .setDescription("GymCoach Android update")
        .setMimeType("application/vnd.android.package-archive")
        .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
        .setAllowedOverMetered(true)
        .setAllowedOverRoaming(false)
    val manager = context.getSystemService(Context.DOWNLOAD_SERVICE) as? DownloadManager
        ?: throw IllegalStateException("Android Download Manager is unavailable.")
    return manager.enqueue(request)
}
