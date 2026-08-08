import org.gradle.api.tasks.Exec
import org.gradle.api.tasks.Copy

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
    id("org.jetbrains.kotlin.kapt")
    id("androidx.baselineprofile")
}

fun String.asBuildConfigString(): String =
    "\"${replace("\\", "\\\\").replace("\"", "\\\"")}\""

val watchTransportMode = providers.gradleProperty("gymcoach.watch.transport")
    .orElse("simulator")
val huaweiWearEngineAppId = providers.gradleProperty("gymcoach.huawei.appId")
    .orElse("")
val huaweiWatchPackageName = providers.gradleProperty("gymcoach.huawei.watchPackage")
    .orElse("org.sharteman.gymcoach.watch")
val huaweiWatchFingerprint = providers.gradleProperty("gymcoach.huawei.watchFingerprint")
    .orElse("")
val huaweiWatchDeviceUuid = providers.gradleProperty("gymcoach.huawei.watchDeviceUuid")
    .orElse("")
val repositoryRoot = rootProject.projectDir.parentFile
val sourceCommit = providers.environmentVariable("GYMCOACH_COMMIT_SHA").orElse(
    providers.exec {
        workingDir(repositoryRoot)
        commandLine("git", "rev-parse", "--short=12", "HEAD")
    }.standardOutput.asText.map { output -> output.trim().ifBlank { "unknown" } },
)
val releaseStoreFile = providers.gradleProperty("gymcoach.release.storeFile")
    .orElse(providers.environmentVariable("GYMCOACH_RELEASE_STORE_FILE"))
val releaseStorePassword = providers.gradleProperty("gymcoach.release.storePassword")
    .orElse(providers.environmentVariable("GYMCOACH_RELEASE_STORE_PASSWORD"))
val releaseKeyAlias = providers.gradleProperty("gymcoach.release.keyAlias")
    .orElse(providers.environmentVariable("GYMCOACH_RELEASE_KEY_ALIAS"))
val releaseKeyPassword = providers.gradleProperty("gymcoach.release.keyPassword")
    .orElse(providers.environmentVariable("GYMCOACH_RELEASE_KEY_PASSWORD"))
val releaseSigningAvailable = listOf(
    releaseStoreFile,
    releaseStorePassword,
    releaseKeyAlias,
    releaseKeyPassword,
).all { provider -> provider.orNull?.isNotBlank() == true }

