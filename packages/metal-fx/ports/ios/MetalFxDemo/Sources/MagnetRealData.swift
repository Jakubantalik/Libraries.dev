import SwiftUI
import MetalFxKit
import MagnetKit
import simd

// Recording real magnet data, to measure the networks' real accuracy and to
// fine-tune them on real phones and magnets (the training notes live with the model in the private libraries-pro repo).
//
// - Mat passes: the phone lies screen-up in the outline on a printed mat
//   (MetalFxDemo/real-data-mat-iphone15pro.pdf, made by tools/make_mat.py)
//   and the magnet goes on each numbered dot in turn — one lap, then the
//   magnet flipped over for a second lap. Over-the-screen data comes from the
//   9-dot measurement, which saves its readings the same way.
// - The taps & presence session: scripted takes (held, resting, taken away,
//   too close, air taps and near misses…), the raw field logged at 50 Hz with
//   when each take ran, for the presence and tap networks.
//
// Files land in Documents/real-data/ (visible in the Files app).

/// The printed mat: dot positions in mm from the phone's centre (x right,
/// y toward the phone's top). Must match tools/make_mat.py.
enum RealDataMat {
    static let phoneName = "iPhone 15 Pro"
    static let phoneSize = CGSize(width: 70.6, height: 146.6)

    static let dots: [CGPoint] = {
        let hw = phoneSize.width / 2, hh = phoneSize.height / 2
        var out: [CGPoint] = []
        let n = 15.0   // near ring: 15 mm from the edges
        out.append(CGPoint(x: -(hw + n), y: hh + n))
        out += [-25.0, 0, 25].map { CGPoint(x: $0, y: hh + n) }
        out.append(CGPoint(x: hw + n, y: hh + n))
        out += [50.0, 0, -50].map { CGPoint(x: hw + n, y: $0) }
        out.append(CGPoint(x: hw + n, y: -(hh + n)))
        out += [25.0, 0, -25].map { CGPoint(x: $0, y: -(hh + n)) }
        out.append(CGPoint(x: -(hw + n), y: -(hh + n)))
        out += [-50.0, 0, 50].map { CGPoint(x: -(hw + n), y: $0) }
        let f = 45.0   // far ring: 45 mm from the edges
        out += [-25.0, 0, 25].map { CGPoint(x: $0, y: hh + f) }
        out += [50.0, 0, -50].map { CGPoint(x: hw + f, y: $0) }
        out += [25.0, 0, -25].map { CGPoint(x: $0, y: -(hh + f)) }
        out += [-50.0, 0, 50].map { CGPoint(x: -(hw + f), y: $0) }
        return out
    }()
}

enum RealDataPass: String, CaseIterable, Identifiable {
    case desk = "Standing on the desk"
    case air = "3 cm above the desk"
    case screen = "Over the screen"
    case session = "Taps & presence"
    var id: String { rawValue }
    var key: String { switch self { case .desk: "desk"; case .air: "air3cm"; case .screen: "screen"; case .session: "session" } }
    var how: String {
        switch self {
        case .desk: return "Stand the magnet on each dot, flat face down, and hold it still until the phone ticks. Then flip the magnet over and go round again."
        case .air: return "Put something 3 cm tall on each dot (a small box, a stack of coins) and stand the magnet on it. Then flip the magnet over and go round again."
        case .screen: return "Runs the 9-dot measurement: hover the magnet about 1.5 cm over each dot on the screen."
        case .session: return "About 6 minutes of guided takes: holding the magnet, setting it down, taking it away, bringing it too close, air taps and moves that are not taps. The app says what to do and when."
        }
    }
}

/// One dot of a mat pass.
struct RealDataSample {
    let dot: Int
    let mm: CGPoint
    /// Mean field change held on the dot, µT, device axes.
    let field: SIMD3<Double>
    /// Every reading of that second, µT (for the noise).
    var readings: [SIMD3<Double>] = []
    /// 1 = the magnet as grabbed, 2 = flipped over.
    var lap = 1
    /// The face down toward the phone's plane on this lap (+1 / −1), if known.
    var face: Int?
}

