pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "MagnetAndroid"
// MagnetKit for Android: the magnet model and the sensor around it — a library of its own.
include(":magnetkit")
// Magnetic Home: a home screen whose apps feel a magnet beside the phone.
include(":magnetic-home")
