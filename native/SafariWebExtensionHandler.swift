import Foundation
import SafariServices

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
        guard message?["type"] as? String == "list" else {
            return ["error": "Unknown mailboxd request."]
        }
        do {
            let feed = try Feed.read()
            let requestedRevision = message?["revision"] as? String
            let requestedOffset = message?["offset"] as? Int ?? 0
            let offset = requestedRevision == feed.revision ? min(max(0, requestedOffset), feed.items.count) : 0
            let page = Array(feed.items.dropFirst(offset).prefix(30))
            let items = try JSONSerialization.jsonObject(with: JSONEncoder().encode(page))
            return [
                "revision": feed.revision, "syncedAt": feed.syncedAt, "warning": feed.warning,
                "items": items, "total": feed.items.count
            ]
        } catch {
            return ["error": "Open the mailboxd app and sync your Apple Mail notifications first."]
        }
    }
}
