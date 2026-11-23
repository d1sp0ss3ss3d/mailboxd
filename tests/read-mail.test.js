"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const script = fs.readFileSync(path.join(__dirname, "../native/read-mail.js"), "utf8");

function message({ id, subject, body = "", source = "", sender = "Letterboxd <robot@letterboxd.com>", day = 1, junk = false }) {
  return {
    id: () => id,
    sender: () => sender,
    deletedStatus: () => false,
    junkMailStatus: () => junk,
    messageId: () => `<${id}@example.test>`,
    subject: () => subject,
    dateReceived: () => new Date(Date.UTC(2026, 0, day)),
    content: () => body,
    source: () => source
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
    mailboxes: () => [{ messages: { whose() { throw Error("unreadable"); } }, mailboxes: () => [] }]
  });
  assert.deepEqual(result.items, []);
  assert.match(result.warning, /could not be read/);
});

test("surfaces missing Automation permission", () => {
  const result = scan({ accounts() { throw Object.assign(Error("denied"), { errorNumber: -1743 }); } });
  assert.match(result.error, /Privacy & Security → Automation/);
});
