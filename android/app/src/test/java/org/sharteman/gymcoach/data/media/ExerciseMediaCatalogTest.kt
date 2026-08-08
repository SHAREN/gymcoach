package org.sharteman.gymcoach.data.media

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.After
import org.junit.Test
import java.io.File

class ExerciseMediaCatalogTest {
    @After
    fun clearProcessCache() {
        ExerciseMediaCatalog.clearCacheForTest()
    }

    @Test
    fun `process cache parses the catalog once`() {
        var loads = 0
        val first = ExerciseMediaCatalog.loadOnceForTest {
            loads += 1
            catalog("first", listOf("Bench Press"))
        }
        val second = ExerciseMediaCatalog.loadOnceForTest {
            loads += 1
            catalog("second", listOf("Squat"))
        }

        assertSame(first, second)
        assertEquals(1, loads)
        assertNotNull(second.resolve("Bench Press"))
        assertNull(second.resolve("Squat"))
    }

    @Test
    fun resolvesNamesAfterWebCompatibleNormalization() {
        val catalog = catalog(
            datasetId = "Barbell_Squat",
            names = listOf("Squats · Barbell"),
        )

        val media = catalog.resolve("  SQUATS · BARBELL  ")

        assertNotNull(media)
        assertEquals("Barbell_Squat", media?.datasetId)
    }

    @Test
    fun returnsNullForUnknownOrCustomExercise() {
        val catalog = catalog(
            datasetId = "Barbell_Squat",
            names = listOf("Squats · Barbell"),
        )

        assertNull(catalog.resolve("Custom belt squat"))
    }

    @Test
    fun buildsStableFramePaths() {
        val media = mediaAsset("Barbell_Squat")

        assertEquals(
            "/exercise-media/free-exercise-db/Barbell_Squat/0.jpg",
            media.thumbnailPath,
        )
        assertEquals(
            "/exercise-media/free-exercise-db/Barbell_Squat/1.jpg",
            media.framePath(1),
        )
        assertThrows(IllegalArgumentException::class.java) { media.framePath(2) }
    }

    @Test
    fun resolvesMediaPathAgainstPublicOrLanServerUrl() {
        val media = mediaAsset("Barbell_Squat")

        assertEquals(
            "https://gymcoach7.sharteman.duckdns.org/exercise-media/free-exercise-db/Barbell_Squat/0.jpg",
            media.frameUrl(" https://gymcoach7.sharteman.duckdns.org/ "),
        )
        assertEquals(
            "http://192.168.0.119:3030/exercise-media/free-exercise-db/Barbell_Squat/1.jpg",
            media.frameUrl("http://192.168.0.119:3030", index = 1),
        )
    }

    @Test
    fun packagedCatalogContainsExpectedWebMapping() {
        val asset = File("src/main/assets/exercise-media.json")

        assertTrue("Packaged exercise media catalog is missing", asset.isFile)
        val catalog = ExerciseMediaCatalog.fromJson(asset.readText(Charsets.UTF_8))
        assertEquals("Barbell_Squat", catalog.resolve("Squats · Barbell")?.datasetId)
        assertEquals(
            "Lying_Face_Down_Plate_Neck_Resistance",
            catalog.resolve("Шея зад · Misc")?.datasetId,
        )
        val approximate = catalog.resolve("Behind-the-Back Curls · Cable")
        assertTrue(approximate?.approximate == true)
        assertEquals("free-exercise-db", approximate?.source?.name)
        assertEquals("Public domain (Unlicense)", approximate?.source?.license)
    }

    private fun catalog(datasetId: String, names: List<String>): ExerciseMediaCatalog {
        val encodedNames = names.joinToString(",") { "\"$it\"" }
        return ExerciseMediaCatalog.fromJson(
            """{"source":{"name":"test","url":"https://example.test","license":"test"},"groups":[{"datasetId":"$datasetId","names":[$encodedNames]}]}""",
        )
    }


    private fun mediaAsset(datasetId: String) = ExerciseMediaAsset(
        datasetId = datasetId,
        approximate = false,
        source = ExerciseMediaSource("test", "https://example.test", "test"),
    )
}
