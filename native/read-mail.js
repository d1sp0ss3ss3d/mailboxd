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

function decodeBody(body, encoding) {
  if (encoding === "quoted-printable") {
    return body.replace(/=\n/g, "").replace(/=([0-9a-f]{2})/gi, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    );
  }
  if (encoding !== "base64") return body;

  // The matcher only needs the ASCII bytes for HTML markup and permalinks.
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const data = body.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data)) return "";
  let text = "";
  let buffer = 0;
  let bits = 0;
  for (const char of data.replace(/=+$/, "")) {
    buffer = (buffer << 6) | alphabet.indexOf(char);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      text += String.fromCharCode((buffer >>> bits) & 255);
    }
  }
  return text;
}

function* textParts(source, depth = 0) {
  const divider = source.indexOf("\n\n");
  if (divider < 0 || depth >= 12) return;
  const headers = source.slice(0, divider).replace(/\n[ \t]+/g, " ");
  const body = source.slice(divider + 2);
  if (/^Content-Disposition:[ \t]*attachment\b/im.test(headers)) return;
  const contentType = /^Content-Type:[ \t]*(.*)$/im.exec(headers)?.[1] || "text/plain";
  const type = contentType.split(";", 1)[0].trim().toLowerCase();
  if (type.startsWith("multipart/")) {
    const boundary = /;\s*boundary\s*=\s*(?:"([^"]+)"|([^\s;]+))/i.exec(contentType);
    if (!boundary) return;
    const delimiter = (boundary[1] || boundary[2]).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const lines = [...body.matchAll(new RegExp("^--" + delimiter + "(--)?[ \t]*$", "gm"))];
    for (let index = 0; index + 1 < lines.length && !lines[index][1]; index += 1) {
      const start = lines[index].index + lines[index][0].length + 1;
      yield* textParts(body.slice(start, lines[index + 1].index), depth + 1);
    }
  } else if (type === "text/html" || type === "text/plain") {
    const encoding = /^Content-Transfer-Encoding:[ \t]*(\S+)/im.exec(headers)?.[1].toLowerCase();
    yield { type, text: decodeBody(body, encoding) };
  }
}

