package org.sharteman.gymcoach.data.repository

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

internal suspend fun <T> runCachePayloadCodec(block: () -> T): T =
    withContext(Dispatchers.Default) { block() }
