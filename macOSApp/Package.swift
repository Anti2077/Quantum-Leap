// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "iperf3GlassSpeed",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "iperf3GlassSpeed", targets: ["iperf3GlassSpeed"])
    ],
    targets: [
        .executableTarget(
            name: "iperf3GlassSpeed",
            path: "iperf3GlassSpeed"
        )
    ]
)
