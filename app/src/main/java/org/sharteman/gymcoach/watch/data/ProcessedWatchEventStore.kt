package org.sharteman.gymcoach.watch.data

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

interface ProcessedWatchEventStore {
    suspend fun markProcessed(eventId: String): Boolean

    suspend fun processedCount(): Int
}

interface ProcessedWatchControlMessageStore {
    suspend fun markProcessed(messageId: String): Boolean

    suspend fun processedCount(): Int
}

class InMemoryProcessedWatchEventStore : ProcessedWatchEventStore {
    private val mutex = Mutex()
    private val processedEventIds = mutableSetOf<String>()

    override suspend fun markProcessed(eventId: String): Boolean = mutex.withLock {
        processedEventIds.add(eventId)
    }

    override suspend fun processedCount(): Int = mutex.withLock {
        processedEventIds.size
    }
}

class InMemoryProcessedWatchControlMessageStore : ProcessedWatchControlMessageStore {
    private val mutex = Mutex()
    private val processedMessageIds = mutableSetOf<String>()

    override suspend fun markProcessed(messageId: String): Boolean = mutex.withLock {
        processedMessageIds.add(messageId)
    }

    override suspend fun processedCount(): Int = mutex.withLock {
        processedMessageIds.size
    }
}
