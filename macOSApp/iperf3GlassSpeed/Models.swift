import Foundation

struct Credentials {
    var host: String = ""
    var port: String = "5201"
    var username: String = ""
    var password: String = ""
    var direction: Direction = .upload
}

enum Direction: String, CaseIterable, Identifiable {
    case upload
    case download
    var id: String { rawValue }
}

struct SamplePoint: Identifiable {
    let id = UUID()
    let time: Double
    let bandwidthMbps: Double
}

struct LiveStatus {
    var phase: String = "idle"
    var message: String = "准备就绪"
    var latencyMs: Double? = nil
    var jitterMs: Double? = nil
    var retransmits: Int? = nil
}
