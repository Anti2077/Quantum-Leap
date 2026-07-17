import SwiftUI
import Charts

struct ContentView: View {
    @EnvironmentObject var model: SpeedTestViewModel

    var body: some View {
        ZStack {
            LinearGradient(colors: [.black, .blue.opacity(0.22), .purple.opacity(0.18)], startPoint: .topLeading, endPoint: .bottomTrailing)
                .ignoresSafeArea()

            HStack(spacing: 24) {
                GlassCard {
                    VStack(alignment: .leading, spacing: 16) {
                        Text("iperf3 / SSH")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        RoundedRectangle(cornerRadius: 24, style: .continuous)
                            .fill(.white.opacity(0.08))
                            .frame(height: 120)
                            .overlay(
                                Image(systemName: "desktopcomputer")
                                    .font(.system(size: 42, weight: .light))
                                    .foregroundStyle(.white.opacity(0.9))
                            )

                        glassField("目标 IP", text: $model.credentials.host)
                        glassField("端口", text: $model.credentials.port)
                        glassField("用户名", text: $model.credentials.username)
                        SecureField("SSH 密码", text: $model.credentials.password)
                            .textFieldStyle(.roundedBorder)

                        Picker("方向", selection: $model.credentials.direction) {
                            Text("上传").tag(Direction.upload)
                            Text("下载").tag(Direction.download)
                        }
                        .pickerStyle(.segmented)

                        HStack {
                            Button("开始测速") { model.start() }
                            Button("中断") { model.stop() }
                        }
                        .buttonStyle(.borderedProminent)

                        Text(model.status.message)
                            .foregroundStyle(.secondary)
                    }
                }

                GlassCard {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("\(model.currentMbps, specifier: "%.2f") Mbps")
                            .font(.system(size: 44, weight: .semibold, design: .rounded))
                        Text("Latency: \(model.status.latencyMs.map { String(format: "%.1f ms", $0) } ?? "--")")
                            .foregroundStyle(.secondary)
                        Chart(model.samples) { point in
                            AreaMark(x: .value("t", point.time), y: .value("Mbps", point.bandwidthMbps))
                                .foregroundStyle(.linearGradient(colors: [.cyan.opacity(0.8), .blue.opacity(0.1)], startPoint: .top, endPoint: .bottom))
                            LineMark(x: .value("t", point.time), y: .value("Mbps", point.bandwidthMbps))
                                .foregroundStyle(.cyan)
                        }
                        .chartXAxis(.hidden)
                        .chartYAxis(.hidden)
                        .frame(height: 320)
                    }
                }
            }
            .padding(28)
        }
    }

    private func glassField(_ title: String, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.caption2).foregroundStyle(.secondary)
            TextField(title, text: text)
                .textFieldStyle(.roundedBorder)
        }
    }
}

struct GlassCard<Content: View>: View {
    @ViewBuilder let content: Content
    var body: some View {
        content
            .padding(24)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 28, style: .continuous).stroke(.white.opacity(0.12), lineWidth: 1))
            .shadow(color: .black.opacity(0.3), radius: 30, y: 12)
    }
}
