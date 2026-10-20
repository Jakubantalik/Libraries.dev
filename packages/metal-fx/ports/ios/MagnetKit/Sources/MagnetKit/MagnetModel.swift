import Foundation

/// The magnet model: one on-device model that reads the iPhone's
/// magnetometer and answers three things — where the magnet is, whether it is
/// really there (or the phone's own magnetised parts are lying), and air taps.
/// Trained only on simulated magnet physics, its simulator fitted to real
/// recordings; it ships in this package as one file (Magnet.mfxl, ~2 MB,
/// half precision) and runs with Accelerate — no Core ML, no network.
///
/// `MagnetSource` runs it for you every frame; use the model directly only
/// to feed it your own readings.
public final class MagnetModel {
    /// The model shipped with MagnetKit, or nil if the file is missing.
    public static let bundled: MagnetModel? = {
        guard let url = Bundle.module.url(forResource: "Magnet", withExtension: "mfxl"),
              let data = try? Data(contentsOf: url) else { return nil }
        return MagnetModel(data: data)
    }()

    /// The model's version, e.g. "1.0".
    public let version: String
    /// Where the magnet is, from one reading (relative to the sensor, cm).
    public let locator: MagnetLocator
    /// Is a magnet really there, from the last 15 s.
    public let presence: MagnetPresence
    /// Did an air tap just finish, from the last 1.28 s.
    public let tap: MagnetTap

    /// "MFXL", a little-endian UInt32 header length, a JSON header (kind
    /// "magnet", version, parts with offsets and lengths), then each part.
    public init?(data: Data) {
        guard data.count > 8, data.prefix(4) == Data("MFXL".utf8) else { return nil }
        let hlen = Int(data[4]) | Int(data[5]) << 8 | Int(data[6]) << 16 | Int(data[7]) << 24
        guard data.count >= 8 + hlen,
              let header = try? JSONSerialization.jsonObject(with: data.subdata(in: 8..<(8 + hlen))) as? [String: Any],
              (header["kind"] as? String) == "magnet",
              let parts = header["parts"] as? [[String: Any]] else { return nil }
        let start = 8 + hlen
        func part(_ name: String) -> Data? {
            guard let p = parts.first(where: { ($0["name"] as? String) == name }),
                  let off = p["offset"] as? Int, let len = p["length"] as? Int,
                  start + off + len <= data.count else { return nil }
            return data.subdata(in: (start + off)..<(start + off + len))
        }
        guard let l = part("locator").flatMap(MagnetLocator.init(data:)),
              let p = part("presence").flatMap(MagnetPresence.init(data:)),
              let t = part("tap").flatMap(MagnetTap.init(data:)) else { return nil }
        version = header["version"] as? String ?? "1.0"
        locator = l; presence = p; tap = t
    }
}
