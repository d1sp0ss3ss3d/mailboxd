import AppKit
import Darwin
import Foundation
import ServiceManagement
import notify

private struct SyncProblem: LocalizedError {
    let errorDescription: String?
    init(_ message: String) { errorDescription = message }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow!
    private var timer: Timer?
    private var syncing = false
    private var fetchingMail = false
    private var refreshQueued = false
    private var refreshToken: Int32 = 0
    private var syncState = SyncState.read()
    private let status = NSTextField(wrappingLabelWithString: "Ready to sync your Letterboxd emails.")
    private let button = NSButton(title: "Start Syncing", target: nil, action: nil)
    private let launchAtLogin = NSButton(checkboxWithTitle: "Open at login", target: nil, action: nil)
    private let preference = "automaticMailSync"

    func applicationDidFinishLaunching(_ notification: Notification) {
        let heading = NSTextField(labelWithString: "mailboxd")
        heading.font = .systemFont(ofSize: 28, weight: .semibold)
        let description = NSTextField(wrappingLabelWithString:
            "Read Letterboxd notifications in Safari’s Activity → Email tab. mailboxd checks Apple Mail every 15 seconds while both apps run.")
        description.textColor = .secondaryLabelColor
        status.font = .systemFont(ofSize: 13)
        status.maximumNumberOfLines = 4
        button.target = self
        button.action = #selector(syncNow)
        button.bezelStyle = .rounded
        button.keyEquivalent = "\r"
        launchAtLogin.target = self
        launchAtLogin.action = #selector(changeLaunchAtLogin(_:))
        updateLoginItem()

        let stack = NSStackView(views: [heading, description, button, launchAtLogin, status])
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

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 455, height: 272),
                          styleMask: [.titled, .closable, .miniaturizable],
                          backing: .buffered, defer: false)
        window.title = "mailboxd"
        window.isReleasedWhenClosed = false
        window.contentView = view
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        notify_register_dispatch(SyncState.refreshNotification, &refreshToken, .main) { [weak self] _ in
            Task { @MainActor in self?.refreshFromSafari() }
        }
        if UserDefaults.standard.bool(forKey: preference) {
            button.title = "Sync Now"
            startSync(fetch: false)
        }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { window.makeKeyAndOrderFront(nil) }
        return true
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    func applicationWillTerminate(_ notification: Notification) {
        notify_cancel(refreshToken)
    }

    func applicationDidBecomeActive(_ notification: Notification) {
        updateLoginItem()
    }

    private func updateLoginItem() {
        let loginStatus = SMAppService.mainApp.status
        launchAtLogin.state = loginStatus == .enabled || loginStatus == .requiresApproval ? .on : .off
        launchAtLogin.title = loginStatus == .requiresApproval ? "Open at login (approval pending)" : "Open at login"
    }

    @objc private func changeLaunchAtLogin(_ sender: NSButton) {
        let service = SMAppService.mainApp
        do {
            if sender.state == .on {
                try service.register()
                if service.status == .requiresApproval { SMAppService.openSystemSettingsLoginItems() }
            } else {
                try service.unregister()
            }
        } catch {
            NSAlert(error: error).runModal()
        }
        updateLoginItem()
    }

    @objc private func syncNow() {
        UserDefaults.standard.set(true, forKey: preference)
        startSync(fetch: true)
    }

    private func refreshFromSafari() {
        guard UserDefaults.standard.bool(forKey: preference) else {
            recordResult(error: "Click Start Syncing in the mailboxd app to connect Apple Mail.", fetch: true)
            return
        }
        startSync(fetch: true)
    }

    private func startSync(fetch: Bool) {
        if syncing {
            if fetch && !fetchingMail { refreshQueued = true }
            return
        }
        timer?.invalidate()
        if !fetch && NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.mail").isEmpty {
            let message = "Open Apple Mail to receive and sync new messages."
            status.stringValue = message
            recordResult(error: message, fetch: false)
            scheduleSync()
            return
        }
        syncing = true
        fetchingMail = fetch
        button.isEnabled = false
        button.title = "Sync Now"
        status.stringValue = "Checking Apple Mail…"

        Task {
            let result = await Task.detached(priority: .utility) {
                Result { try Self.syncMail(fetch: fetch) }
            }.value
            syncing = false
            button.isEnabled = true
            switch result {
            case .success(let feed):
                let count = feed.items.count
                status.stringValue = "Synced \(count) Letterboxd \(count == 1 ? "email" : "emails"). " + feed.warning
                recordResult(error: nil, fetch: fetch)
            case .failure(let error):
                status.stringValue = error.localizedDescription
                recordResult(error: error.localizedDescription, fetch: fetch)
            }
            if refreshQueued {
                refreshQueued = false
                startSync(fetch: true)
            } else {
                scheduleSync()
            }
        }
    }

    private func recordResult(error: String?, fetch: Bool) {
        let previous = syncState
        syncState.error = error
        if fetch {
            syncState.refreshID = UUID().uuidString
            syncState.refreshError = error
        }
        guard syncState != previous else { return }
        do {
            try syncState.save()
        } catch {
            status.stringValue = "Could not save the mailboxd sync status."
            syncState = previous
        }
    }

    private func scheduleSync() {
        timer = Timer.scheduledTimer(withTimeInterval: 15, repeats: false) { [weak self] _ in
            Task { @MainActor in self?.startSync(fetch: false) }
        }
        timer?.tolerance = 2
    }

    nonisolated private static func syncMail(fetch: Bool) throws -> Feed {
        guard let script = Bundle.main.url(forResource: "read-mail", withExtension: "js") else {
            throw SyncProblem("The Apple Mail reader is missing. Rebuild mailboxd.")
        }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        process.arguments = ["-l", "JavaScript", script.path, Feed.storage.path, fetch ? "refresh" : "scan"]
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
        let lockPath = (NSTemporaryDirectory() as NSString).appendingPathComponent("com.mailboxd.local.lock")
        let descriptor = open(lockPath, O_CREAT | O_RDWR | O_CLOEXEC | O_NOFOLLOW, 0o600)
        guard descriptor >= 0 else {
            NSAlert(error: NSError(domain: NSPOSIXErrorDomain, code: Int(errno))).runModal()
            return
        }
        defer { close(descriptor) }
        guard flock(descriptor, LOCK_EX | LOCK_NB) == 0 else {
            let failure = errno
            if failure == EWOULDBLOCK {
                if let identifier = Bundle.main.bundleIdentifier {
                    let running = NSRunningApplication.runningApplications(withBundleIdentifier: identifier)
                    running.first { $0.processIdentifier != getpid() }?.activate()
                }
            } else {
                NSAlert(error: NSError(domain: NSPOSIXErrorDomain, code: Int(failure))).runModal()
            }
            return
        }

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
