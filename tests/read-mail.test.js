"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const script = fs.readFileSync(path.join(__dirname, "../native/read-mail.js"), "utf8");

function message({ id, subject, body = "", source = "", sender = "Letterboxd <robot@letterboxd.com>", day = 1, junk = false, deleted = false }) {
  return {
    id: () => id,
    sender: () => sender,
    deletedStatus: () => deleted,
    junkMailStatus: () => junk,
    messageId: () => `<${id}@example.test>`,
    subject: () => subject,
    dateReceived: () => new Date(Date.UTC(2026, 0, day)),
    content: () => body,
    source: () => source
  };
}

function mailbox(messages, children = [], name = "Folder") {
  return {
    name: () => name,
    messages: {
      whose(query) {
        assert.equal(query.sender._contains, "@letterboxd.com");
        return () => messages.filter(item => item.sender().toLowerCase().includes("@letterboxd.com"));
      }
    },
    mailboxes: () => children
  };
}

function scan(mail, { fetch = false, previous = [], wait = () => {} } = {}) {
  const sandbox = { mail, fetch, previous, delay: wait };
  return JSON.parse(vm.runInNewContext(script + "\nJSON.stringify(scanMail(mail, previous, fetch))", sandbox));
}

test("reads inbox and nested folders, recognizes both formats, and keeps other Letterboxd subjects", () => {
  const comment = message({
    id: 1,
    subject: "New comment on Letterboxd regarding ‘A Sample Film’",
    body: "Hi, there’s a new comment…\n\nExampleUser commented on her A Sample Film review:\n\nI liked the ending!\n\nView and Reply",
    source: [
      "Content-Type: multipart/alternative;",
      ' boundary="sample.boundary"',
      "",
      "--sample.boundary",
      "Content-Type: text/plain",
      "",
      "View and Reply",
      "--sample.boundary",
      "Content-Type: text/html; charset=utf-8",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      '<a href=3D"https://letterboxd.com/example/film/a-sample-film/2/">Film</a>',
      '<a href=3D"https://letterboxd.com/example/film/a-sample-film/2/#comm=',
      'ent-42"><span>View</span>&nbsp;and Reply</a>',
      "--sample.boundary--"
    ].join("\r\n")
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
  assert.equal(result.items[2].commentURL, "https://letterboxd.com/example/film/a-sample-film/2/#comment-42");
  assert.equal(result.items[0].commentURL, null);
  assert.equal(result.warning, "");
});

test("prefers the reply button over a comment link in the message body", () => {
  const target = "https://letterboxd.com/example/list/sample/?from=email&ref=comment#comment-52";
  const html = [
    '<a href="https://letterboxd.com/example/list/sample/#comment-51">Another comment</a>',
    `<a href='${target.replace("&", "&amp;")}'>View and Reply</a>`,
    '<a href="https://letterboxd.com/email/unsubscribe/example/">Unsubscribe</a>'
  ].join("\n");
  const source = "Content-Type: text/html\nContent-Transfer-Encoding: base64\n\n" +
    Buffer.from(html).toString("base64").match(/.{1,76}/g).join("\n");
  const inbox = mailbox([message({ id: 1, subject: "New comment on Letterboxd", source })]);
  const result = scan({ inbox, accounts: () => [], mailboxes: () => [] });
  assert.equal(result.items[0].commentURL, target);
});

test("uses the plain-text reply link and rejects off-site or unsubscribe links", () => {
  const target = "https://letterboxd.com/example/film/sample/#comment-77";
  const unsafe = [
    "https://letterboxd.com.example.test/example/film/sample/#comment-77",
    "https://letterboxd.com/email/unsubscribe/example/#comment-77"
  ];
  const inbox = mailbox([target, ...unsafe].map((url, index) =>
    message({
      id: index + 1,
      subject: "New comment on Letterboxd",
      source: `Content-Type: text/plain\n\nView and Reply:\n<${url}>`
    })
  ));
  const result = scan({ inbox, accounts: () => [], mailboxes: () => [] });
  assert.deepEqual(result.items.map(item => item.commentURL), [target, null, null]);
});

test("preserves results when a folder is unreadable", () => {
  const result = scan({
    inbox: mailbox([]),
    accounts: () => [],
    mailboxes: () => [{
      name: () => "Unavailable",
      messages: { whose() { throw Error("unreadable"); } },
      mailboxes: () => []
    }]
  });
  assert.deepEqual(result.items, []);
  assert.match(result.warning, /could not be read/);
});

test("reconciles additions and deletions while retaining archived notifications", () => {
  const removed = message({ id: 1, subject: "Moved to Trash" });
  const incoming = message({ id: 2, subject: "New from Letterboxd", day: 2 });
  const archived = message({ id: 3, subject: "Archived Letterboxd notification" });
  const remoteTrash = message({ id: 4, subject: "In provider Trash" });
  const flaggedDeleted = message({ id: 5, subject: "Marked deleted", deleted: true });
  const inbox = [removed, flaggedDeleted];
  const trash = [];
  const mail = {
    inbox: mailbox(inbox),
    trashMailbox: mailbox(trash),
    accounts: () => [{
      enabled: () => true,
      mailboxes: () => [
        mailbox([archived, ...trash]),
        mailbox([remoteTrash], [], "[Gmail]/Trash")
      ]
    }],
    mailboxes: () => []
  };
  const first = scan(mail);
  assert.deepEqual(first.items.map(item => item.messageID), ["1@example.test", "3@example.test"]);
  inbox.splice(0, 1, incoming);
  trash.push(removed);
  const second = scan(mail, { previous: first.items });
  assert.deepEqual(second.items.map(item => item.messageID), ["2@example.test", "3@example.test"]);
});

test("manual refresh asks Mail to check the server and reads arrivals after the check", () => {
  const inbox = [];
  let fetches = 0;
  const mail = {
    inbox: mailbox(inbox),
    accounts: () => [],
    mailboxes: () => [],
    checkForNewMail() { fetches += 1; }
  };
  assert.deepEqual(scan(mail).items, []);
  assert.equal(fetches, 0);
  const refreshed = scan(mail, {
    fetch: true,
    wait(seconds) {
      assert.equal(fetches, 1);
      assert.ok(seconds > 0);
      inbox.push(message({ id: 1, subject: "Fetched notification" }));
    }
  });
  assert.equal(refreshed.items[0].subject, "Fetched notification");
});

test("uses already parsed comment content only for messages still present", () => {
  const comment = message({ id: 1, subject: "New comment on Letterboxd" });
  let bodyReads = 0;
  comment.content = comment.source = () => { bodyReads += 1; };
  const previous = [{
    messageID: "1@example.test",
    kind: "Comment",
    detail: "Sample comment",
    commentURL: "https://letterboxd.com/example/film/sample/#comment-92"
  }];
  const result = scan({ inbox: mailbox([comment]), accounts: () => [], mailboxes: () => [] }, { previous });
  assert.equal(result.items[0].detail, previous[0].detail);
  assert.equal(result.items[0].commentURL, previous[0].commentURL);
  assert.equal(bodyReads, 0);
});

test("surfaces missing Automation permission", () => {
  const result = scan({ accounts() { throw Object.assign(Error("denied"), { errorNumber: -1743 }); } });
  assert.match(result.error, /Privacy & Security → Automation/);
});
