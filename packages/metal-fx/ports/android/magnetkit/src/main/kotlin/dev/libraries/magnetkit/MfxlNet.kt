package dev.libraries.magnetkit

import org.json.JSONObject
import kotlin.math.exp

/**
 * A small fully connected network stored as MFXL: "MFXL", a little-endian
 * UInt32 header length, a JSON header (`kind`, `layers`: [{in, out, act}],
 * plus whatever the network needs), then each layer's weights (out × in,
 * row-major) and biases as float16. The same files as MagnetKit on iOS.
 */
internal class MfxlNet private constructor(
    private val layers: List<Layer>,
    val header: JSONObject,
) {
    private class Layer(val inN: Int, val outN: Int, val w: FloatArray, val b: FloatArray, val silu: Boolean)

    val inputs: Int get() = layers.first().inN
    val outputs: Int get() = layers.last().outN

    fun forward(input: FloatArray): FloatArray {
        var cur = input
        for (l in layers) {
            val dst = FloatArray(l.outN)
            var row = 0
            for (o in 0 until l.outN) {
                var acc = l.b[o]
                for (i in 0 until l.inN) acc += l.w[row + i] * cur[i]
                row += l.inN
                dst[o] = if (l.silu) acc / (1f + exp(-acc)) else acc
            }
            cur = dst
        }
        return cur
    }

    companion object {
        /** Parses one MFXL network; nil if it is not one of `kind`. */
        fun parse(data: ByteArray, kind: String? = null): MfxlNet? {
            val header = header(data) ?: return null
            if (kind != null && header.optString("kind") != kind && !(kind == "locator" && !header.has("kind"))) return null
            val specs = header.optJSONArray("layers") ?: return null
            var offset = 8 + headerLength(data)
            fun halves(count: Int): FloatArray? {
                if (offset + count * 2 > data.size) return null
                val out = FloatArray(count)
                for (i in 0 until count) {
                    val lo = data[offset + i * 2].toInt() and 0xff
                    val hi = data[offset + i * 2 + 1].toInt() and 0xff
                    out[i] = halfToFloat(lo or (hi shl 8))
                }
                offset += count * 2
                return out
            }
            val layers = ArrayList<Layer>()
            for (k in 0 until specs.length()) {
                val s = specs.getJSONObject(k)
                val inN = s.getInt("in"); val outN = s.getInt("out")
                val w = halves(inN * outN) ?: return null
                val b = halves(outN) ?: return null
                layers.add(Layer(inN, outN, w, b, s.optString("act") == "silu"))
            }
            if (layers.isEmpty()) return null
            return MfxlNet(layers, header)
        }

        fun headerLength(data: ByteArray): Int =
            (data[4].toInt() and 0xff) or ((data[5].toInt() and 0xff) shl 8) or
                ((data[6].toInt() and 0xff) shl 16) or ((data[7].toInt() and 0xff) shl 24)

        fun header(data: ByteArray): JSONObject? {
            if (data.size <= 8 || data[0] != 'M'.code.toByte() || data[1] != 'F'.code.toByte() ||
                data[2] != 'X'.code.toByte() || data[3] != 'L'.code.toByte()) return null
            val hlen = headerLength(data)
            if (data.size < 8 + hlen) return null
            return runCatching { JSONObject(String(data, 8, hlen, Charsets.UTF_8)) }.getOrNull()
        }

        private fun halfToFloat(h: Int): Float {
            val sign = (h shr 15) and 1
            val e = (h shr 10) and 0x1f
            val mant = h and 0x3ff
            val bits = when {
                e == 0 && mant == 0 -> sign shl 31
                e == 0 -> return (if (sign == 1) -1f else 1f) * mant * 5.9604645e-8f   // 2^-24
                e == 31 -> (sign shl 31) or 0x7f800000 or (mant shl 13)
                else -> (sign shl 31) or ((e - 15 + 127) shl 23) or (mant shl 13)
            }
            return Float.fromBits(bits)
        }
    }
}
