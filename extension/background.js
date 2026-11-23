"use strict";

browser.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type !== "mailboxd:list" || sender.frameId !== 0 ||
      !/^https:\/\/letterboxd\.com\/activity(?:[/?#]|$)/.test(sender.url)) {
    return false;
  }

  browser.runtime.sendNativeMessage("com.mailboxd.local", {
    type: "list",
    offset: message.offset,
    revision: message.revision
  })
    .then(reply, () => reply({ error: "Safari could not reach the mailboxd extension. Check Safari’s Extensions settings." }));
  return true;
});
