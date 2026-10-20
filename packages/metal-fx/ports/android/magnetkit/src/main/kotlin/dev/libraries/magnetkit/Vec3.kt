package dev.libraries.magnetkit

import kotlin.math.sqrt

/** A 3-D vector in device axes (x right, y toward the top edge, z out of the screen). */
data class Vec3(val x: Double, val y: Double, val z: Double) {
    operator fun plus(o: Vec3) = Vec3(x + o.x, y + o.y, z + o.z)
    operator fun minus(o: Vec3) = Vec3(x - o.x, y - o.y, z - o.z)
    operator fun times(k: Double) = Vec3(x * k, y * k, z * k)
    operator fun div(k: Double) = Vec3(x / k, y / k, z / k)
    operator fun unaryMinus() = Vec3(-x, -y, -z)
    fun dot(o: Vec3) = x * o.x + y * o.y + z * o.z
    val length: Double get() = sqrt(x * x + y * y + z * z)

    companion object {
        val ZERO = Vec3(0.0, 0.0, 0.0)
    }
}

/** A point or vector on the screen, dp (x right, y down). */
data class Pt(val x: Double, val y: Double) {
    operator fun plus(o: Pt) = Pt(x + o.x, y + o.y)
    operator fun minus(o: Pt) = Pt(x - o.x, y - o.y)
    operator fun times(k: Double) = Pt(x * k, y * k)
    val length: Double get() = sqrt(x * x + y * y)

    companion object {
        val ZERO = Pt(0.0, 0.0)
    }
}
