import org.gradle.api.tasks.Exec

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
    id("org.jetbrains.kotlin.kapt")
}

android {
    namespace = "org.sharteman.gymcoach"
    compileSdk = 35

    defaultConfig {
        applicationId = "org.sharteman.gymcoach"
        minSdk = 26
        targetSdk = 35
        versionCode = 14
        versionName = "0.4.4"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables.useSupportLibrary = true
        buildConfigField("String", "DEFAULT_SERVER_URL", "\"https://gymcoach7.sharteman.duckdns.org\"")
        buildConfigField("String", "DEFAULT_FALLBACK_SERVER_URL", "\"http://192.168.0.119:3030\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
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

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.6.1")
    androidTestImplementation("androidx.room:room-testing:2.7.1")
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}

val repositoryRoot = rootProject.projectDir.parentFile
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

val debugApk = layout.buildDirectory.file("outputs/apk/debug/app-debug.apk")
val publishDebugApk = tasks.register<Exec>("publishDebugApk") {
    group = "distribution"
    description = "Publishes the latest debug APK for the GymCoach web download endpoint."
    dependsOn("packageDebug")
    workingDir(repositoryRoot)
    environment(
        "ANDROID_RELEASE_DIR",
        repositoryRoot.resolve("data/android-release").absolutePath,
    )
    commandLine(
        "node",
        repositoryRoot.resolve("scripts/publish-android-apk.mjs").absolutePath,
        debugApk.get().asFile.absolutePath,
    )
}

tasks.matching { it.name == "assembleDebug" }.configureEach {
    dependsOn(publishDebugApk)
}
