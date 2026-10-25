package dev.libraries.magnetkit

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import java.io.File

/** The Android model gives what the trained PyTorch networks give (float16 weights: within ~1e-3). */
class ParityTest {
    // The model is licensed separately and not in the public repo; copy it from
    // libraries-pro into src/main/assets to run these.
    private val file = File("src/main/assets/Magnet.mfxl")
    private val model by lazy { MagnetModel.parse(file.readBytes())!! }
    private val cases = JSONObject(javaClass.getResource("/parity.json")!!.readText())

    @Before fun needModel() = assumeTrue("Magnet.mfxl not in src/main/assets", file.exists())

    private fun history(a: org.json.JSONArray) = (0 until a.length()).map { val v = a.getJSONArray(it); Vec3(v.getDouble(0), v.getDouble(1), v.getDouble(2)) }

    @Test fun locator() {
        val list = cases.getJSONArray("locator")
        for (i in 0 until list.length()) {
            val c = list.getJSONObject(i)
            val f = c.getJSONArray("field")
            val (pos, spread) = model.locator.locate(Vec3(f.getDouble(0), f.getDouble(1), f.getDouble(2)),
                if (c.isNull("strength")) null else c.getDouble("strength"), c.getInt("face"))!!
            val p = c.getJSONArray("position")
            assertEquals(p.getDouble(0), pos.x, 0.02 + 0.01 * pos.length)
            assertEquals(p.getDouble(1), pos.y, 0.02 + 0.01 * pos.length)
            assertEquals(p.getDouble(2), pos.z, 0.02 + 0.01 * pos.length)
            assertEquals(c.getDouble("spread"), spread, 0.02 * c.getDouble("spread") + 0.01)
        }
    }

    @Test fun presence() {
        val list = cases.getJSONArray("presence")
        for (i in 0 until list.length()) {
            val c = list.getJSONObject(i)
            val (p, _) = model.presence.evaluate(history(c.getJSONArray("history")), if (c.isNull("overloadedFor")) null else c.getDouble("overloadedFor"))
            assertEquals(c.getDouble("presence"), p, 0.003)
        }
    }

    @Test fun tap() {
        val list = cases.getJSONArray("tap")
        for (i in 0 until list.length()) {
            val c = list.getJSONObject(i)
            assertEquals(c.getDouble("tap"), model.tap.evaluate(history(c.getJSONArray("history"))), 0.003)
        }
    }
}
