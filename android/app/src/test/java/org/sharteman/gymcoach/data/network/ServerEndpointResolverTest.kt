package org.sharteman.gymcoach.data.network

import java.net.ConnectException
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.sharteman.gymcoach.data.security.AccountStore
import org.sharteman.gymcoach.data.security.normalizeServerUrl

class ServerEndpointResolverTest {
    @Test
    fun `uses LAN fallback when primary server is unreachable`() = runTest {
        val store = FakeAccountStore()
        val probes = mutableListOf<String>()
        val resolver = ServerEndpointResolver(
            accountStore = store,
            probe = ServerReachabilityProbe { url ->
                probes += url
                url == FALLBACK
            },
        )

        assertEquals(FALLBACK, resolver.resolve(forcePrimaryCheck = true))
        assertEquals(FALLBACK, store.serverUrl)
        assertEquals(listOf(PRIMARY, FALLBACK), probes)
    }

    @Test
    fun `does not retry invalid credentials on fallback`() = runTest {
        val store = FakeAccountStore()
        val attempts = mutableListOf<String>()
        val resolver = ServerEndpointResolver(store, ServerReachabilityProbe { true })

        val failure = runCatching {
            resolver.execute(forcePrimaryCheck = true) { url ->
                attempts += url
                throw ApiException(401, "Invalid credentials")
            }
        }.exceptionOrNull()

        assertTrue(failure is ApiException)
        assertEquals(listOf(PRIMARY), attempts)
        assertEquals(PRIMARY, store.serverUrl)
    }

    @Test
    fun `does not retry ordinary client errors on fallback`() = runTest {
        val store = FakeAccountStore()
        val attempts = mutableListOf<String>()
        val resolver = ServerEndpointResolver(store, ServerReachabilityProbe { true })

        val failure = runCatching {
            resolver.execute(forcePrimaryCheck = true) { url ->
                attempts += url
                throw ApiException(403, "Forbidden")
            }
        }.exceptionOrNull()

        assertTrue(failure is ApiException)
        assertEquals(listOf(PRIMARY), attempts)
    }

    @Test
    fun `retries gateway failure on fallback`() = runTest {
        val store = FakeAccountStore()
        val attempts = mutableListOf<String>()
        val resolver = ServerEndpointResolver(store, ServerReachabilityProbe { true })

        val result = resolver.execute(forcePrimaryCheck = true) { url ->
            attempts += url
            if (url == PRIMARY) throw ApiException(502, "Bad gateway")
            "ok"
        }

        assertEquals("ok", result)
        assertEquals(listOf(PRIMARY, FALLBACK), attempts)
    }

    @Test
    fun `retries network failure on alternate server`() = runTest {
        val store = FakeAccountStore()
        val attempts = mutableListOf<String>()
        val resolver = ServerEndpointResolver(store, ServerReachabilityProbe { true })

        val result = resolver.execute(forcePrimaryCheck = true) { url ->
            attempts += url
            if (url == PRIMARY) throw ConnectException("Primary unavailable")
            "ok"
        }

        assertEquals("ok", result)
        assertEquals(listOf(PRIMARY, FALLBACK), attempts)
        assertEquals(FALLBACK, store.serverUrl)
    }

    @Test
    fun `allows private LAN HTTP but rejects public HTTP`() {
        assertEquals(FALLBACK, normalizeServerUrl(FALLBACK))
        assertTrue(runCatching { normalizeServerUrl("http://example.com") }.isFailure)
    }

    @Test
    fun `returns to primary after retry interval`() = runTest {
        val store = FakeAccountStore()
        var now = 1_000L
        var primaryReachable = false
        val resolver = ServerEndpointResolver(
            accountStore = store,
            probe = ServerReachabilityProbe { url -> url == FALLBACK || primaryReachable },
            nowEpochMs = { now },
            primaryRetryIntervalMs = 5_000L,
        )

        assertEquals(FALLBACK, resolver.resolve(forcePrimaryCheck = true))
        primaryReachable = true
        now = 4_000L
        assertEquals(FALLBACK, resolver.resolve())
        now = 7_000L
        assertEquals(PRIMARY, resolver.resolve())
    }

    @Test
    fun `reports stale fallback and failover decisions without changing behavior`() = runTest {
        val store = FakeAccountStore().apply { serverUrl = FALLBACK }
        val events = mutableListOf<ServerEndpointEvent>()
        val resolver = ServerEndpointResolver(
            accountStore = store,
            probe = ServerReachabilityProbe { true },
            nowEpochMs = { 1_000L },
            primaryRetryIntervalMs = 5_000L,
            observer = events::add,
        )

        assertEquals(FALLBACK, resolver.resolve())
        assertEquals("stale-fallback-retained", events.single().category)

        events.clear()
        store.serverUrl = PRIMARY
        val result = resolver.execute { url ->
            if (url == PRIMARY) throw ConnectException("unavailable")
            "ok"
        }

        assertEquals("ok", result)
        assertTrue(events.any { it.category == "primary-attempt-failed" })
        assertTrue(events.any { it.category == "alternate-succeeded" })
    }

    private class FakeAccountStore : AccountStore {
        override val deviceId = "device_test"
        override var serverUrl = PRIMARY
        override val primaryServerUrl = PRIMARY
        override var fallbackServerUrl: String? = FALLBACK
        override var userId: String? = "user_1"
        override var userEmail: String? = "user@example.com"
        private var token: String? = "token"

        override fun getAccessToken() = token
        override fun setAccessToken(token: String) {
            this.token = token
        }
        override fun clearAccessToken() {
            token = null
        }
        override fun clearAccount() {
            token = null
            userId = null
            userEmail = null
        }
    }

    private companion object {
        const val PRIMARY = "https://gymcoach7.sharteman.duckdns.org"
        const val FALLBACK = "http://192.168.0.119:3030"
    }
}
