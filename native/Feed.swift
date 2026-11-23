import Foundation

struct NotificationItem: Codable, Equatable {
    let messageID: String
    let subject: String
    let receivedAt: String
    let kind: String
    let detail: String
    let commentURL: String?
}

struct MailScan: Decodable {
    let items: [NotificationItem]?
    let warning: String?
    let error: String?
}

struct Feed: Codable {
    let revision: String
    let syncedAt: String
    let items: [NotificationItem]
    let warning: String

    static func read() throws -> Self {
        try JSONDecoder().decode(Self.self, from: Data(contentsOf: storage))
    }

    fileprivate static var directory: URL {
        // NSHomeDirectory can return the sandbox container for the extension.
        let home = getpwuid(getuid()).map { String(cString: $0.pointee.pw_dir) } ?? NSHomeDirectory()
        return URL(fileURLWithPath: home, isDirectory: true)
            .appendingPathComponent("Library/Application Support/mailboxd", isDirectory: true)
    }

    static var storage: URL { directory.appendingPathComponent("feed.json") }

    func save() throws {
        try saveSnapshot(self, at: Self.storage)
    }
}

struct SyncState: Codable, Equatable {
    static var refreshNotification: String { "com.mailboxd.local.refresh-mail.\(getuid())" }
    private static var storage: URL { Feed.directory.appendingPathComponent("sync-state.json") }

    var refreshID = ""
    var refreshError: String?
    var error: String?

    static func read() -> Self {
        (try? JSONDecoder().decode(Self.self, from: Data(contentsOf: storage))) ?? Self()
    }

    func save() throws {
        try saveSnapshot(self, at: Self.storage)
    }
}

private func saveSnapshot<T: Encodable>(_ snapshot: T, at url: URL) throws {
    let directory = url.deletingLastPathComponent()
    let files = FileManager.default
    try files.createDirectory(at: directory, withIntermediateDirectories: true,
                              attributes: [.posixPermissions: 0o700])
    try files.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)
    try JSONEncoder().encode(snapshot).write(to: url, options: .atomic)
    try files.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
}
