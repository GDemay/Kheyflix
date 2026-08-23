import SwiftUI

struct RootView: View {
    @StateObject private var model = WebViewModel()
    @State private var showLaunchBrand = !AppConfiguration.isUITesting
    @State private var showServerSettings = false

    var body: some View {
        ZStack {
            Color(red: 0.031, green: 0.035, blue: 0.043).ignoresSafeArea()
            KheyflixWebView(model: model).ignoresSafeArea()

            if model.isLoading && model.progress < 1 {
                VStack {
                    ProgressView(value: model.progress)
                        .tint(.red)
                        .accessibilityLabel("Loading Kheyflix")
                    Spacer()
                }
                .ignoresSafeArea(edges: .horizontal)
            }

            if let message = model.errorMessage {
                ConnectionView(message: message, retry: model.reload, settings: { showServerSettings = true })
                    .transition(.opacity.combined(with: .scale(scale: 0.98)))
            }

            if showLaunchBrand {
                LaunchBrandView()
                    .transition(.opacity)
                    .task {
                        try? await Task.sleep(for: .milliseconds(900))
                        withAnimation(.easeOut(duration: 0.35)) { showLaunchBrand = false }
                    }
            }
        }
        .preferredColorScheme(.dark)
        .statusBarHidden(false)
        .sheet(isPresented: $showServerSettings) {
            ServerSettingsView(initialValue: AppConfiguration.baseURL.absoluteString) { value in
                if model.loadServer(value) { showServerSettings = false; return true }
                return false
            }
            .presentationDetents([.medium])
            .presentationDragIndicator(.visible)
        }
    }
}

private struct LaunchBrandView: View {
    var body: some View {
        ZStack {
            RadialGradient(colors: [Color.red.opacity(0.18), .black], center: .center, startRadius: 5, endRadius: 360)
                .ignoresSafeArea()
            VStack(spacing: 10) {
                Text("K").font(.system(size: 132, weight: .black, design: .rounded)).foregroundStyle(.red)
                    .shadow(color: .red.opacity(0.35), radius: 28)
                Text("KHEYFLIX").font(.system(size: 16, weight: .bold)).tracking(7)
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Kheyflix")
        }
    }
}

private struct ConnectionView: View {
    let message: String
    let retry: () -> Void
    let settings: () -> Void

    var body: some View {
        VStack(spacing: 18) {
            Image(systemName: "wifi.exclamationmark").font(.system(size: 42, weight: .medium)).foregroundStyle(.red)
            Text("Connection interrupted").font(.title2.bold())
            Text(message).foregroundStyle(.secondary).multilineTextAlignment(.center)
            Button("Try Again", action: retry).buttonStyle(.borderedProminent).tint(.white).foregroundStyle(.black)
                .accessibilityIdentifier("connection.retry")
            Button("Server Settings", action: settings).foregroundStyle(.secondary)
                .accessibilityIdentifier("connection.settings")
        }
        .padding(32).frame(maxWidth: 380).background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 24))
        .padding(24).accessibilityElement(children: .contain)
    }
}

private struct ServerSettingsView: View {
    @State var value: String
    @State private var invalid = false
    let save: (String) -> Bool

    init(initialValue: String, save: @escaping (String) -> Bool) {
        _value = State(initialValue: initialValue)
        self.save = save
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Kheyflix server") {
                    TextField("https://kheyflix.example", text: $value)
                        .textInputAutocapitalization(.never).keyboardType(.URL).autocorrectionDisabled()
                        .accessibilityIdentifier("server.url")
                    if invalid { Text("Enter a valid HTTP or HTTPS address.").foregroundStyle(.red) }
                }
                Section { Text("AllDebrid credentials stay on this server and are never stored in the iOS app.").foregroundStyle(.secondary) }
            }
            .navigationTitle("Server Settings")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Connect") { invalid = !save(value) } } }
        }
    }
}
