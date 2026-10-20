plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "dev.libraries.magnetkit"
    compileSdk = 36
    defaultConfig { minSdk = 29 }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    // The model is read straight from the APK: keep it uncompressed.
    androidResources { noCompress += "mfxl" }
}

kotlin { jvmToolchain(17) }

dependencies {
    testImplementation("junit:junit:4.13.2")
    // Android's org.json is a stub on the JVM; the real one for unit tests.
    testImplementation("org.json:json:20240303")
}
