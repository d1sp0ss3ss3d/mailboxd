// Executed by macOS JavaScript for Automation, in an osascript child of mailboxd.
const letterboxd = /^[^\s<>@]+@letterboxd\.com$/i;

function addressOf(sender) {
  const bracketed = /<([^<>]+)>\s*$/.exec(sender);
  return (bracketed ? bracketed[1] : sender).trim();
}

function classify(subject) {
  if (/^new comment on letterboxd\b/i.test(subject)) return "Comment";
  if (/\b(?:started following you|is now following you)\b/i.test(subject)) return "New follower";
  if (/\b(?:liked|likes) your\b/i.test(subject)) return "Like";
  if (/\bmentioned you\b/i.test(subject)) return "Mention";
  if (/\b(?:watchlist|now (?:available|streaming))\b/i.test(subject)) return "Watchlist";
  return "Letterboxd email";
}

function commentExcerpt(body) {
  const lines = body.replace(/[\u00a0\u2028\u2029]/g, " ").replace(/\r\n?/g, "\n").split("\n")
    .map(line => line.trim());
  const lead = lines.findIndex(line => /\bcommented on\b.*:\s*$/.test(line));
  if (lead < 0) return "";
  const remainder = lines.slice(lead + 1);
  const start = remainder.findIndex(Boolean);
  if (start < 0) return "";
  const excerpt = [];
  for (const line of remainder.slice(start)) {
    if (!line || /^(?:View and Reply|Unsubscribe\b|Manage Notifications)/i.test(line)) break;
    excerpt.push(line);
  }
  return excerpt.join("\n").slice(0, 500);
}

function run() {
  const mail = Application("com.apple.mail");
  const items = new Map();
  let skipped = false;
  let scanned = 0;

  function inspectMailbox(mailbox, includeChildren) {
    try {
      const messages = mailbox.messages.whose({ sender: { _contains: "@letterboxd.com" } })();
      for (const message of messages) {
        try {
          if (!letterboxd.test(addressOf(message.sender())) || message.deletedStatus() || message.junkMailStatus()) continue;
          const messageID = (message.messageId() || "").replace(/^<|>$/g, "");
          const key = messageID || `mail:${message.id()}`;
          if (items.has(key)) continue;
          const subject = (message.subject() || "(No subject)").slice(0, 1000);
          const received = message.dateReceived() || message.dateSent();
          if (!received || !Number.isFinite(received.getTime())) continue;
          const kind = classify(subject);
          let detail = "";
          if (kind === "Comment") {
            try {
              detail = commentExcerpt(String(message.content() || ""));
            } catch {
              // Keep the entry when the body has not been downloaded.
            }
          }
          items.set(key, { messageID, subject, receivedAt: received.toISOString(), kind, detail });
        } catch (error) {
          if (error.errorNumber === -1743) throw error;
          skipped = true;
        }
      }
      scanned += 1;
    } catch (error) {
      if (error.errorNumber === -1743) throw error;
      skipped = true;
    }

    if (!includeChildren) return;
    try {
      for (const child of mailbox.mailboxes()) inspectMailbox(child, true);
    } catch (error) {
      if (error.errorNumber === -1743) throw error;
      skipped = true;
    }
  }

  try {
    const accounts = mail.accounts();
    inspectMailbox(mail.inbox, false);
    for (const account of accounts) {
      if (!account.enabled()) continue;
      for (const mailbox of account.mailboxes()) inspectMailbox(mailbox, true);
    }
    for (const mailbox of mail.mailboxes()) inspectMailbox(mailbox, true);
    if (scanned === 0) return JSON.stringify({ error: "Apple Mail did not return an accessible mailbox." });
    return JSON.stringify({
      items: [...items.values()].sort((left, right) => right.receivedAt.localeCompare(left.receivedAt)),
      warning: skipped ? "Some Apple Mail messages or folders could not be read." : ""
    });
  } catch (error) {
    return JSON.stringify({
      error: error.errorNumber === -1743
        ? "Allow mailboxd to control Mail in System Settings → Privacy & Security → Automation, then sync again."
        : "Could not read Apple Mail. Open Mail and check that your account is available, then sync again."
    });
  }
}
