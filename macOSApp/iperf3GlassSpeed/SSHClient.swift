import Foundation

final class SSHClient {
    private let host: String
    private let port: Int
    private let username: String
    private let password: String

    init(host: String, port: Int, username: String, password: String) {
        self.host = host
        self.port = port
        self.username = username
        self.password = password
    }

    func startIperfServer(serverPort: Int) throws -> Int32 {
        let output = try runSSH(
            command: "nohup sh -lc 'iperf3 -s -p \(serverPort) >/tmp/iperf3_ui.log 2>&1 & echo $!'"
        )
        return Int32(output.trimmingCharacters(in: .whitespacesAndNewlines)) ?? 0
    }

    func killProcess(_ pid: Int32) throws {
        _ = try runSSH(command: "kill \(pid) >/dev/null 2>&1 || true")
    }

    private func runSSH(command: String) throws -> String {
        let askpassURL = try makeAskpassHelper()
        defer { try? FileManager.default.removeItem(at: askpassURL) }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/ssh")
        process.arguments = [
            "-o", "PreferredAuthentications=password",
            "-o", "PubkeyAuthentication=no",
            "-o", "KbdInteractiveAuthentication=no",
            "-o", "StrictHostKeyChecking=accept-new",
            "-p", "\(port)",
            "\(username)@\(host)",
            command
        ]

        let outputPipe = Pipe()
        let errorPipe = Pipe()
        process.standardOutput = outputPipe
        process.standardError = errorPipe
        process.standardInput = Pipe()

        var environment = ProcessInfo.processInfo.environment
        environment["SSH_ASKPASS"] = askpassURL.path
        environment["SSH_ASKPASS_REQUIRE"] = "force"
        environment["DISPLAY"] = ":0"
        environment["IPERF3_UI_SSH_PASSWORD"] = password
        process.environment = environment

        try process.run()
        process.waitUntilExit()

        let output = String(data: outputPipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        let errorOutput = String(data: errorPipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""

        guard process.terminationStatus == 0 else {
            throw NSError(domain: "ssh", code: Int(process.terminationStatus), userInfo: [
                NSLocalizedDescriptionKey: errorOutput.isEmpty ? "SSH 执行失败" : errorOutput
            ])
        }

        return output
    }

    private func makeAskpassHelper() throws -> URL {
        let helperURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("iperf3_askpass_\(UUID().uuidString)")

        let script = "#!/bin/sh\nprintf '%s\\n' \"$IPERF3_UI_SSH_PASSWORD\"\n"
        try script.write(to: helperURL, atomically: true, encoding: .utf8)

        var permissions = try FileManager.default.attributesOfItem(atPath: helperURL.path)
        permissions[.posixPermissions] = 0o700
        try FileManager.default.setAttributes(permissions, ofItemAtPath: helperURL.path)
        return helperURL
    }
}
