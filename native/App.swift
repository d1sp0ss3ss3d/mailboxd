import AppKit
import Foundation

private struct SyncProblem: LocalizedError {
    let errorDescription: String?
    init(_ message: String) { errorDescription = message }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow!
    private var timer: Timer?
    private var syncing = false
    private let status = NSTextField(wrappingLabelWithString: "Ready to sync your Letterboxd emails.")
    private let button = NSButton(title: "Start Syncing", target: nil, action: nil)
    private let preference = "automaticMailSync"

    func applicationDidFinishLaunching(_ notification: Notification) {
        let heading = NSTextField(labelWithString: "mailboxd")
        heading.font = .systemFont(ofSize: 28, weight: .semibold)
        let description = NSTextField(wrappingLabelWithString:
            "Read Letterboxd notifications from Apple Mail in Safari’s Activity → Email tab. Keep mailboxd running to sync every five minutes.")
        description.textColor = .secondaryLabelColor
        status.font = .systemFont(ofSize: 13)
        status.maximumNumberOfLines = 4
        button.target = self
        button.action = #selector(syncNow)
        button.bezelStyle = .rounded
        button.keyEquivalent = "\r"

        let stack = NSStackView(views: [heading, description, button, status])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 14
        stack.translatesAutoresizingMaskIntoConstraints = false
        let view = NSView()
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),
            stack.topAnchor.constraint(equalTo: view.topAnchor, constant: 22),
            stack.bottomAnchor.constraint(lessThanOrEqualTo: view.bottomAnchor, constant: -22),
            description.widthAnchor.constraint(equalTo: stack.widthAnchor),
            status.widthAnchor.constraint(equalTo: stack.widthAnchor)
        ])

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 455, height: 250),
                          styleMask: [.titled, .closable, .miniaturizable],
                          backing: .buffered, defer: false)
        window.title = "mailboxd"
        window.isReleasedWhenClosed = false
        window.contentView = view
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        if UserDefaults.standard.bool(forKey: preference) { syncNow() }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { window.makeKeyAndOrderFront(nil) }
        return true
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    @objc private func syncNow() {
        guard !syncing else { return }
        syncing = true
        button.isEnabled = false
        button.title = "Sync Now"
        status.stringValue = "Checking Apple Mail…"
        UserDefaults.standard.set(true, forKey: preference)

        Task {
            let result = await Task.detached(priority: .utility) {
                Result { try Self.syncMail() }
            }.value
            syncing = false
            button.isEnabled = true
            switch result {
            case .success(let feed):
                let count = feed.items.count
                status.stringValue = "Synced \(count) Letterboxd \(count == 1 ? "email" : "emails"). " + feed.warning
            case .failure(let error):
                status.stringValue = error.localizedDescription
            }
            timer?.invalidate()
            timer = Timer.scheduledTimer(withTimeInterval: 300, repeats: false) { [weak self] _ in
                Task { @MainActor in self?.syncNow() }
            }
        }
    }

    nonisolated private static func syncMail() throws -> Feed {
        guard let script = Bundle.main.url(forResource: "read-mail", withExtension: "js") else {
            throw SyncProblem("The Apple Mail reader is missing. Rebuild mailboxd.")
        }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        process.arguments = ["-l", "JavaScript", script.path]
        let output = Pipe()
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice
        try process.run()
        let timeout = DispatchWorkItem {
            if process.isRunning { process.terminate() }
        }
        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 180, execute: timeout)
        defer { timeout.cancel() }
        let data = output.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else {
            throw SyncProblem("Apple Mail did not finish. Open Mail and try syncing again.")
        }
        let scan = try JSONDecoder().decode(MailScan.self, from: data)
        guard let items = scan.items else {
            throw SyncProblem(scan.error ?? "Apple Mail returned no feed.")
        }
        let previous = try? Feed.read()
        let revision = previous.flatMap { $0.items == items ? $0.revision : nil } ?? UUID().uuidString
        let feed = Feed(revision: revision, syncedAt: ISO8601DateFormatter().string(from: Date()),
                        items: items, warning: scan.warning ?? "")
        try feed.save()
        return feed
    }
}

@main
enum MailboxdApp {
    @MainActor static func main() {
        let application = NSApplication.shared
        let delegate = AppDelegate()
        application.delegate = delegate
        application.setActivationPolicy(.regular)

        let menu = NSMenu()
        let appMenuItem = NSMenuItem()
        menu.addItem(appMenuItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Quit mailboxd", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appMenuItem.submenu = appMenu
        application.mainMenu = menu
        application.run()
    }
}
