import AppKit
import Foundation
import SafariServices
import notify

@objc(SafariWebExtensionHandler)
final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        let item = context.inputItems.first as? NSExtensionItem
        let message = item?.userInfo?[SFExtensionMessageKey] as? [String: Any]
        let response = NSExtensionItem()
        response.userInfo = [SFExtensionMessageKey: reply(to: message)]
        context.completeRequest(returningItems: [response], completionHandler: nil)
    }

    private func reply(to message: [String: Any]?) -> [String: Any] {
        let type = message?["type"] as? String
        guard type == "list" || type == "refresh" else {
            return ["error": "Unknown mailboxd request."]
        }
        let running = !NSRunningApplication.runningApplications(withBundleIdentifier: "com.mailboxd.local").isEmpty
        let state = SyncState.read()
        let openCompanion = "Open the mailboxd app to sync Apple Mail."
        if type == "refresh" {
            guard running else { return ["error": openCompanion] }
            guard notify_post(SyncState.refreshNotification) == 0 else {
                return ["error": "Safari could not ask mailboxd to sync. Try Sync Now in the mailboxd app."]
            }
            return ["refreshID": state.refreshID]
        }

        var result: [String: Any] = ["running": running, "refreshID": state.refreshID]
        result["refreshError"] = state.refreshError
        result["syncError"] = running ? state.error : openCompanion
        do {
            let feed = try Feed.read()
            let requestedRevision = message?["revision"] as? String
            let requestedOffset = message?["offset"] as? Int ?? 0
            let offset = requestedRevision == feed.revision ? min(max(0, requestedOffset), feed.items.count) : 0
            let page = Array(feed.items.dropFirst(offset).prefix(30))
            let items = try JSONSerialization.jsonObject(with: JSONEncoder().encode(page))
            result["revision"] = feed.revision
            result["syncedAt"] = feed.syncedAt
            result["warning"] = feed.warning
            result["items"] = items
            result["total"] = feed.items.count
        } catch {
            if result["syncError"] == nil {
                result["syncError"] = "Open the mailboxd app and click Start Syncing."
            }
        }
        return result
    }
}
