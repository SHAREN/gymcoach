package org.sharteman.gymcoach.data.network

fun androidDownloadUrl(serverUrl: String): String =
    "${serverUrl.trimEnd('/')}/api/android/download"
