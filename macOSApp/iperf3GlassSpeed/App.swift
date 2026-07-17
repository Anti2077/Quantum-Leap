import SwiftUI

@main
struct iperf3GlassSpeedApp: App {
    @StateObject private var model = SpeedTestViewModel()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(model)
        }
        .windowStyle(.hiddenTitleBar)
    }
}
