import Foundation
import Combine

@MainActor
final class SpeedTestViewModel: ObservableObject {
    @Published var credentials = Credentials()
    @Published var status = LiveStatus()
    @Published var samples: [SamplePoint] = []
    @Published var currentMbps: Double = 0
    @Published var running = false

    private var task: Task<Void, Never>?
    private var remotePid: Int32?
    private var localProcess: Process?

    func start() {
        guard !running else { return }
        running = true
        samples.removeAll()
        currentMbps = 0
        status = LiveStatus(phase: "starting", message: "正在连接 SSH...")

        task = Task {
            var ssh: SSHClient?
            do {
                let port = Int(credentials.port) ?? 5201
                ssh = SSHClient(host: credentials.host,
                                port: 22,
                                username: credentials.username,
                                password: credentials.password)
                let pid = try ssh!.startIperfServer(serverPort: port)
                guard pid > 0 else { throw NSError(domain: "iperf3", code: -1, userInfo: [NSLocalizedDescriptionKey: "无法获取远端进程 PID"]) }
                remotePid = pid
                status = LiveStatus(phase: "running", message: "测速中...")
                try await runLocalClient(port: port, direction: credentials.direction)
                status.phase = "completed"
                status.message = "测速完成"
            } catch {
                status.phase = "failed"
                status.message = error.localizedDescription
            }
            if let remotePid, let ssh {
                try? ssh.killProcess(remotePid)
                self.remotePid = nil
            }
            running = false
        }
    }

    func stop() {
        task?.cancel()
        localProcess?.terminate()
        localProcess = nil
        if let remotePid {
            let ssh = SSHClient(host: credentials.host, port: 22, username: credentials.username, password: credentials.password)
            try? ssh.killProcess(remotePid)
            self.remotePid = nil
        }
        status.phase = "cancelled"
        status.message = "已中断"
        running = false
    }

    private func runLocalClient(port: Int, direction: Direction) async throws {
        let process = Process()
        process.executableURL = try locateIperf3()
        var args = ["-c", credentials.host, "-p", "\(port)", "-J", "-i", "1"]
        if direction == .download { args.append("-R") }
        process.arguments = args

        let outputPipe = Pipe()
        process.standardOutput = outputPipe
        process.standardError = Pipe()
        try process.run()
        localProcess = process
        defer { localProcess = nil }

        let data = try outputPipe.fileHandleForReading.readToEnd() ?? Data()
        if let output = String(data: data, encoding: .utf8) {
            parseLiveOutput(output)
        }
        process.waitUntilExit()
    }

    private func parseLiveOutput(_ text: String) {
        for line in text.split(separator: "\n") {
            guard let data = line.data(using: .utf8),
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }

            if let end = json["end"] as? [String: Any],
               let sum = end["sum_received"] as? [String: Any] ?? end["sum_sent"] as? [String: Any],
               let bps = sum["bits_per_second"] as? Double {
                let mbps = bps / 1_000_000
                currentMbps = mbps
                samples.append(SamplePoint(time: Double(samples.count), bandwidthMbps: mbps))
                status.latencyMs = sum["mean_rtt"] as? Double
                status.jitterMs = sum["jitter_ms"] as? Double
                status.retransmits = sum["retransmits"] as? Int
            } else if let interval = json["interval"] as? [String: Any],
                      let sum = interval["sum"] as? [String: Any],
                      let bps = sum["bits_per_second"] as? Double {
                let mbps = bps / 1_000_000
                currentMbps = mbps
                samples.append(SamplePoint(time: Double(samples.count), bandwidthMbps: mbps))
            }
        }
    }

    private func locateIperf3() throws -> URL {
        let candidates = [
            "/opt/homebrew/bin/iperf3",
            "/usr/local/bin/iperf3",
            "/usr/bin/iperf3"
        ]
        for path in candidates where FileManager.default.isExecutableFile(atPath: path) {
            return URL(fileURLWithPath: path)
        }
        throw NSError(domain: "iperf3", code: -2, userInfo: [NSLocalizedDescriptionKey: "未找到 iperf3，请先安装 Homebrew 版 iperf3"])
    }
}
