"use strict";

(() => {
  const paths = new Map([
    ["/activity", "friends"],
    ["/activity/you", "you"],
    ["/activity/incoming", "incoming"]
  ]);
  const tabNames = new Set(paths.values());
  const hash = "#mailboxd";

  function pathOf(link) {
    const url = new URL(link.href);
    return url.origin === location.origin ? url.pathname.replace(/\/$/, "") : "";
  }

  function findNavigation() {
    const friends = [...document.links].find(link =>
      link.textContent.trim().toLowerCase() === "friends" && pathOf(link) === "/activity"
    );
    for (let row = friends?.parentElement; row && row !== document.body; row = row.parentElement) {
      const links = [...row.querySelectorAll("a[href]")];
      const nativeTabs = links.filter(link => {
        const name = link.textContent.trim().toLowerCase();
        return tabNames.has(name) && paths.get(pathOf(link)) === name;
      });
      if (nativeTabs.length === 3 && links.length === 3) return { row, nativeTabs };
      if (links.length > 5) break;
    }
    return null;
  }

  function node(tag, className, value) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (value) element.textContent = value;
    return element;
  }

  function createPanel() {
    const host = node("section");
    host.id = "mailboxd-panel";
    host.setAttribute("aria-labelledby", "mailboxd-tab");
    host.hidden = true;
    const root = host.attachShadow({ mode: "closed" });
    const stylesheet = new CSSStyleSheet();
    stylesheet.replaceSync(`
      :host { display: block; }
      .subheader, ul, footer {
        color: #abc;
        font-family: var(--font-stack-graphik, inherit);
        font-size: 12px;
        font-weight: 400;
        line-height: 1.38462;
      }
      * { box-sizing: border-box; }
      [hidden] { display: none !important; }
      p { margin: 0; overflow-wrap: anywhere; }
      .subheader, .summary {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        justify-content: space-between;
        column-gap: 10px;
      }
      .subheader { padding: 7px 10px; color: #9ab; }
      ul { padding: 0; margin: 0 0 var(--spacing-dense-medium, .375rem); list-style: none; }
      li { padding: 7px 10px; background: #1c232a; border-top: 1px solid #111; }
      li:last-child { border-bottom: 1px solid #2c3440; }
      .brief { flex: 1 1 auto; min-width: 0; color: #789; }
      .type { color: #89a; font-weight: 700; }
      .subject { color: #fff; }
      time { margin-inline-start: auto; color: #567; font-size: 11px; line-height: 1.63636; white-space: nowrap; }
      blockquote { margin: 8px 0 4px; border-inline-start: 1px solid #456; padding-inline-start: 15px; }
      blockquote p { line-height: 1.5; white-space: pre-line; }
      .secondary { color: #bcd; text-decoration: none; }
      .secondary:is(:hover, :active, :focus-visible) { color: #fff; }
      button { padding: 0; border: 0; background: none; font: inherit; cursor: pointer; }
      button:disabled { opacity: .5; cursor: default; }
      footer { text-align: center; }
      .more { padding: 9px 15px; border-radius: 3px; background: #283038; color: #9ab; line-height: 1; }
      .more:is(:hover, :focus-visible) { background: #303840; color: #def; }
    `);
    root.adoptedStyleSheets = [stylesheet];
    const subheader = node("div", "subheader");
    const refresh = node("button", "secondary", "Refresh");
    refresh.type = "button";
    const status = node("p");
    status.setAttribute("role", "status");
    subheader.append(status, refresh);
    const list = node("ul");
    const footer = node("footer");
    const more = node("button", "more", "Show more");
    more.type = "button";
    footer.hidden = true;
    footer.append(more);
    root.append(subheader, list, footer);

    const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
    const syncDateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" });
    let visible = 0;
    let revision = "";
    let pending = false;

    function appendPage(items) {
      const rows = document.createDocumentFragment();
      for (const item of items) {
        const row = node("li");
        const received = new Date(item.receivedAt);
        const time = node("time", "", dateFormat.format(received));
        time.dateTime = received.toISOString();
        const brief = node("p", "brief");
        brief.append(node("strong", "type", item.kind), " · ", node("span", "subject", item.subject));
        const summary = node("div", "summary");
        summary.append(brief, time);
        row.append(summary);
        if (item.detail) {
          const quote = node("blockquote");
          quote.append(node("p", "", item.detail));
          row.append(quote);
        }
        const commentURL = /^https:\/\/(?:www\.)?letterboxd\.com\/[^\s\\]+#comment-\d+$/i.test(item.commentURL)
          ? item.commentURL : "";
        if (commentURL || item.messageID) {
          const open = node("a", "secondary", commentURL ? "View and Reply" : "Open in Mail");
          open.href = commentURL || "message://%3C" + encodeURIComponent(item.messageID) + "%3E";
          open.rel = "noreferrer";
          open.addEventListener("click", event => {
            if (!event.isTrusted) event.preventDefault();
          });
          row.append(open);
        }
        rows.append(row);
      }
      list.append(rows);
      visible += items.length;
    }

    async function request(type, offset = 0) {
      const result = await browser.runtime.sendMessage({ type: `mailboxd:${type}`, offset, revision });
      if (!result || result.error) throw new Error(result?.error || "Safari could not reach mailboxd.");
      return result;
    }

    async function waitForRefresh() {
      const { refreshID } = await request("refresh");
      const deadline = Date.now() + 40_000;
      while (Date.now() < deadline) {
        const result = await request("list");
        if (result.refreshID !== refreshID) return result;
        if (result.running === false) throw new Error(result.syncError);
        await new Promise(resolve => setTimeout(resolve, 800));
      }
      throw new Error("Apple Mail is still checking for messages. This tab will update when the check finishes.");
    }

    async function load(mode = "list") {
      if (pending) return;
      pending = true;
      refresh.disabled = more.disabled = true;
      if (mode === "refresh") status.textContent = "Checking Apple Mail…";
      else if (!revision) status.textContent = "Reading the local mailboxd feed…";
      try {
        const result = mode === "refresh" ? await waitForRefresh() : await request("list", mode === "more" ? visible : 0);
        const problem = (mode === "refresh" && result.refreshError) || result.syncError;
        if (!result.revision) throw new Error(problem || "Open the mailboxd app and click Start Syncing.");
        if (revision !== result.revision) {
          revision = result.revision;
          visible = 0;
          list.replaceChildren();
          appendPage(result.items);
        } else if (mode === "more") {
          appendPage(result.items);
        }
        footer.hidden = visible >= result.total;
        const summary = result.total === 0 ? "No Letterboxd emails found." :
          `${result.total.toLocaleString()} ${result.total === 1 ? "email" : "emails"}`;
        status.textContent = [
          summary, `Last synced ${syncDateFormat.format(new Date(result.syncedAt))}`, problem || result.warning
        ].filter(Boolean).join(" · ");
      } catch (error) {
        status.textContent = error.message;
      } finally {
        pending = false;
        refresh.disabled = more.disabled = false;
      }
    }

    refresh.addEventListener("click", () => load("refresh"));
    more.addEventListener("click", () => load("more"));
    return { host, load };
  }

  let mounted;

  function hiddenSiblings(heading) {
    const main = heading.closest(".col-main") || heading.closest("main, #content, [role=main]");
    const siblings = [];
    for (let part = heading; part && part !== main; part = main ? part.parentElement : null) {
      for (let other = part.nextElementSibling; other; other = other.nextElementSibling) {
        if (!["SCRIPT", "STYLE", "FOOTER", "LINK"].includes(other.tagName)) siblings.push(other);
      }
    }
    return siblings;
  }

  function update() {
    if (!mounted) return;
    const { heading, panel, tab, nativeTabs } = mounted;
    const show = location.hash === hash;
    for (const link of nativeTabs) {
      link.toggleAttribute("data-mailboxd-inactive", show && (
        link.classList.contains("selected") || link.classList.contains("active") ||
        link.parentElement.classList.contains("selected") || link.getAttribute("aria-current") === "page"
      ));
    }
    for (const sibling of hiddenSiblings(heading)) {
      if (sibling !== panel.host) sibling.toggleAttribute("data-mailboxd-hidden", show);
    }
    if (show) tab.setAttribute("aria-current", "page");
    else tab.removeAttribute("aria-current");
    if (panel.host.hidden === show) {
      panel.host.hidden = !show;
      if (show) panel.load();
    }
  }

  function mount() {
    if (mounted?.tab.isConnected && mounted.panel.host.isConnected) {
      if (location.hash === hash) update();
      return;
    }
    mounted?.panel.host.remove();
    mounted?.tab.remove();
    mounted = null;
    const navigation = findNavigation();
    if (!navigation) return;
    const { row, nativeTabs } = navigation;
    const last = nativeTabs.at(-1);
    const tab = node("a", last.className, "Email");
    tab.id = "mailboxd-tab";
    tab.href = hash;
    tab.classList.remove("selected", "active", "current");
    tab.setAttribute("aria-controls", "mailboxd-panel");
    const wrapped = last.parentElement.tagName === "LI";
    if (wrapped) {
      const item = node("li", last.parentElement.className);
      item.classList.remove("selected", "active", "current");
      item.append(tab);
      last.parentElement.after(item);
    } else {
      last.after(tab);
    }
    const heading = row.closest("#content-nav, .section-heading, nav") || row;
    const panel = createPanel();
    heading.after(panel.host);
    mounted = { heading, panel, tab, nativeTabs };
    update();
  }

  mount();
  new MutationObserver(mount).observe(document.body, { childList: true, subtree: true });
  window.addEventListener("hashchange", update);
  function updateVisibleFeed() {
    if (mounted && !mounted.panel.host.hidden && !document.hidden) mounted.panel.load();
  }
  window.setInterval(updateVisibleFeed, 5_000);
  document.addEventListener("visibilitychange", updateVisibleFeed);
})();
