package org.sharteman.gymcoach.data.media

import android.content.Context
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import java.util.Locale

private const val CATALOG_ASSET_NAME = "exercise-media.json"
private const val MEDIA_ROOT = "/exercise-media/free-exercise-db"

data class ExerciseMediaAsset(
    val datasetId: String,
    val approximate: Boolean,
    val source: ExerciseMediaSource,
) {
    val thumbnailPath: String get() = framePath(0)

    fun framePath(index: Int): String {
        require(index in 0..1) { "Exercise media frame index must be 0 or 1." }
        return "$MEDIA_ROOT/$datasetId/$index.jpg"
    }

    fun frameUrl(serverUrl: String, index: Int = 0): String =
        resolveExerciseMediaUrl(serverUrl, framePath(index))
}

data class ExerciseMediaSource(
    val name: String,
    val url: String,
    val license: String,
)

class ExerciseMediaCatalog private constructor(
    private val mediaByName: Map<String, ExerciseMediaAsset>,
) {
    fun resolve(exerciseName: String): ExerciseMediaAsset? =
        mediaByName[normalizeExerciseName(exerciseName)]

    companion object {
        private val parser = Json { ignoreUnknownKeys = true }

        fun fromJson(payload: String): ExerciseMediaCatalog {
            val document = parser.decodeFromString<ExerciseMediaDocument>(payload)
            val source = ExerciseMediaSource(
                name = document.source.name,
                url = document.source.url,
                license = document.source.license,
            )
            val mediaByName = buildMap {
                document.groups.forEach { group ->
                    require(group.datasetId.matches(DATASET_ID_PATTERN)) {
                        "Invalid exercise media dataset id: ${group.datasetId}"
                    }
                    val media = ExerciseMediaAsset(
                        datasetId = group.datasetId,
                        approximate = group.approximate,
                        source = source,
                    )
                    group.names.forEach { name ->
                        val normalized = normalizeExerciseName(name)
                        if (normalized.isNotEmpty()) put(normalized, media)
                    }
                }
            }
            return ExerciseMediaCatalog(mediaByName)
        }

        fun load(context: Context): ExerciseMediaCatalog {
            val payload = context.applicationContext.assets.open(CATALOG_ASSET_NAME)
                .bufferedReader(Charsets.UTF_8)
                .use { it.readText() }
            return fromJson(payload)
        }

        private val DATASET_ID_PATTERN = Regex("[A-Za-z0-9_-]+")
    }
}

fun resolveExerciseMediaUrl(serverUrl: String, mediaPath: String): String {
    val base = serverUrl.trim().trimEnd('/')
    require(base.isNotEmpty()) { "Server URL must not be blank." }
    return "$base/${mediaPath.trimStart('/')}"
}

internal fun normalizeExerciseName(name: String): String =
    name.trim().lowercase(Locale.US)

@Serializable
private data class ExerciseMediaDocument(
    val source: ExerciseMediaSourceDocument = ExerciseMediaSourceDocument(),
    val groups: List<ExerciseMediaGroup> = emptyList(),
)

@Serializable
private data class ExerciseMediaSourceDocument(
    val name: String = "",
    val url: String = "",
    val license: String = "",
)

@Serializable
private data class ExerciseMediaGroup(
    val datasetId: String,
    val names: List<String> = emptyList(),
    val approximate: Boolean = false,
)