function decodeEntities(text) {
  return text.replace(/&(#\d+|#x[0-9a-f]+|amp|nbsp);/gi, (entity, name) => {
    if (name.toLowerCase() === "amp") return "&";
    if (name.toLowerCase() === "nbsp") return " ";
    const code = /^#x/i.test(name) ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  });
}

function findCommentURL(source) {
  const permalink = /^https:\/\/(?:www\.)?letterboxd\.com\/(?:[\w-]+\/(?:film|list|story)\/|journal\/)[\w%-]+(?:\/\d+)?\/?(?:\?[^\s<>"'\\#]*)?#comment-\d+$/i;
  const candidates = new Set();
  let htmlAction;
  let plainAction;
  for (const { type, text } of textParts(source.replace(/\r\n?/g, "\n"))) {
    if (type === "text/html") {
      const anchors = /<a\s+([^>]+)>([\s\S]*?)<\/a\s*>/gi;
      for (const [, attributes, label] of text.matchAll(anchors)) {
        const href = /(?:^|\s)href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>]+))/i.exec(attributes);
        if (!href) continue;
        const url = decodeEntities(href[1] ?? href[2] ?? href[3]).trim();
        if (!permalink.test(url)) continue;
        if (/^View\s+and\s+Reply$/i.test(decodeEntities(label.replace(/<[^>]*>/g, "")).trim())) {
          htmlAction = url;
        }
        candidates.add(url);
      }
    } else {
      const action = /^\s*View and Reply[ \t]*:?[ \t]*(?:\n[ \t]*)?<?(https:\/\/[^\s<>]+)/im.exec(text)?.[1];
      if (action && permalink.test(action)) plainAction = action;
      for (const [url] of text.matchAll(/https:\/\/[^\s<>"']+?#comment-\d+\b/gi)) {
        if (permalink.test(url)) candidates.add(url);
      }
    }
  }
  return htmlAction || plainAction || (candidates.size === 1 ? candidates.values().next().value : null);
}

function cachedItems(path) {
  if (!path) return [];
  try {
    ObjC.import("Foundation");
    const text = $.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, null);
    const items = JSON.parse(ObjC.unwrap(text)).items;
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function scanMail(mail, previous, fetch) {
  const items = new Map();
  const cachedComments = new Map(previous.filter(item => item.kind === "Comment" && item.messageID)
    .map(item => [item.messageID, item]));
  const excludedIDs = new Set();
  let skipped = false;
  let scanned = 0;

  function matchingMessages(mailbox) {
    return mailbox.messages.whose({ sender: { _contains: "@letterboxd.com" } })();
  }

  function excludeMailbox(mailbox) {
    try {
      for (const message of matchingMessages(mailbox)) excludedIDs.add(message.id());
    } catch (error) {
      if (error.errorNumber === -1743) throw error;
      // An account may not have a configured special mailbox.
    }
  }

  function inspectMailbox(mailbox, includeChildren) {
    try {
      if (includeChildren) {
        // Provider-named folders may be exposed separately from Mail's unified Trash and Junk.
        const name = mailbox.name().split("/").pop().trim();
        if (/^(trash|bin|deleted messages|deleted items|deleted mail|junk|junk e-mail|spam)$/i.test(name)) return;
      }
      const messages = matchingMessages(mailbox);
      for (const message of messages) {
        try {
          if (!letterboxd.test(addressOf(message.sender())) || excludedIDs.has(message.id()) ||
              message.deletedStatus() || message.junkMailStatus()) continue;
          const messageID = (message.messageId() || "").replace(/^<|>$/g, "");
          const key = messageID || `mail:${message.id()}`;
          if (items.has(key)) continue;
          const subject = (message.subject() || "(No subject)").slice(0, 1000);
          const received = message.dateReceived() || message.dateSent();
          if (!received || !Number.isFinite(received.getTime())) continue;
          const kind = classify(subject);
          let detail = "";
          let commentURL = null;
          if (kind === "Comment") {
            const cached = cachedComments.get(messageID);
            detail = cached?.detail || "";
            commentURL = cached?.commentURL || null;
            try {
              if (!detail) detail = commentExcerpt(String(message.content() || ""));
            } catch {
              // Keep the entry when the body has not been downloaded.
            }
            try {
              if (!commentURL) commentURL = findCommentURL(String(message.source() || ""));
            } catch {
              // A message can be listed before Mail has its full source.
            }
          }
          items.set(key, { messageID, subject, receivedAt: received.toISOString(), kind, detail, commentURL });
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
    if (fetch) {
      mail.checkForNewMail();
      // Mail starts fetching asynchronously. Later scans pick up slower deliveries.
      delay(2);
    }
    const accounts = mail.accounts();
    excludeMailbox(mail.trashMailbox);
    excludeMailbox(mail.junkMailbox);
    inspectMailbox(mail.inbox, false);
    for (const account of accounts) {
      if (!account.enabled()) continue;
      for (const mailbox of account.mailboxes()) inspectMailbox(mailbox, true);
    }
    for (const mailbox of mail.mailboxes()) inspectMailbox(mailbox, true);
    if (scanned === 0) return { error: "Apple Mail did not return an accessible mailbox." };
    return {
      items: [...items.values()].sort((left, right) => right.receivedAt.localeCompare(left.receivedAt)),
      warning: skipped ? "Some Apple Mail messages or folders could not be read." : ""
    };
  } catch (error) {
    return {
      error: error.errorNumber === -1743
        ? "Allow mailboxd to control Mail in System Settings → Privacy & Security → Automation, then sync again."
        : "Could not read Apple Mail. Open Mail and check that your account is available, then sync again."
    };
  }
}

function run(argv = []) {
  return JSON.stringify(scanMail(Application("com.apple.mail"), cachedItems(argv[0]), argv[1] === "refresh"));
}
