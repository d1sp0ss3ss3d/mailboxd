"use strict";

browser.runtime.onMessage.addListener((message, sender, reply) => {
  const type = message?.type === "mailboxd:refresh" ? "refresh" : "list";
  if (message?.type !== `mailboxd:${type}` || sender.frameId !== 0 ||
      !/^https:\/\/letterboxd\.com\/activity(?:[/?#]|$)/.test(sender.url)) {
    return false;
  }

  browser.runtime.sendNativeMessage("com.mailboxd.local", {
    type,
    offset: message.offset,
    revision: message.revision
  })
    .then(reply, () => reply({ error: "Safari could not reach the mailboxd extension. Check Safari’s Extensions settings." }));
  return true;
});
