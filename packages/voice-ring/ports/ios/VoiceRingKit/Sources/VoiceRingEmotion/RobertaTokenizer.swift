// Adapted from VoiceGlow Pro (libraries-pro, voice-glow/swiftui/VoiceGlowPro) — the
// same on-device emotion the voice library uses, reading the orbs' VoiceMeter.
// That source is private: check its licence before publishing this module.

import Foundation

/// RoBERTa's byte-level BPE (GPT-2 style), enough to feed a sequence
/// classifier: `vocab.json` + `merges.txt` from the Hugging Face model, the
/// GPT-2 pre-tokenising pattern, `<s> … </s>` around the ids.
public struct RobertaTokenizer: Sendable {
    public let bosID: Int32
    public let eosID: Int32
    public let padID: Int32
    private let vocab: [String: Int32]
    private let ranks: [String: Int]
    private let unk: Int32

    private static let byteToUnicode: [Character] = {
        var bs = Array(33...126) + Array(161...172) + Array(174...255)
        var cs = bs
        var n = 0
        for b in 0..<256 where !bs.contains(b) {
            bs.append(b)
            cs.append(256 + n)
            n += 1
        }
        var table = [Character](repeating: " ", count: 256)
        for (b, c) in zip(bs, cs) { table[b] = Character(UnicodeScalar(c)!) }
        return table
    }()

    // 's|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+
    private static let pattern = try! NSRegularExpression(
        pattern: "'s|'t|'re|'ve|'m|'ll|'d| ?\\p{L}+| ?\\p{N}+| ?[^\\s\\p{L}\\p{N}]+|\\s+(?!\\S)|\\s+"
    )

    /// Loads `vocab.json` and `merges.txt` from `directory`.
    public init(directory: URL) throws {
        let vocabData = try Data(contentsOf: directory.appendingPathComponent("vocab.json"))
        let raw = try JSONDecoder().decode([String: Int32].self, from: vocabData)
        let merges = try String(contentsOf: directory.appendingPathComponent("merges.txt"), encoding: .utf8)
        var ranks: [String: Int] = [:]
        var rank = 0
        for line in merges.split(separator: "\n") where !line.hasPrefix("#version") {
            let parts = line.split(separator: " ")
            guard parts.count == 2 else { continue }
            ranks["\(parts[0]) \(parts[1])"] = rank
            rank += 1
        }
        vocab = raw
        self.ranks = ranks
        bosID = raw["<s>"] ?? 0
        padID = raw["<pad>"] ?? 1
        eosID = raw["</s>"] ?? 2
        unk = raw["<unk>"] ?? 3
    }

    /// `<s> tokens </s>`, at most `maxLength` ids (unpadded).
    public func encode(_ text: String, maxLength: Int = 64) -> [Int32] {
        var ids: [Int32] = [bosID]
        let ns = text as NSString
        for match in Self.pattern.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
            let piece = ns.substring(with: match.range)
            let mapped = String(piece.utf8.map { Self.byteToUnicode[Int($0)] })
            for token in bpe(mapped) {
                ids.append(vocab[token] ?? unk)
            }
            if ids.count >= maxLength - 1 { break }
        }
        ids = Array(ids.prefix(maxLength - 1))
        ids.append(eosID)
        return ids
    }

    private func bpe(_ word: String) -> [String] {
        var parts = word.map(String.init)
        guard parts.count > 1 else { return parts }
        while true {
            var best: (rank: Int, index: Int)?
            for i in 0..<(parts.count - 1) {
                if let r = ranks["\(parts[i]) \(parts[i + 1])"], r < (best?.rank ?? .max) {
                    best = (r, i)
                }
            }
            guard let best else { break }
            let a = parts[best.index], b = parts[best.index + 1]
            // Merge every occurrence of the pair, left to right.
            var merged: [String] = []
            var i = 0
            while i < parts.count {
                if i < parts.count - 1, parts[i] == a, parts[i + 1] == b {
                    merged.append(a + b)
                    i += 2
                } else {
                    merged.append(parts[i])
                    i += 1
                }
            }
            parts = merged
            if parts.count == 1 { break }
        }
        return parts
    }
}
