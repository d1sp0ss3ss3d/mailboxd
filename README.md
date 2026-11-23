# mailboxd

mailboxd adds an **Email** tab after **Friends**, **You**, and **Incoming** in your signed-in Letterboxd Activity feed. It brings together Letterboxd emails already in Apple Mail, newest first. Comment notifications show an excerpt and a **View and Reply** link to the original comment when available. Other entries link to their original messages in Apple Mail.

## Install and update

Requires macOS 14 or later, Safari 17 or later, and an account configured in Apple Mail.

1. Unzip the build and move `mailboxd.app` into **Applications** before opening it. On updates, quit mailboxd and replace the app at the same path. If you already installed it in `~/Applications`, use that location instead.
2. Open that installed copy once. Click **Start Syncing** and approve access to Apple Mail when macOS prompts. Select **Open at login** if you want syncing to start whenever you sign in to your Mac.
3. In **Safari → Settings → Extensions**, enable **mailboxd** and grant access to **letterboxd.com**. For an ad hoc build, first turn on **Allow unsigned extensions** in the Developer tab. Safari resets that setting on quit. [Running your Safari web extension](https://developer.apple.com/documentation/safariservices/running-your-safari-web-extension)
4. Open [Letterboxd Activity](https://letterboxd.com/activity/) while signed in and select **Email**. While both apps are running, the companion checks Apple Mail every 15 seconds and the visible tab updates automatically. **Refresh** in Safari and **Sync Now** in the companion ask Apple Mail to get new mail and scan for changes. Deliveries that take longer to download appear on a later scan.

The companion app contains the Safari extension and provides its native connection to the local feed. If Safari lists mailboxd more than once, quit Safari and mailboxd, then remove the extra app copies from locations such as Downloads, Applications, and your build folder. Use the installed copy when you reopen mailboxd. To locate installed plug-ins, run `pluginkit -m -A -D -vv -i com.mailboxd.local.extension`.

## Build from source

Install the Xcode Command Line Tools. Build in a local staging directory to avoid Finder metadata from cloud sync, then install the resulting app at your existing Applications path.

```sh
git clone https://github.com/d1sp0ss3ss3d/mailboxd.git
cd mailboxd
./scripts/build.sh "$(mktemp -d)"
```

The default build is ad hoc signed. For a local developer-signed build, set `MAILBOXD_SIGN_IDENTITY` to the certificate name or SHA-1 shown by `security find-identity -v -p codesigning`. Public distribution outside the Mac App Store requires a Developer ID signature and notarization. [Distributing your Safari web extension](https://developer.apple.com/documentation/safariservices/distributing-your-safari-web-extension)

## Email access

The companion scans the inbox and folders available in Apple Mail across enabled accounts, including local folders. It checks for an exact `letterboxd.com` sender domain, skips Trash and Junk, excludes messages marked as junk or deleted, and deduplicates by message ID. Archiving keeps an email in the feed. Availability depends on the mail that Apple Mail can see. Messages from unfamiliar templates still appear with their original subjects.

The app writes subjects, dates, message IDs, and available comment excerpts and permalinks to `~/Library/Application Support/mailboxd/feed.json`. Safari reads that file locally through its native extension. The extension renders messages as text in a closed shadow root on the Activity page and loads no remote email content. The app uses Apple Mail’s existing login sessions. There is no mailboxd server, account, analytics, or outbound email.

## Checks

With Node.js installed, run `node --test tests/*.test.js` to check the Mail reader against synthetic messages. Run `./scripts/build.sh` to compile and verify the ad hoc-signed app and its embedded extension.