/// Writes recordings as JSON into Documents/real-data/.
enum RealDataStore {
    static var folder: URL {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        return docs.appendingPathComponent("real-data", isDirectory: true)
    }

    static var count: Int {
        (try? FileManager.default.contentsOfDirectory(atPath: folder.path).filter { $0.hasSuffix(".json") }.count) ?? 0
    }

    static var machine: String {
        var sys = utsname(); uname(&sys)
        return withUnsafeBytes(of: &sys.machine) { raw in String(decoding: raw.prefix(while: { $0 != 0 }), as: UTF8.self) }
    }

    static func stamp() -> String {
        ISO8601DateFormatter().string(from: Date()).replacingOccurrences(of: ":", with: "-")
    }

    /// What every file carries about the phone and the magnet.
    static func header(pass: RealDataPass) -> [String: Any] {
        let follow = FollowSettings.shared
        let b = UIScreen.main.bounds
        let sensor = follow.sensor
        return [
            "date": ISO8601DateFormatter().string(from: Date()),
            "machine": machine,
            "matPhone": RealDataMat.phoneName,
            "pass": pass.key,
            "screenPoints": [b.width, b.height],
            "pointsPerCm": 60.4,
            "sensorInUse": [sensor.x, sensor.y],
            "sensorMeasured": follow.sensorSpot.map { [$0.x, $0.y] as Any } ?? NSNull(),
            "face": follow.face.map { $0 as Any } ?? NSNull(),
            "strength": follow.fittedStrength.map { $0 as Any } ?? NSNull(),
            "magnetProfile": follow.profile.rawValue,
        ]
    }

    @discardableResult
    static func save(pass: RealDataPass, samples: [RealDataSample]) -> URL? {
        guard !samples.isEmpty else { return nil }
        var payload = header(pass: pass)
        payload["version"] = 2
        payload["heightMM"] = pass == .air ? 30 as Any : (pass == .screen ? 15 as Any : NSNull())
        payload["axes"] = "x_mm right, y_mm toward the phone's top, from the phone centre; field: change from the no-magnet reading, µT, device axes (x right, y top, z out of the screen); lap 2 = magnet flipped over"
        payload["samples"] = samples.map { s in
            [
                "dot": s.dot, "x_mm": s.mm.x, "y_mm": s.mm.y, "lap": s.lap,
                "face": s.face.map { $0 as Any } ?? NSNull(),
                "field": [s.field.x, s.field.y, s.field.z],
                "readings": s.readings.map { [$0.x, $0.y, $0.z] },
            ] as [String: Any]
        }
        return write(payload, name: "\(stamp())-\(pass.key).json")
    }

    static func write(_ payload: [String: Any], name: String) -> URL? {
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let url = folder.appendingPathComponent(name)
            let data = try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
            try data.write(to: url)
            return url
        } catch {
            return nil
        }
    }

    /// Screen points (global) -> mm from the phone centre (the screen is centred on the phone).
    static func mm(fromScreen p: CGPoint) -> CGPoint {
        let b = UIScreen.main.bounds
        return CGPoint(x: (p.x - b.midX) / 6.04, y: -(p.y - b.midY) / 6.04)
    }
}

/// Settings page: which pass, how to print the mat, how many files so far.
struct RealDataSetup: View {
    let onStart: (RealDataPass) -> Void
    @State private var pass: RealDataPass = .desk
    @State private var files = RealDataStore.count

