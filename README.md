# mailboxd

mailboxd adds an **Email** tab after **Friends**, **You**, and **Incoming** in your signed-in Letterboxd Activity feed. It brings together Letterboxd emails already in Apple Mail, newest first, with a link to open each original message. It recognizes new followers and comments, shows a comment excerpt when available, and includes other Letterboxd emails by subject.

## Build and use on your Mac

Requires macOS 14 or later, Safari 17 or later, the Xcode Command Line Tools, and an email account already configured in Apple Mail.

```sh
git clone https://github.com/d1sp0ss3ss3d/mailboxd.git
cd mailboxd
./scripts/build.sh "$HOME/Applications"
open "$HOME/Applications/mailboxd.app"
```

1. In the mailboxd app, click **Start Syncing** and allow mailboxd to control **Mail** when macOS prompts you. The first scan can take a while on a large mailbox. Keep mailboxd running for automatic sync every five minutes. **Sync Now** requests an immediate scan.
2. Enable the Safari development features in **Safari → Settings → Advanced** if the Developer tab is hidden. In **Settings → Developer**, select **Allow unsigned extensions** for this local development build.
3. In **Safari → Settings → Extensions**, enable **mailboxd** and allow it to run on **letterboxd.com** when prompted. If you quit Safari, the unsigned extensions setting resets. Enable it again when you next use mailboxd.
4. Open [Letterboxd Activity](https://letterboxd.com/activity/) while signed in, reload the page if it was already open, and select **Email**. The **Refresh** button reads the latest local feed. If Apple Mail has just downloaded a new message, you can use **Sync Now** in the Mac app first.

This is a local development build for Safari on macOS. The Safari extension is embedded in the app so native messaging can work. Apple documents the steps for running development builds. [Running your Safari web extension](https://developer.apple.com/documentation/safariservices/running-your-safari-web-extension)

Build or unzip the app into a local folder such as `~/Applications`. Cloud-synced folders can add Finder metadata that interferes with macOS signature verification.

## Email access

The companion scans the inbox and folders available in Apple Mail across enabled accounts, including local folders. It checks for an exact `letterboxd.com` sender domain, excludes messages marked as junk or deleted, and deduplicates by message ID. Availability depends on the mail that Apple Mail can see. Messages from unfamiliar templates still appear with their original subjects.

The app writes subjects, dates, message IDs, and available comment excerpts to `~/Library/Application Support/mailboxd/feed.json`. Safari reads that file locally through its native extension. The extension renders messages as text in a closed shadow root on the Activity page and loads no remote email content. The app uses Apple Mail’s existing login sessions. There is no mailboxd server, account, analytics, or outbound email.

## Checks

With Node.js installed, run `node --test tests/*.test.js` to check the Mail reader against synthetic messages. Run `./scripts/build.sh` to compile and verify the ad hoc-signed app and its embedded extension.
