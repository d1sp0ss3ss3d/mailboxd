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
      :host { display: block; color: #dce4eb; font: 15px/1.5 system-ui, sans-serif; }
      * { box-sizing: border-box; }
      [hidden] { display: none !important; }
      .panel { margin: 18px 0 42px; border: 1px solid #38424e; border-radius: 12px; background: #161d24; overflow: hidden; }
      header { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 14px 18px; background: #202933; }
      h2 { margin: 0; font-size: 17px; color: #f4f6f8; }
      button, a { color: #ffd088; font: inherit; }
      button { background: #26313d; border: 1px solid #465463; border-radius: 6px; padding: 5px 12px; cursor: pointer; }
      button:hover { background: #344354; }
      a:hover { color: #ffe6be; }
      p { margin: 0; overflow-wrap: anywhere; }
      .status { padding: 12px 18px; color: #aab9c8; }
      ul { padding: 0; margin: 0; list-style: none; }
      li { padding: 13px 18px; border-top: 1px solid #313b47; }
      .meta { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: baseline; color: #aab9c8; font-size: 13px; }
      .type { color: #ffd088; font-weight: 600; }
      .subject { color: #f4f6f8; font-weight: 600; margin: 3px 0; }
      .detail { white-space: pre-line; margin: 4px 0 7px; }
      a { font-size: 13px; }
      footer { padding: 12px 18px; border-top: 1px solid #313b47; }
    `);
    root.adoptedStyleSheets = [stylesheet];
    const panel = node("div", "panel");
    const header = node("header");
    const refresh = node("button", "", "Refresh");
    refresh.type = "button";
    header.append(node("h2", "", "Email notifications"), refresh);
    const status = node("p", "status");
    status.setAttribute("role", "status");
    const list = node("ul");
    const footer = node("footer");
    const more = node("button", "", "Show more");
    more.type = "button";
    footer.hidden = true;
    footer.append(more);
    panel.append(header, status, list, footer);
    root.append(panel);

    const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
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
        const meta = node("div", "meta");
        meta.append(node("span", "type", item.kind), time);
        row.append(meta, node("p", "subject", item.subject));
        if (item.detail) row.append(node("p", "detail", item.detail));
        if (item.messageID) {
          const open = node("a", "", "Open in Mail");
          open.href = "message://%3C" + encodeURIComponent(item.messageID) + "%3E";
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

    async function load(nextPage = false) {
      if (pending) return;
      pending = true;
      refresh.disabled = more.disabled = true;
      if (!revision) status.textContent = "Reading the local mailboxd feed…";
      try {
        const result = await browser.runtime.sendMessage({
          type: "mailboxd:list", offset: nextPage ? visible : 0, revision
        });
        if (!result || result.error) throw new Error(result?.error || "Open the mailboxd app and start syncing with Apple Mail.");
        if (revision !== result.revision) {
          revision = result.revision;
          visible = 0;
          list.replaceChildren();
          appendPage(result.items);
        } else if (nextPage) {
          appendPage(result.items);
        }
        footer.hidden = visible >= result.total;
        const summary = result.total === 0 ? "No Letterboxd emails found." :
          `${result.total.toLocaleString()} ${result.total === 1 ? "email" : "emails"}`;
        status.textContent = result.warning ? `${summary} · ${result.warning}` :
          `${summary} · Last synced ${dateFormat.format(new Date(result.syncedAt))}`;
      } catch (error) {
        status.textContent = error.message;
      } finally {
        pending = false;
        refresh.disabled = more.disabled = false;
      }
    }

    refresh.addEventListener("click", () => load());
    more.addEventListener("click", () => load(true));
    return { host, load };
  }

  let mounted;

  function hiddenSiblings(heading) {
    const main = heading.closest("main, #content, [role=main]");
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
    const heading = row.closest(".section-heading, nav") || row;
    const panel = createPanel();
    heading.after(panel.host);
    mounted = { heading, panel, tab, nativeTabs };
    update();
  }

  mount();
  new MutationObserver(mount).observe(document.body, { childList: true, subtree: true });
  window.addEventListener("hashchange", update);
  window.setInterval(() => {
    if (mounted && !mounted.panel.host.hidden && !document.hidden) mounted.panel.load();
  }, 60_000);
})();