    var body: some View {
        Form {
            Section {
                Picker("Pass", selection: $pass) {
                    ForEach(RealDataPass.allCases) { p in Text(p.rawValue).tag(p) }
                }
                .pickerStyle(.inline)
                .labelsHidden()
            } header: { Text("What to record") } footer: { Text(pass.how) }

            Section {
                Button("Start", systemImage: "record.circle") { onStart(pass) }
            } footer: {
                Text(pass == .session
                     ? "Do the grab first. You need the magnet, a free desk, and somewhere more than 50 cm away to put the magnet."
                     : "Print MetalFxDemo/real-data-mat-iphone15pro.pdf at 100 % (its 50 mm bar must measure 50 mm), lay the phone in the outline, screen up. Keep other magnets and metal away. Do the grab first so the face and strength are saved with the data.")
            }

            Section("Saved") {
                LabeledContent("Recordings", value: "\(files)")
                Text("In the Files app: On My iPhone › Liquid metal › real-data.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Record real data")
        .onAppear { files = RealDataStore.count }
    }
}

/// The mat pass: a map of the mat, the dot to fill, and the recorder — one
/// lap with the magnet as grabbed, then one with it flipped over.
struct RealDataRecording: View {
    let pass: RealDataPass
    let onDone: () -> Void
    @StateObject private var recorder = SpotRecorder(dots: RealDataMat.dots)
    @State private var lap = 1
    @State private var firstLap: [SpotRecorder.Sample] = []
    @State private var flipping = false
    @State private var result: String?
    @State private var finished = false
    @State private var pulse = false
    private let timer = Timer.publish(every: 1.0 / 30.0, on: .main, in: .common).autoconnect()
    private let haptic = UINotificationFeedbackGenerator()

    var body: some View {
        let r = recorder
        VStack(spacing: 14) {
            Text(result ?? (flipping ? "Lap 1 done" : "\(pass.rawValue) · lap \(lap) of 2 · dot \(min(r.step + 1, r.dots.count)) of \(r.dots.count)"))
                .font(.headline).foregroundStyle(.white).multilineTextAlignment(.center)
            if result == nil {
                if flipping {
                    Text("Flip the magnet over, so its other face is down, then go round the dots again.")
                        .font(.body).foregroundStyle(.white).multilineTextAlignment(.center)
                    Button("Start lap 2") { startLapTwo() }
                        .buttonStyle(.borderedProminent).tint(.white).foregroundStyle(.black)
                } else {
                    Text(r.needsLift ? "Got it. Move the magnet to the next dot."
                         : "Put the magnet on dot \(r.step + 1) and hold still.")
                        .font(.footnote).foregroundStyle(.secondary)
                    matMap.frame(maxWidth: 300, maxHeight: 440)
                    Text("\(Int(r.strength.rounded())) µT  ·  needs \(Int(SpotRecorder.threshold))  ·  \(r.samples.count) recorded")
                        .font(.caption.monospaced()).foregroundStyle(r.strength >= SpotRecorder.threshold ? .primary : .secondary)
                }
                HStack(spacing: 10) {
                    Button("Cancel", action: onDone)
                    if !flipping { Button("Skip dot") { r.skip(); lapIfDone() } }
                    if r.samples.count + firstLap.count >= 1 { Button("Finish", action: finishOnce) }
                }
                .font(.footnote.weight(.medium)).buttonStyle(.bordered)
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.black.opacity(0.92))
        .onAppear {
            haptic.prepare()
            MagnetSource.shared.holdBaseline = true
            withAnimation(.easeInOut(duration: 0.6).repeatForever(autoreverses: true)) { pulse = true }
        }
        .onDisappear { MagnetSource.shared.holdBaseline = false }
        .onReceive(timer) { date in
            guard !flipping else { return }
            let now = date.timeIntervalSinceReferenceDate
            if r.tick(MagnetSource.shared.reading(now: now), now: now) { haptic.notificationOccurred(.success) }
            lapIfDone()
        }
    }

    /// The mat at a glance: the phone outline and the dots, the current one pulsing.
    private var matMap: some View {
        GeometryReader { g in
            let span = CGSize(width: 2 * 85.0, height: 2 * 124.0)     // mm covered by the dots
            let k = min(g.size.width / span.width, g.size.height / span.height)
            let c = CGPoint(x: g.size.width / 2, y: g.size.height / 2)
            let at = { (p: CGPoint) in CGPoint(x: c.x + p.x * k, y: c.y - p.y * k) }
            ZStack {
                RoundedRectangle(cornerRadius: 10 * k)
                    .stroke(Color.white.opacity(0.5), style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
                    .frame(width: RealDataMat.phoneSize.width * k, height: RealDataMat.phoneSize.height * k)
                    .position(c)
                Text("this phone").font(.caption2).foregroundStyle(.secondary).position(c)
                ForEach(Array(RealDataMat.dots.enumerated()), id: \.offset) { i, d in
                    let done = i < recorder.step
                    let current = i == recorder.step
                    ZStack {
                        Circle().fill(current ? Color.white : (done ? Color.white.opacity(0.35) : Color.white.opacity(0.1)))
                            .frame(width: current ? 14 : 9, height: current ? 14 : 9)
                            .scaleEffect(current && pulse ? 1.3 : 1)
                        if current {
                            Circle().trim(from: 0, to: recorder.progress)
                                .stroke(Color.white, style: StrokeStyle(lineWidth: 2, lineCap: .round))
                                .rotationEffect(.degrees(-90)).frame(width: 24, height: 24)
                        }
                        Text("\(i + 1)").font(.system(size: 9, weight: .semibold)).foregroundStyle(.secondary)
                            .offset(x: 13, y: -9)
                    }
                    .position(at(d))
                }
            }
        }
    }

    private func lapIfDone() {
        guard recorder.done, !flipping, !finished else { return }
        if lap == 1 {
            firstLap = recorder.samples
            flipping = true
            haptic.notificationOccurred(.warning)
        } else {
            finishOnce()
        }
    }

    private func startLapTwo() {
        lap = 2
        recorder.restart()
        flipping = false
    }

    private func finishOnce() {
        guard !finished else { return }
        finished = true
        let face = FollowSettings.shared.face
        let laps: [(Int, [SpotRecorder.Sample])] = lap == 1 && !flipping ? [(1, recorder.samples)] : [(1, firstLap), (2, recorder.samples)]
        let samples = laps.flatMap { lapNo, ss in
            ss.map { s in
                RealDataSample(dot: (RealDataMat.dots.firstIndex(of: s.dot) ?? -1) + 1, mm: s.dot, field: s.field,
                               readings: s.readings, lap: lapNo, face: face.map { lapNo == 1 ? $0 : -$0 })
            }
        }
        let url = RealDataStore.save(pass: pass, samples: samples)
        result = url == nil ? "Nothing saved." : "Saved \(samples.count) readings."
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.6) { onDone() }
    }
}

// MARK: - Taps & presence session

/// One scripted take: what to do, for how long, and what the field should
/// mean (the label the trainer reads).
struct SessionTake {
    let id: String
    let title: String
    let how: String
    let seconds: Double
    /// absent · present · present-then-absent · leftover · leftover-then-present ·
    /// bad-zero · taps · not-taps
    let label: String
    /// Prompts during the take: seconds from its start, and what to do then.
    var marks: [(at: Double, say: String)] = []
    /// Calibrate when the take starts (the bad-zero take).
    var calibrates = false

    static let all: [SessionTake] = [
        SessionTake(id: "clean-start", title: "No magnet", how: "Put the magnet more than 1 m away. Leave the phone still on the desk.", seconds: 8, label: "absent"),
        SessionTake(id: "held", title: "Held beside the phone", how: "Hold the magnet in your hand beside each edge in turn, a few seconds each: top, right, bottom, left. Keep it in your hand.", seconds: 16, label: "present"),
        SessionTake(id: "resting", title: "Set down", how: "Put the magnet down on the desk beside the phone and let go. Don't touch it.", seconds: 12, label: "present"),
        SessionTake(id: "away-fast", title: "Taken away fast", how: "Hold the magnet beside the phone. When told, take it away fast — more than 50 cm.", seconds: 9, label: "present-then-absent",
                    marks: [(4, "Take it away fast")]),
        SessionTake(id: "away-slow", title: "Taken away slowly", how: "Hold the magnet beside the phone. When told, take it away slowly, over about 3 seconds, more than 50 cm.", seconds: 11, label: "present-then-absent",
                    marks: [(4, "Take it away slowly")]),
        SessionTake(id: "overload", title: "Too close", how: "Bring the magnet onto the top of the screen until the phone warns it is too close. Hold it there. When told, take it more than 50 cm away and leave it.", seconds: 16, label: "leftover",
                    marks: [(5, "Take it far away and leave it")]),
        SessionTake(id: "overload-return", title: "Too close, then back", how: "Again onto the top of the screen until the warning. When told, take it away; then bring it back and hold it beside the phone.", seconds: 16, label: "leftover-then-present",
                    marks: [(5, "Take it away"), (9, "Bring it back beside the phone and hold it")]),
        SessionTake(id: "no-magnet-hand", title: "Phone in hand", how: "Magnet far away. Pick the phone up, hold it and turn it a little, then put it back down where it was.", seconds: 10, label: "absent"),
        SessionTake(id: "bad-zero", title: "Calibrated with the magnet near", how: "Lay the magnet on the desk 3 cm from the phone before you start: the phone calibrates with it there. When told, take the magnet far away.", seconds: 12, label: "bad-zero",
                    marks: [(4, "Take the magnet far away")], calibrates: true),
        SessionTake(id: "clean-mid", title: "No magnet", how: "Magnet more than 1 m away. Phone still on the desk.", seconds: 8, label: "absent"),
        SessionTake(id: "taps", title: "Air taps", how: "Hover the magnet about 5 cm over the top of the screen. Dip it quickly 2–3 cm toward the glass and straight back, about once a second. Ten dips.", seconds: 16, label: "taps"),
        SessionTake(id: "taps-low", title: "Air taps, lower half", how: "The same over the bottom half of the screen: ten quick dips.", seconds: 16, label: "taps"),
        SessionTake(id: "slow-dips", title: "Slow dips (not taps)", how: "Hover over the screen and dip slowly: 2 seconds down, 2 seconds back up. Four times.", seconds: 20, label: "not-taps"),
        SessionTake(id: "shallow-dips", title: "Tiny dips (not taps)", how: "Hover over the screen and make quick dips of under 1 cm. Eight times.", seconds: 14, label: "not-taps"),
        SessionTake(id: "dip-stay", title: "Dip and stay (not taps)", how: "Dip quickly toward the glass and stay down for 2 seconds, then rise slowly. Four times.", seconds: 22, label: "not-taps"),
        SessionTake(id: "lifts", title: "Lifts (not taps)", how: "Hover over the screen and lift the magnet quickly 3 cm up and back. Six times.", seconds: 14, label: "not-taps"),
        SessionTake(id: "sweeps", title: "Sweeps (not taps)", how: "Sweep the magnet quickly across the screen, left to right and back, at the same height. Six times.", seconds: 14, label: "not-taps"),
        SessionTake(id: "flicks", title: "Flicks (not taps)", how: "Hover over the screen and quickly tilt or flip the magnet in your fingers, without moving it closer. Six times.", seconds: 14, label: "not-taps"),
        SessionTake(id: "clean-end", title: "No magnet", how: "Put the magnet more than 1 m away. Leave the phone still on the desk.", seconds: 8, label: "absent"),
    ]
}

/// The guided session: one take at a time, the raw field logged at 50 Hz the
/// whole way through, saved after every take.
struct RealDataSession: View {
    let onDone: () -> Void
    private let takes = SessionTake.all
    @State private var index = 0
    @State private var startedAt: Double?
    @State private var now = 0.0
    @State private var done: [[String: Any]] = []
    @State private var rows: [[Double]] = []
    @State private var strength = 0.0
    @State private var tooClose = false
    @State private var lastMark = -1
    @State private var name = "\(RealDataStore.stamp())-session.json"
    @State private var saved = false
    // @State, not let: a view's stored lets are made again whenever its parent redraws.
    @State private var t0 = Date().timeIntervalSinceReferenceDate
    private let timer = Timer.publish(every: 1.0 / 50.0, on: .main, in: .common).autoconnect()
    private let haptic = UINotificationFeedbackGenerator()

    private var take: SessionTake? { index < takes.count ? takes[index] : nil }
    private var elapsed: Double { startedAt.map { now - $0 } ?? 0 }
    private var prompt: String? {
        guard let take, startedAt != nil else { return nil }
        return take.marks.last(where: { elapsed >= $0.at && elapsed < $0.at + 2.5 })?.say
    }

    var body: some View {
        VStack(spacing: 16) {
            if let take {
                Text("Take \(index + 1) of \(takes.count)").font(.footnote.weight(.semibold)).foregroundStyle(.secondary)
                Text(take.title).font(.title2.weight(.semibold)).foregroundStyle(.white)
                Text(take.how).font(.body).foregroundStyle(.white.opacity(0.85)).multilineTextAlignment(.center)
                    .frame(maxWidth: 340)
                Text(prompt ?? " ")
                    .font(.title3.weight(.bold)).foregroundStyle(.black)
                    .padding(.horizontal, 16).padding(.vertical, 8)
                    .background(Color.white, in: Capsule())
                    .opacity(prompt == nil ? 0 : 1)
                HStack(spacing: 8) {
                    Text("\(Int(strength.rounded())) µT").monospacedDigit()
                    if tooClose { Text("too close").foregroundStyle(.orange) }
                }
                .font(.footnote.monospaced()).foregroundStyle(.secondary)
                ProgressView(value: min(1, elapsed / take.seconds))
                    .tint(.white).frame(maxWidth: 300)
                    .opacity(startedAt == nil ? 0.3 : 1)
                HStack(spacing: 10) {
                    if startedAt == nil {
                        Button(index > 0 && done.contains(where: { ($0["id"] as? String) == take.id }) ? "Redo" : "Start") { start() }
                            .buttonStyle(.borderedProminent).tint(.white).foregroundStyle(.black)
                        Button("Skip") { index += 1 }.buttonStyle(.bordered)
                    }
                    Button("Finish") { finish() }.buttonStyle(.bordered)
                }
                .font(.body.weight(.medium))
            } else {
                Text(saved ? "Saved \(done.count) takes." : "Saving…").font(.headline).foregroundStyle(.white)
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.black.opacity(0.94))
        .onAppear { haptic.prepare() }
        .onReceive(timer) { date in tick(date.timeIntervalSinceReferenceDate) }
    }

    private func tick(_ t: Double) {
        now = t
        let r = MagnetSource.shared.reading(now: t)
        strength = r.strength
        tooClose = r.tooClose
        let zero = r.raw - r.delta
        rows.append([t - t0, r.raw.x, r.raw.y, r.raw.z, zero.x, zero.y, zero.z, r.presence, r.tooClose ? 1 : 0,
                     r.screenPosition.map { Double($0.x) } ?? -1, r.screenPosition.map { Double($0.y) } ?? -1, r.height ?? -99])
        guard let take, let s = startedAt else { return }
        if let m = take.marks.lastIndex(where: { t - s >= $0.at }), m > lastMark {
            lastMark = m
            haptic.notificationOccurred(.warning)
        }
        if t - s >= take.seconds {
            var entry: [String: Any] = ["id": take.id, "label": take.label, "start": s - t0, "end": t - t0]
            entry["marks"] = take.marks.map { ["at": s - t0 + $0.at, "say": $0.say] as [String: Any] }
            done.removeAll { ($0["id"] as? String) == take.id }
            done.append(entry)
            startedAt = nil
            index += 1
            haptic.notificationOccurred(.success)
            save()
            if index >= takes.count { finish() }
        }
    }

    private func start() {
        guard let take else { return }
        if take.calibrates { MagnetSource.shared.calibrate() }
        lastMark = -1
        startedAt = now
        haptic.notificationOccurred(.success)
    }

    private func save() {
        var payload = RealDataStore.header(pass: .session)
        payload["version"] = 1
        payload["hz"] = 50
        payload["columns"] = ["t", "raw_x", "raw_y", "raw_z", "zero_x", "zero_y", "zero_z", "presence", "too_close", "screen_x", "screen_y", "height_cm"]
        payload["axes"] = "raw: the magnetometer, µT, device axes (x right, y top, z out of the screen); zero: the no-magnet reading the kit used at that moment; t: seconds from the session start"
        payload["takes"] = done
        payload["rows"] = rows
        saved = RealDataStore.write(payload, name: name) != nil
    }

    private func finish() {
        index = takes.count
        if !done.isEmpty { save() } else { saved = true }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.6) { onDone() }
    }
}