android {
    namespace = "org.sharteman.gymcoach"
    compileSdk = 35

    defaultConfig {
        applicationId = "org.sharteman.gymcoach"
        minSdk = 26
        targetSdk = 35
        versionCode = 59
        versionName = "0.4.49"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables.useSupportLibrary = true
        buildConfigField("String", "DEFAULT_SERVER_URL", "\"https://gymcoach7.sharteman.duckdns.org\"")
        buildConfigField("String", "DEFAULT_FALLBACK_SERVER_URL", "\"http://192.168.0.119:3030\"")
        buildConfigField("String", "SOURCE_COMMIT", sourceCommit.get().asBuildConfigString())
        buildConfigField("String", "HUAWEI_WEAR_ENGINE_APP_ID", huaweiWearEngineAppId.get().asBuildConfigString())
        buildConfigField("String", "HUAWEI_WATCH_PACKAGE_NAME", huaweiWatchPackageName.get().asBuildConfigString())
        buildConfigField("String", "HUAWEI_WATCH_FINGERPRINT", huaweiWatchFingerprint.get().asBuildConfigString())
        buildConfigField("String", "HUAWEI_WATCH_DEVICE_UUID", huaweiWatchDeviceUuid.get().asBuildConfigString())
        manifestPlaceholders["huaweiWearEngineAppId"] = huaweiWearEngineAppId.get()
    }

    signingConfigs {
        if (releaseSigningAvailable) {
            create("release") {
                storeFile = file(releaseStoreFile.get())
                storePassword = releaseStorePassword.get()
                keyAlias = releaseKeyAlias.get()
                keyPassword = releaseKeyPassword.get()
                enableV1Signing = true
                enableV2Signing = true
                enableV3Signing = true
            }
        }
    }

    buildTypes {
        debug {
            buildConfigField("String", "WATCH_TRANSPORT_MODE", watchTransportMode.get().asBuildConfigString())
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            signingConfig = signingConfigs.findByName("release")
            buildConfigField("String", "WATCH_TRANSPORT_MODE", "huawei".asBuildConfigString())
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
        create("benchmark") {
            initWith(getByName("release"))
            applicationIdSuffix = ".benchmark"
            versionNameSuffix = "-benchmark"
            signingConfig = signingConfigs.getByName("debug")
            isDebuggable = false
            isMinifyEnabled = false
            isShrinkResources = false
            matchingFallbacks += listOf("release")
            buildConfigField("String", "WATCH_TRANSPORT_MODE", "simulator".asBuildConfigString())
        }
        create("performance") {
            initWith(getByName("release"))
            applicationIdSuffix = ".benchmark"
            versionNameSuffix = "-performance"
            signingConfig = signingConfigs.getByName("debug")
            isDebuggable = false
            matchingFallbacks += listOf("release")
            buildConfigField("String", "WATCH_TRANSPORT_MODE", "simulator".asBuildConfigString())
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions.jvmTarget = "17"
    buildFeatures {
        compose = true
        buildConfig = true
    }
    packaging.resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    sourceSets.getByName("androidTest").assets.srcDir("$projectDir/schemas")
    sourceSets.getByName("benchmark").java.srcDir("src/release/java")
    sourceSets.getByName("performance").java.srcDir("src/release/java")
    sourceSets.getByName("performance").manifest.srcFile("src/benchmark/AndroidManifest.xml")
    sourceSets.getByName("test").resources.srcDir(
        rootProject.projectDir.parentFile.resolve("shared-contracts/examples"),
    )
    sourceSets.getByName("test").resources.srcDir(
        rootProject.projectDir.parentFile.resolve("shared-contracts/fixtures"),
    )
}

kapt {
    correctErrorTypes = true
    arguments {
        arg("room.schemaLocation", "$projectDir/schemas")
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2025.05.01")
    implementation(composeBom)
    androidTestImplementation(composeBom)

    implementation("androidx.core:core-ktx:1.16.0")
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.9.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.0")
    implementation("androidx.profileinstaller:profileinstaller:1.4.1")
    implementation("androidx.navigation:navigation-compose:2.9.0")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")

    implementation("androidx.room:room-runtime:2.7.1")
    implementation("androidx.room:room-ktx:2.7.1")
    kapt("androidx.room:room-compiler:2.7.1")
    implementation("androidx.work:work-runtime-ktx:2.10.1")

    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.8.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("io.coil-kt:coil-compose:2.7.0")
    implementation("com.huawei.hms:wearengine:5.0.3.304")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.2")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.6.1")
    androidTestImplementation("androidx.room:room-testing:2.7.1")
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
    baselineProfile(project(":baselineprofile"))
}

val generateAndroidExerciseNames = tasks.register<Exec>("generateAndroidExerciseNames") {
    group = "build setup"
    description = "Generates the Android Russian exercise dictionary from the web dictionary."
    workingDir(repositoryRoot)
    commandLine(
        "node",
        repositoryRoot.resolve("scripts/generate-android-exercise-names.mjs").absolutePath,
    )
}

tasks.named("preBuild").configure {
    dependsOn(generateAndroidExerciseNames)
}

val releaseApk = layout.buildDirectory.file("outputs/apk/release/app-release.apk")
val retainReleaseMapping = tasks.register<Copy>("retainReleaseMapping") {
    group = "distribution"
    description = "Retains the R8 mapping next to the published Android distribution metadata."
    dependsOn("minifyReleaseWithR8")
    from(layout.buildDirectory.file("outputs/mapping/release/mapping.txt"))
    into(repositoryRoot.resolve("data/android-release"))
    rename { "mapping-${android.defaultConfig.versionName}-${sourceCommit.get()}.txt" }
}

val publishReleaseApk = tasks.register<Exec>("publishReleaseApk") {
    group = "distribution"
    description = "Publishes the signed optimized release APK for the GymCoach download endpoint."
    dependsOn("assembleRelease", retainReleaseMapping)
    workingDir(repositoryRoot)
    environment(
        "ANDROID_RELEASE_DIR",
        repositoryRoot.resolve("data/android-release").absolutePath,
    )
    commandLine(
        "node",
        repositoryRoot.resolve("scripts/publish-android-apk.mjs").absolutePath,
        releaseApk.get().asFile.absolutePath,
    )
}

gradle.taskGraph.whenReady {
    val releaseArtifactRequested = allTasks.any { task ->
        task.project == project && task.name in setOf(
            "packageRelease",
            "assembleRelease",
            "bundleRelease",
            "publishReleaseApk",
        )
    }
    if (releaseArtifactRequested && !releaseSigningAvailable) {
        throw GradleException(
            "Release signing is not configured. Provide gymcoach.release.* Gradle properties " +
                "or the matching GYMCOACH_RELEASE_* environment variables.",
        )
    }
}
