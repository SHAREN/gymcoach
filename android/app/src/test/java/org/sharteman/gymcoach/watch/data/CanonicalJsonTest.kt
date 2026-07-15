package org.sharteman.gymcoach.watch.data

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test
import org.sharteman.gymcoach.watch.domain.WatchEventEnvelopeDto

class CanonicalJsonTest {
    private val json = Json { ignoreUnknownKeys = false; explicitNulls = true; encodeDefaults = true }

    @Test
    fun `matches shared canonical event hash vector and code point key order`() {
        val fixture = fixture()
        val inputA = json.decodeFromJsonElement<WatchEventEnvelopeDto>(fixture.getValue("inputA"))
        val canonical = CanonicalJson.event(inputA)

        assertEquals(fixture.getValue("canonicalJson").jsonPrimitive.content, canonical.json)
        assertEquals(fixture.getValue("sha256").jsonPrimitive.content, canonical.sha256)
        assertEquals("\uE000", fixture.getValue("canonicalJson").jsonPrimitive.content
            .substringAfter("unicodeKeys\":{").substringBefore("\":").trim('"'))
    }

    @Test
    fun `reordered object keys produce the same hash`() {
        val fixture = fixture()
        val inputA = CanonicalJson.value(fixture.getValue("inputA"))
        val inputB = CanonicalJson.value(fixture.getValue("inputB"))

        assertEquals(inputA.json, inputB.json)
        assertEquals(inputA.sha256, inputB.sha256)
    }

    @Test
    fun `event id is immutable input to the hash`() {
        val event = json.decodeFromJsonElement<WatchEventEnvelopeDto>(fixture().getValue("inputA"))
        val changed = event.copy(eventId = "7e0639c1-6ee1-4c9f-b780-ff92f5f6b8e3")

        assertNotEquals(CanonicalJson.event(event).sha256, CanonicalJson.event(changed).sha256)
    }

    private fun fixture() = requireNotNull(javaClass.classLoader?.getResourceAsStream("canonical-event-hash.json"))
        .bufferedReader()
        .use { json.parseToJsonElement(it.readText()).jsonObject }
}
