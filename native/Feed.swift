import Foundation

struct NotificationItem: Codable, Equatable {
    let messageID: String
    let subject: String
    let receivedAt: String
    let kind: String
    let detail: String
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

    static var storage: URL {
        // NSHomeDirectory can return the sandbox container for the extension.
        let home = getpwuid(getuid()).map { String(cString: $0.pointee.pw_dir) } ?? NSHomeDirectory()
        return URL(fileURLWithPath: home, isDirectory: true)
            .appendingPathComponent("Library/Application Support/mailboxd", isDirectory: true)
            .appendingPathComponent("feed.json")
    }

    func save() throws {
        let directory = Self.storage.deletingLastPathComponent()
        let files = FileManager.default
        try files.createDirectory(at: directory, withIntermediateDirectories: true,
                                  attributes: [.posixPermissions: 0o700])
        try files.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)
        try JSONEncoder().encode(self).write(to: Self.storage, options: .atomic)
        try files.setAttributes([.posixPermissions: 0o600], ofItemAtPath: Self.storage.path)
    }
}
