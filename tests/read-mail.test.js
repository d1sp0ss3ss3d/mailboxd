"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const script = fs.readFileSync(path.join(__dirname, "../native/read-mail.js"), "utf8");

function message({ id, subject, body = "", sender = "Letterboxd <robot@letterboxd.com>", day = 1, junk = false }) {
  return {
    id: () => id,
    sender: () => sender,
    deletedStatus: () => false,
    junkMailStatus: () => junk,
    messageId: () => `<${id}@example.test>`,
    subject: () => subject,
    dateReceived: () => new Date(Date.UTC(2026, 0, day)),
    content: () => body
  };
}

function mailbox(messages, children = []) {
  return {
    messages: {
      whose(query) {
        assert.equal(query.sender._contains, "@letterboxd.com");
        return () => messages.filter(item => item.sender().toLowerCase().includes("@letterboxd.com"));
      }
    },
    mailboxes: () => children
  };
}

function scan(mail) {
  const sandbox = { Application: name => {
    assert.equal(name, "com.apple.mail");
    return mail;
  } };
  return JSON.parse(vm.runInNewContext(script + "\nrun()", sandbox));
}

test("reads inbox and nested folders, recognizes both formats, and keeps other Letterboxd subjects", () => {
  const comment = message({
    id: 1,
    subject: "New comment on Letterboxd regarding ‘A Sample Film’",
    body: "Hi, there’s a new comment…\n\nExampleUser commented on her A Sample Film review:\n\nI liked the ending!\n\nView and Reply"
  });
  const follow = message({ id: 2, subject: "ExampleUser started following you on Letterboxd", day: 3 });
  const generic = message({ id: 3, subject: "A Letterboxd update", day: 2 });
  const lookalike = message({ id: 4, subject: "Lookalike", sender: "Fake <robot@letterboxd.com.example.test>" });
  const junk = message({ id: 5, subject: "Filtered junk", junk: true });
  const inbox = mailbox([comment, lookalike, junk]);
  const result = scan({
    inbox,
    accounts: () => [{ enabled: () => true, mailboxes: () => [inbox, mailbox([], [mailbox([follow])])] }],
    mailboxes: () => [mailbox([generic, comment])]
  });
  assert.deepEqual(result.items.map(item => item.kind), ["New follower", "Letterboxd email", "Comment"]);
  assert.equal(result.items[2].detail, "I liked the ending!");
  assert.equal(result.items[2].messageID, "1@example.test");
  assert.equal(result.warning, "");
});

test("preserves results when a folder is unreadable", () => {
  const result = scan({
    inbox: mailbox([]),
    accounts: () => [],
    mailboxes: () => [{ messages: { whose() { throw Error("unreadable"); } }, mailboxes: () => [] }]
  });
  assert.deepEqual(result.items, []);
  assert.match(result.warning, /could not be read/);
});

test("surfaces missing Automation permission", () => {
  const result = scan({ accounts() { throw Object.assign(Error("denied"), { errorNumber: -1743 }); } });
  assert.match(result.error, /Privacy & Security → Automation/);
});
