/*
 * MJ Veija Turf Passionate Selection
 *
 * Readers: the page renders data/meetings.json, which GitHub Pages serves next to this file.
 * Editors: sign in with a fine-grained GitHub token that can read and write this repository's
 * contents. Each publish commits data/meetings.json through the GitHub contents API, and
 * GitHub Pages then republishes the site.
 */
(() => {
  "use strict";

  const CFG = Object.assign(
    { siteName: "MJ Veija Turf Passionate Selection", owner: "", repo: "", branch: "main", dataPath: "data/meetings.json" },
    window.SITE_CONFIG || {}
  );
  const SITE = CFG.siteName;
  const REPO = detectRepo(CFG);
  const API = "https://api.github.com";
  const DRAFT_KEY = "mjvtp-selection-draft-v1";
  const TOKEN_KEY = "mjvtp-selection-github-token";
  const GOINGS = ["Firm", "Good to firm", "Good", "Good to soft", "Soft", "Heavy"];
  const ORD = ["1st", "2nd", "3rd"];
  // Dates are spelled out here rather than with toLocaleDateString, whose punctuation differs between browsers.
  const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  // Actions only a signed-in editor may use, and the ones that need an open draft.
  const EDITOR_ACTIONS = new Set(["new", "edit", "resume", "discard", "close", "add-race", "remove-race",
    "publish", "del-ask", "del-no", "del-yes", "settings", "settings-close", "settings-save", "signout"]);
  const DRAFT_ACTIONS = new Set(["close", "add-race", "remove-race", "publish", "del-ask", "del-no", "del-yes"]);

  const app = document.getElementById("app");
  const ui = {
    view: "loading", id: null, edit: null, settingsDraft: null, status: "", statusErr: false,
    busy: false, confirmDel: null, copied: "", copyFallback: null, signedIn: false, loadErr: ""
  };
  let state = emptyState();
  let memDraft = null;
  let draftTimer = null;
  let authToken = getToken();

  /* ---------- configuration and data shape ---------- */

  function detectRepo(cfg) {
    let owner = cfg.owner || "";
    let repo = cfg.repo || "";
    const host = /^([a-z0-9-]+)\.github\.io$/i.exec(location.hostname || "");
    if (host) {
      if (!owner) owner = host[1];
      if (!repo) {
        const first = (location.pathname || "").split("/").filter(Boolean)[0];
        repo = first && !/\.html?$/i.test(first) ? first : host[1] + ".github.io";
      }
    }
    return { owner, repo, branch: cfg.branch || "main", path: cfg.dataPath || "data/meetings.json" };
  }

  function emptyState() {
    return { v: 1, settings: { byline: "", intro: "" }, meetings: [] };
  }

  function normalizeState(raw) {
    const out = emptyState();
    if (!raw || typeof raw !== "object") return out;
    if (raw.settings && typeof raw.settings === "object") {
      out.settings.byline = String(raw.settings.byline || "");
      out.settings.intro = String(raw.settings.intro || "");
    }
    if (Array.isArray(raw.meetings)) {
      out.meetings = raw.meetings.filter(m => m && typeof m.id === "string" && Array.isArray(m.races));
      out.meetings.forEach(m => {
        m.races = m.races.filter(r => r && typeof r === "object");
        m.races.forEach(r => {
          if (!Array.isArray(r.picks)) r.picks = [];
          if (!r.result || typeof r.result !== "object") r.result = { no: "", name: "" };
        });
      });
    }
    return out;
  }

  /* ---------- helpers ---------- */

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function isoDate(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function toDate(iso) { return new Date(iso + "T12:00:00"); }
  function fmtDate(iso) {
    if (!iso) return "Date to be set";
    const d = toDate(iso);
    return isNaN(d) ? String(iso) : WEEKDAYS[d.getDay()] + " " + d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear();
  }
  function fmtShort(iso) {
    if (!iso) return "no date";
    const d = toDate(iso);
    return isNaN(d) ? String(iso) : d.getDate() + " " + MONTHS[d.getMonth()].slice(0, 3) + " " + d.getFullYear();
  }
  function blank(v) { return v === "" || v == null || String(v).trim() === ""; }
  function byDateDesc(a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; }
  function sorted() { return state.meetings.slice().sort(byDateDesc); }
  function findMeeting(id) { return state.meetings.find(m => m.id === id) || null; }
  function currentMeeting() { return (ui.id && findMeeting(ui.id)) || sorted()[0] || null; }
  function hasPick(p) { return !!p && (!blank(p.no) || !blank(p.name)); }
  function sameNo(a, b) { return !blank(a) && !blank(b) && String(a).trim() === String(b).trim(); }
  function horseText(p) { return ((blank(p.no) ? "" : p.no + " ") + (p.name || "")).trim(); }
  function horseLabel(p) { return esc(p.name) || "No. " + esc(p.no); }
  function chip(no) {
    if (blank(no)) return '<span class="cloth c0" aria-hidden="true">–</span>';
    const n = parseInt(no, 10);
    const cls = isNaN(n) || n < 1 ? "c0" : "c" + (((n - 1) % 16) + 1);
    return '<span class="cloth ' + cls + '"><span class="sr">Number </span>' + esc(no) + "</span>";
  }
  function bestOf(m, ref) {
    if (!ref || !m.races[ref.race]) return null;
    const r = m.races[ref.race];
    const p = r.picks && r.picks[ref.pick];
    return hasPick(p) ? { ri: ref.race, r, p } : null;
  }
  function isRef(ref, i, j) { return !!ref && ref.race === i && ref.pick === j; }
  function isWeb() { return /^https?:$/.test(location.protocol || ""); }
  function pageUrl(m) { return location.origin + location.pathname + (m ? "#" + m.id : ""); }
  function userError(msg) { const e = new Error(msg); e.userMsg = msg; return e; }
  function setStatus(msg, isErr) { ui.status = msg || ""; ui.statusErr = !!isErr; }
  function readHash() {
    try { return decodeURIComponent((location.hash || "").slice(1)); } catch (e) { return ""; }
  }
  function setHash(id) {
    try { history.replaceState(null, "", id ? "#" + id : location.pathname + location.search); } catch (e) { /* history unavailable */ }
  }

  /* ---------- token and drafts (kept in this browser only) ---------- */

  function store(kind) {
    try { return kind === "local" ? window.localStorage : window.sessionStorage; } catch (e) { return null; }
  }
  function getToken() {
    for (const kind of ["session", "local"]) {
      const s = store(kind);
      try { const t = s && s.getItem(TOKEN_KEY); if (t) return t; } catch (e) { /* storage blocked */ }
    }
    return "";
  }
  function setToken(token, remember) {
    clearToken();
    const s = store(remember ? "local" : "session");
    try { if (s) s.setItem(TOKEN_KEY, token); } catch (e) { /* storage blocked: the token lasts for this page only */ }
  }
  function clearToken() {
    for (const kind of ["session", "local"]) {
      const s = store(kind);
      try { if (s) s.removeItem(TOKEN_KEY); } catch (e) { /* storage blocked */ }
    }
  }
  function loadDraft() {
    const s = store("local");
    try { const t = s && s.getItem(DRAFT_KEY); if (t) return JSON.parse(t); } catch (e) { /* storage blocked or draft unreadable */ }
    return memDraft ? clone(memDraft) : null;
  }
  function saveDraft() {
    if (!ui.edit) return;
    memDraft = clone(ui.edit);
    const s = store("local");
    try { if (s) s.setItem(DRAFT_KEY, JSON.stringify(ui.edit)); } catch (e) { /* kept in memory only */ }
  }
  function clearDraft() {
    memDraft = null;
    clearTimeout(draftTimer);
    const s = store("local");
    try { if (s) s.removeItem(DRAFT_KEY); } catch (e) { /* storage blocked */ }
  }
  function saveDraftSoon() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraft, 400);
  }

  /* ---------- results ---------- */

  // Which of our picks won the race: {j: index of the winning pick, or -1}; null before a result is entered.
  function raceOutcome(r) {
    const w = r.result && r.result.no;
    if (blank(w)) return null;
    for (let j = 0; j < r.picks.length; j++) if (sameNo(r.picks[j].no, w)) return { j };
    return { j: -1 };
  }
  function record(meetings) {
    const rec = { races: 0, top: 0, any: 0, napW: 0, napL: 0 };
    meetings.forEach(m => {
      m.races.forEach(r => {
        if (!r.picks.some(hasPick)) return;
        const o = raceOutcome(r);
        if (!o) return;
        rec.races++;
        if (o.j === 0) rec.top++;
        if (o.j >= 0) rec.any++;
      });
      const nap = bestOf(m, m.nap);
      if (nap && !blank(nap.r.result && nap.r.result.no)) {
        if (sameNo(nap.p.no, nap.r.result.no)) rec.napW++;
        else rec.napL++;
      }
    });
    return rec;
  }
  function pct(a, b) { return b ? Math.round((a / b) * 100) + "%" : "–"; }

  /* ---------- sharing ---------- */

  function shareText(m, withUrl) {
    const lines = [SITE + ": Champ de Mars, " + fmtDate(m.date) + (blank(m.day) ? "" : " (Day " + m.day + ")")];
    if (m.going) lines.push("Going: " + m.going);
    lines.push("");
    m.races.forEach((r, i) => {
      const picks = r.picks.filter(hasPick);
      if (!picks.length) return;
      const head = "R" + (i + 1) + (r.time ? " " + r.time : "") + (blank(r.distance) ? "" : " · " + r.distance + "m");
      lines.push(head + ": " + picks.map(horseText).join(" / "));
    });
    const nap = bestOf(m, m.nap);
    const nb = bestOf(m, m.nb);
    if (nap || nb) lines.push("");
    if (nap) lines.push("NAP: R" + (nap.ri + 1) + " " + horseText(nap.p));
    if (nb) lines.push("Next best: R" + (nb.ri + 1) + " " + horseText(nb.p));
    const winners = [];
    m.races.forEach((r, i) => {
      const o = raceOutcome(r);
      if (!o) return;
      const note = o.j === 0 ? " (our top pick)" : o.j > 0 ? " (our " + ORD[o.j] + " choice)" : "";
      winners.push("R" + (i + 1) + ": " + horseText(r.result) + note);
    });
    if (winners.length) lines.push("", "Winners:", ...winners);
    lines.push("");
    if (state.settings.byline) lines.push("Selections by " + state.settings.byline + ".");
    if (withUrl && isWeb()) lines.push("Full card: " + pageUrl(m));
    lines.push("18+. Please bet responsibly.");
    return lines.join("\n");
  }

  /* ---------- views ---------- */

  function masthead() {
    const s = state.settings;
    return `<header class="mast"><p class="eyebrow"><span class="nw">Champ de Mars</span> · <span class="nw">Port Louis</span> · <span class="nw">Racing since 1812</span></p>
      <h1>${esc(SITE)}</h1>${s.byline ? `<p class="byline">by ${esc(s.byline)}</p>` : ""}${s.intro ? `<p class="intro">${esc(s.intro)}</p>` : ""}</header>`;
  }

  function statusLine() {
    return ui.status ? `<p class="notice status${ui.statusErr ? " err" : ""}" role="status">${esc(ui.status)}</p>` : "";
  }

  function ownerBar(m) {
    if (!ui.signedIn) return "";
    const d = loadDraft();
    const draftLabel = d ? (d._origId ? "changes to " + fmtShort(d._origId) : "new meeting for " + fmtShort(d.date)) : "";
    return `<div class="ownerbar" role="toolbar" aria-label="Editor tools">
      <span class="ob-label">Editor · ${esc(REPO.owner)}/${esc(REPO.repo)}</span>
      <button type="button" class="btn primary" data-act="new">New meeting</button>
      ${m ? `<button type="button" class="btn" data-act="edit" data-id="${esc(m.id)}">Edit or add results</button>` : ""}
      <button type="button" class="btn" data-act="settings">Settings</button>
      <button type="button" class="link" data-act="signout">Sign out</button>
      ${d ? `<span class="ob-draft">Unpublished draft: ${esc(draftLabel)}
        <button type="button" class="btn" data-act="resume">Resume</button>
        <button type="button" class="link" data-act="discard">Discard</button></span>` : ""}
    </div>`;
  }

  function betCard(code, label, b, cls) {
    if (!b) return "";
    let mark = "";
    if (raceOutcome(b.r)) {
      mark = sameNo(b.p.no, b.r.result.no) ? '<span class="pill win">Won</span>' : '<span class="pill lose">Beaten</span>';
    }
    return `<div class="bet ${cls}"><span class="bet-code">${code}</span><div>
      <p class="bet-label">${label} · R${b.ri + 1}${b.r.time ? " · " + esc(b.r.time) : ""}</p>
      <p class="bet-horse">${chip(b.p.no)}<span>${horseLabel(b.p)}</span>${mark}</p></div></div>`;
  }

  function raceRow(m, r, i) {
    let picks = "";
    r.picks.forEach((p, j) => {
      if (!hasPick(p)) return;
      const won = sameNo(p.no, r.result && r.result.no);
      picks += `<li class="${j === 0 ? "top" : ""}${won ? " winner" : ""}"><span class="place">${ORD[j] || ""}</span>${chip(p.no)}
        <span class="hname">${horseLabel(p)}</span>${isRef(m.nap, i, j) ? '<span class="mini nap">NAP</span>' : ""}${isRef(m.nb, i, j) ? '<span class="mini nb">NB</span>' : ""}</li>`;
    });
    const meta = [blank(r.distance) ? "" : r.distance + " m", r.cls].filter(x => !blank(x)).map(esc).join(" · ");
    const o = raceOutcome(r);
    let result = "";
    if (o) {
      const pill = o.j === 0 ? '<span class="pill win">Top pick won</span>'
        : o.j > 0 ? `<span class="pill win">Won with our ${ORD[o.j]} choice</span>`
          : '<span class="pill lose">Not in our picks</span>';
      result = `<p class="result"><span class="lbl">Winner</span>${chip(r.result.no)}<span>${esc(r.result.name)}</span>${pill}</p>`;
    }
    return `<li class="race"><div class="rno"><span class="n">R${i + 1}</span>${r.time ? `<span class="rtime">${esc(r.time)}</span>` : ""}</div>
      <div class="rbody">${meta ? `<p class="rmeta">${meta}</p>` : ""}${r.name ? `<h3 class="rname">${esc(r.name)}</h3>` : ""}
        ${picks ? `<ol class="picks">${picks}</ol>` : '<p class="fine">No selections for this race.</p>'}
        ${r.comment ? `<p class="rcomment">${esc(r.comment)}</p>` : ""}${result}</div></li>`;
  }

  function shareRow(m) {
    const wa = "https://wa.me/?text=" + encodeURIComponent(shareText(m, true));
    const fb = "https://www.facebook.com/sharer/sharer.php?u=" + encodeURIComponent(pageUrl(m));
    return `<div class="share">
        <a class="btn" href="${esc(wa)}" target="_blank" rel="noopener noreferrer">Share on WhatsApp</a>
        ${isWeb() ? `<a class="btn" href="${esc(fb)}" target="_blank" rel="noopener noreferrer">Share on Facebook</a>` : ""}
        <button type="button" class="btn" data-act="copy">Copy text</button>
        ${typeof navigator.share === "function" ? '<button type="button" class="btn" data-act="native-share">More sharing options</button>' : ""}
        <span class="copied" role="status">${esc(ui.copied)}</span></div>
      ${ui.copyFallback != null ? `<textarea id="copybox" readonly aria-label="Selections text to copy">${esc(ui.copyFallback)}</textarea>` : ""}`;
  }

  function meetingView(m, isLatest) {
    const nap = bestOf(m, m.nap);
    const nb = bestOf(m, m.nb);
    return `<section aria-labelledby="mtitle"><div class="mhead"><div class="mmeta">
          ${isLatest ? '<span class="tag live">Latest</span>' : ""}
          ${blank(m.day) ? "" : `<span class="tag">Day ${esc(m.day)}</span>`}
          ${m.going ? `<span class="tag">Going: ${esc(m.going)}</span>` : ""}</div>
        <h2 id="mtitle">${esc(fmtDate(m.date))}</h2>
        ${m.notes ? `<p class="mnotes">${esc(m.notes)}</p>` : ""}</div>
      ${nap || nb ? `<div class="bets">${betCard("NAP", "Best bet", nap, "nap")}${betCard("NB", "Next best", nb, "nb")}</div>` : ""}
      ${shareRow(m)}
      <ol class="races">${m.races.map((r, i) => raceRow(m, r, i)).join("")}</ol></section>`;
  }

  function sidePanels(m, all) {
    const year = (m.date || "").slice(0, 4);
    const rec = record(all.filter(x => (x.date || "").slice(0, 4) === year));
    const list = all.map(x => `<li><a href="#${esc(x.id)}"${x.id === m.id ? ' class="cur" aria-current="page"' : ""}>
      <span>${esc(fmtShort(x.date))}</span><span class="ad">${blank(x.day) ? "" : "Day " + esc(x.day)}</span></a></li>`).join("");
    return `<aside class="side"><section class="panel"><h2 class="ph">${esc(year)} record</h2><dl class="stats">
          <div><dt>Top-pick winners</dt><dd>${rec.top}/${rec.races}<small>${pct(rec.top, rec.races)}</small></dd></div>
          <div><dt>Winner among our three picks</dt><dd>${rec.any}/${rec.races}<small>${pct(rec.any, rec.races)}</small></dd></div>
          <div><dt>NAP record (won–beaten)</dt><dd>${rec.napW}–${rec.napL}</dd></div></dl>
        <p class="fine">Counts races with a result entered.</p></section>
      <section class="panel"><h2 class="ph">Meetings</h2><ul class="archive">${list}</ul></section></aside>`;
  }

  function footer() {
    const signin = !ui.signedIn && ui.view !== "signin"
      ? '<p><button type="button" class="link" data-act="signin">Editor sign-in</button></p>' : "";
    return `<footer class="foot"><p>18+ only. Bet responsibly and only with money you can afford to lose.</p>
      <p>Selections are opinions, not guaranteed results. Check the official racecard for final fields and non-runners.</p>${signin}</footer>`;
  }

  function renderHome() {
    const all = sorted();
    const m = currentMeeting();
    const top = masthead() + ownerBar(m) + statusLine();
    if (!m) {
      return top + `<div class="empty"><h2>No selections yet</h2>
        <p>Each race meeting's selections appear here: three picks per race, the NAP and next best, and the results once racing is over.</p>
        ${ui.signedIn ? '<button type="button" class="btn primary" data-act="new">Post your first meeting</button>' : "<p>Check back before the next meeting at Champ de Mars.</p>"}</div>` + footer();
    }
    return top + `<div class="layout">${meetingView(m, m === all[0])}${sidePanels(m, all)}</div>` + footer();
  }

  function renderSignin() {
    const known = !!(REPO.owner && REPO.repo);
    const repo = esc(REPO.owner + "/" + REPO.repo);
    return `${masthead()}<form class="editor" id="signin" novalidate>
      <div class="ed-head"><h2>Editor sign-in</h2>
        <p class="fine">Publishing saves your selections to ${known ? `the GitHub repository <code>${repo}</code>` : "this site's GitHub repository"}. GitHub Pages then updates the site.</p></div>
      ${known ? "" : '<p class="err">This copy of the site doesn\'t know its GitHub repository. Set <code>owner</code> and <code>repo</code> in <code>assets/config.js</code>.</p>'}
      <ol class="steps">
        <li>Open <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">GitHub's page for a new fine-grained token</a>.</li>
        <li>Under <b>Repository access</b>, choose <b>Only select repositories</b> and pick <code>${esc(REPO.repo || "this site's repository")}</code>.</li>
        <li>Under <b>Permissions</b>, give <b>Contents</b> the <b>Read and write</b> access level. Add nothing else.</li>
        <li>Generate the token, copy it and paste it below.</li>
      </ol>
      <label class="fld" for="tok"><span>GitHub token</span><input id="tok" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="github_pat_…"></label>
      <label class="check" for="remember"><input id="remember" type="checkbox"><span>Remember me on this device</span></label>
      <p class="fine">The token stays in this browser and is only sent to api.github.com. Don't tick “Remember me” on a shared computer.</p>
      <div class="ed-actions"><button type="submit" class="btn primary">Sign in</button>
        <button type="button" class="btn" data-act="signin-cancel">Cancel</button>
        <span id="signin-status" class="status" role="status"></span></div>
    </form>${footer()}`;
  }

  function fld(label, path, type, opt) {
    const o = opt || {};
    const id = "f-" + path.replace(/\./g, "-");
    return `<label class="fld${o.wide ? " wide" : ""}" for="${id}"><span>${label}</span>
      <input id="${id}" type="${type}" data-f="${path}" value="${esc(getPath(ui.edit, path))}"${o.ph ? ` placeholder="${esc(o.ph)}"` : ""}${o.attrs ? " " + o.attrs : ""}></label>`;
  }

  function bestSelects(d) {
    const options = [];
    d.races.forEach((r, i) => r.picks.forEach((p, j) => {
      if (hasPick(p)) options.push({ v: i + "-" + j, t: "R" + (i + 1) + " · " + horseText(p) });
    }));
    const select = (key, label) => {
      const cur = d[key] ? d[key].race + "-" + d[key].pick : "";
      return `<label class="fld" for="f-${key}"><span>${label}</span><select id="f-${key}" data-best="${key}"><option value="">None</option>` +
        options.map(o => `<option value="${o.v}"${o.v === cur ? " selected" : ""}>${esc(o.t)}</option>`).join("") + "</select></label>";
    };
    return select("nap", "NAP (best bet)") + select("nb", "Next best");
  }

  function edRace(r, i) {
    const n = i + 1;
    let picks = "";
    for (let j = 0; j < 3; j++) {
      const p = r.picks[j] || { no: "", name: "" };
      picks += `<div class="ed-pick"><span class="place">${ORD[j]}</span>
        <input id="f-r${i}-p${j}-no" type="number" min="1" max="24" inputmode="numeric" data-f="races.${i}.picks.${j}.no" value="${esc(p.no)}" placeholder="No." aria-label="Race ${n}, ${ORD[j]} choice, horse number">
        <input id="f-r${i}-p${j}-name" type="text" data-f="races.${i}.picks.${j}.name" value="${esc(p.name)}" placeholder="Horse name" aria-label="Race ${n}, ${ORD[j]} choice, horse name"></div>`;
    }
    return `<li><fieldset><legend>Race ${n}</legend><div class="grid4">
          ${fld("Off time", `races.${i}.time`, "time")}
          ${fld("Distance (m)", `races.${i}.distance`, "number", { ph: "1400", attrs: 'min="800" max="3200" step="5" inputmode="numeric"' })}
          ${fld("Class / rating band", `races.${i}.cls`, "text")}
          ${fld("Race name", `races.${i}.name`, "text", { ph: "Optional" })}</div>
        ${picks}
        ${fld("Comment", `races.${i}.comment`, "text", { wide: true, ph: "Optional: one line on why" })}
        <div class="ed-result"><span class="place">Winner</span>
          <input id="f-r${i}-res-no" type="number" min="1" max="24" inputmode="numeric" data-f="races.${i}.result.no" value="${esc(r.result.no)}" placeholder="No." aria-label="Race ${n} winner, horse number">
          <input id="f-r${i}-res-name" type="text" data-f="races.${i}.result.name" value="${esc(r.result.name)}" placeholder="After racing: winner's name" aria-label="Race ${n} winner, horse name"></div>
        <div><button type="button" class="link" data-act="remove-race" data-i="${i}">Remove race ${n}</button></div></fieldset></li>`;
  }

  function renderEditor() {
    const d = ui.edit;
    const goings = blank(d.going) || GOINGS.includes(d.going) ? GOINGS : [d.going].concat(GOINGS);
    const goingOptions = goings.map(g => `<option${g === d.going ? " selected" : ""}>${esc(g)}</option>`).join("");
    let del = "";
    if (d._origId) {
      del = ui.confirmDel === d._origId
        ? '<span class="confirm">Delete this meeting for everyone? <button type="button" class="btn danger" data-act="del-yes">Delete</button><button type="button" class="btn" data-act="del-no">Keep it</button></span>'
        : '<button type="button" class="link" data-act="del-ask">Delete meeting</button>';
    }
    return `${masthead()}<form class="editor" id="ed" novalidate>
      <div class="ed-head"><h2>${d._origId ? "Edit meeting" : "New meeting"}</h2>
        <p class="fine">Your changes are kept on this device until you publish. Publishing saves them to GitHub, and the public page updates within a minute or two.</p></div>
      <div class="grid4">${fld("Meeting date", "date", "date")}
        ${fld("Day no.", "day", "number", { ph: "e.g. 28", attrs: 'min="1" max="60" inputmode="numeric"' })}
        <label class="fld" for="f-going"><span>Going</span><select id="f-going" data-f="going">${goingOptions}</select></label></div>
      <label class="fld" for="f-notes"><span>Meeting notes</span><textarea id="f-notes" data-f="notes" placeholder="Optional: track bias, weather, non-runners">${esc(d.notes)}</textarea></label>
      <div id="bestbets" class="grid2">${bestSelects(d)}</div>
      <ol class="ed-races">${d.races.map(edRace).join("")}</ol>
      <div><button type="button" class="btn" data-act="add-race">Add race ${d.races.length + 1}</button></div>
      <div class="ed-actions"><button type="button" class="btn primary" data-act="publish"${ui.busy ? " disabled" : ""}>${ui.busy ? "Publishing…" : "Publish meeting"}</button>
        <button type="button" class="btn" data-act="close">Close editor</button>${del}
        <span class="status${ui.statusErr ? " err" : ""}" role="status">${esc(ui.status)}</span></div>
    </form>${footer()}`;
  }

  function renderSettings() {
    const s = ui.settingsDraft;
    return `${masthead()}<form class="editor" id="settings" novalidate>
      <div class="ed-head"><h2>Settings</h2><p class="fine">Shown under the title and in the shared text.</p></div>
      <label class="fld" for="s-byline"><span>Tipster name</span><input id="s-byline" type="text" data-s="byline" value="${esc(s.byline)}" placeholder="Your name or nickname"></label>
      <label class="fld" for="s-intro"><span>Introduction</span><textarea id="s-intro" data-s="intro" placeholder="A line about your selections">${esc(s.intro)}</textarea></label>
      <div class="ed-actions"><button type="button" class="btn primary" data-act="settings-save"${ui.busy ? " disabled" : ""}>${ui.busy ? "Publishing…" : "Publish settings"}</button>
        <button type="button" class="btn" data-act="settings-close">Cancel</button>
        <span class="status${ui.statusErr ? " err" : ""}" role="status">${esc(ui.status)}</span></div>
    </form>${footer()}`;
  }

  function render() {
    let html;
    if (ui.view === "loading") {
      html = masthead() + '<p class="loading" role="status">Loading selections…</p>';
    } else if (ui.view === "error") {
      html = masthead() + `<div class="empty"><h2>Selections unavailable</h2><p>The selections couldn't be loaded. Refresh the page to try again.</p><p class="fine">${esc(ui.loadErr)}</p></div>` + footer();
    } else if (ui.view === "signin") {
      html = renderSignin();
    } else if (ui.view === "edit" && ui.edit) {
      html = renderEditor();
    } else if (ui.view === "settings" && ui.settingsDraft) {
      html = renderSettings();
    } else {
      html = renderHome();
    }
    app.innerHTML = html;
  }

  /* ---------- GitHub ---------- */

  function b64encode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function b64decode(b64) {
    const bin = atob(String(b64 || "").replace(/\s/g, ""));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  function repoPath() { return "/repos/" + encodeURIComponent(REPO.owner) + "/" + encodeURIComponent(REPO.repo); }
  function contentsPath() { return repoPath() + "/contents/" + REPO.path.split("/").map(encodeURIComponent).join("/"); }

  async function gh(method, path, body) {
    const headers = { Accept: "application/vnd.github+json", Authorization: "Bearer " + authToken };
    if (body) headers["Content-Type"] = "application/json";
    const res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
    if (!res.ok) {
      const err = new Error((json && json.message) || "HTTP " + res.status);
      err.status = res.status;
      throw err;
    }
    return json;
  }

  // The latest committed data file, read through the API so editors never work from a cached copy.
  async function getFile() {
    const meta = await gh("GET", contentsPath() + "?ref=" + encodeURIComponent(REPO.branch));
    let b64 = meta && meta.content;
    if (!b64 && meta && meta.sha) b64 = (await gh("GET", repoPath() + "/git/blobs/" + meta.sha)).content;
    let data;
    try {
      data = JSON.parse(b64decode(b64));
    } catch (e) {
      throw userError(REPO.path + " on GitHub isn't valid JSON. Fix the file on GitHub, then try again.");
    }
    return { sha: meta.sha, data };
  }

  function putFile(data, sha, message) {
    const body = { message, content: b64encode(JSON.stringify(data, null, 2) + "\n"), branch: REPO.branch };
    if (sha) body.sha = sha;
    return gh("PUT", contentsPath(), body);
  }

  async function loadPublic() {
    const res = await fetch(REPO.path, { cache: "no-cache" });
    if (!res.ok) throw new Error("Couldn't load " + REPO.path + " (HTTP " + res.status + ")");
    return res.json();
  }

  function explain(e, ctx) {
    if (e && e.userMsg) return e.userMsg;
    const repo = REPO.owner + "/" + REPO.repo;
    if (!e || typeof e.status !== "number") return "Couldn't reach GitHub. Check your connection and try again.";
    if (e.status === 401) {
      return ctx === "signin"
        ? "GitHub didn't accept that token. Check you copied all of it and that it hasn't expired."
        : "GitHub no longer accepts your token. It may have expired: sign out, then sign in with a new one.";
    }
    if (e.status === 403 && /rate limit/i.test(e.message)) return "GitHub's rate limit was reached. Wait a few minutes and try again.";
    if (ctx === "save" && (e.status === 403 || e.status === 404)) {
      return "GitHub refused the change. Check your token has Contents: Read and write access to " + repo + ".";
    }
    if (e.status === 403 || e.status === 404) {
      return "GitHub couldn't open " + REPO.path + " in " + repo + " with that token. Check the token's repository access includes " + repo + ".";
    }
    if (e.status === 409 || e.status === 422) return "The selections changed on GitHub while you were saving. Publish again.";
    return "GitHub returned an error (" + e.status + "): " + e.message;
  }

  // Apply a change to the latest committed file and commit it. A commit made in between
  // (another device, or an edit on github.com) makes GitHub refuse the write; retry once
  // on top of that newer version so nothing is overwritten.
  async function saveChange(mutate, message) {
    ui.busy = true;
    setStatus("Saving to GitHub…");
    render();
    try {
      for (let attempt = 0; ; attempt++) {
        const file = await getFile();
        const next = normalizeState(clone(file.data));
        mutate(next);
        try {
          await putFile(next, file.sha, message);
          state = next;
          ui.busy = false;
          return true;
        } catch (e) {
          if ((e.status === 409 || e.status === 422) && attempt === 0) continue;
          throw e;
        }
      }
    } catch (e) {
      ui.busy = false;
      setStatus(explain(e, "save") + (ui.view === "edit" ? " Your draft is kept on this device." : ""), true);
      render();
      return false;
    }
  }

  /* ---------- actions ---------- */

  async function publishMeeting() {
    const d = ui.edit;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date || "")) { setStatus("Set the meeting date before publishing.", true); render(); return; }
    if (!d.races.some(r => r.picks.some(hasPick))) { setStatus("Add at least one selection before publishing.", true); render(); return; }
    const m = normalizeMeeting(d);
    const withResults = m.races.some(r => !blank(r.result.no));
    const message = (withResults ? "Results for " : d._origId ? "Update selections for " : "Selections for ") + fmtDate(m.date);
    saveDraft();
    const ok = await saveChange(s => {
      const clash = s.meetings.find(x => x.id === m.id);
      if (clash && m.id !== d._origId) {
        throw userError("A meeting on " + fmtShort(m.date) + " is already posted. Edit that one instead, or change the date.");
      }
      s.meetings = s.meetings.filter(x => x.id !== d._origId && x.id !== m.id);
      s.meetings.push(m);
      s.meetings.sort(byDateDesc);
    }, message);
    if (!ok) return;
    clearDraft();
    ui.edit = null;
    ui.id = m.id;
    ui.view = "home";
    ui.copied = "";
    ui.copyFallback = null;
    setStatus("Published. The public page updates within a minute or two.");
    setHash(m.id);
    render();
    scrollTo(0, 0);
  }

  async function deleteMeeting() {
    const id = ui.edit && ui.edit._origId;
    if (!id) return;
    const ok = await saveChange(s => { s.meetings = s.meetings.filter(x => x.id !== id); }, "Remove meeting of " + fmtDate(id));
    if (!ok) return;
    clearDraft();
    ui.edit = null;
    ui.confirmDel = null;
    if (ui.id === id) ui.id = null;
    ui.view = "home";
    setStatus("Meeting deleted.");
    setHash("");
    render();
    scrollTo(0, 0);
  }

  async function saveSettings() {
    const next = { byline: ui.settingsDraft.byline.trim(), intro: ui.settingsDraft.intro.trim() };
    const ok = await saveChange(s => { s.settings = next; }, "Update page settings");
    if (!ok) return;
    ui.settingsDraft = null;
    ui.view = "home";
    setStatus("Settings published.");
    render();
    scrollTo(0, 0);
  }

  async function signIn(form) {
    const tokenInput = document.getElementById("tok");
    const rememberInput = document.getElementById("remember");
    const statusEl = document.getElementById("signin-status");
    const button = form.querySelector('button[type="submit"]');
    const show = (msg, isErr) => {
      if (statusEl) { statusEl.textContent = msg; statusEl.className = "status" + (isErr ? " err" : ""); }
    };
    const token = ((tokenInput && tokenInput.value) || "").trim();
    if (!REPO.owner || !REPO.repo) { show("This copy of the site doesn't know its GitHub repository. Set owner and repo in assets/config.js.", true); return; }
    if (!token) { show("Paste your GitHub token first.", true); return; }
    if (button) button.disabled = true;
    show("Checking the token with GitHub…");
    const previous = authToken;
    authToken = token;
    try {
      const file = await getFile();
      state = normalizeState(file.data);
      setToken(token, !!(rememberInput && rememberInput.checked));
      ui.signedIn = true;
      ui.view = "home";
      setStatus("Signed in. Your editor tools are at the top of the page.");
      render();
      scrollTo(0, 0);
    } catch (e) {
      authToken = previous;
      if (button) button.disabled = false;
      show(explain(e, "signin"), true);
    }
  }

  function signOut() {
    clearToken();
    authToken = "";
    ui.signedIn = false;
    ui.edit = null;
    ui.settingsDraft = null;
    ui.view = "home";
    setStatus("Signed out. Your GitHub token was removed from this browser.");
    render();
  }

  function openView(view) {
    ui.view = view;
    ui.confirmDel = null;
    setStatus("");
    render();
    scrollTo(0, 0);
  }

  function openSignin() {
    openView("signin");
    const input = document.getElementById("tok");
    if (input) input.focus();
  }

  function copyText() {
    const m = currentMeeting();
    if (!m) return;
    const text = shareText(m, true);
    const fallback = () => {
      ui.copyFallback = text;
      ui.copied = "Select the text below and copy it.";
      render();
      const box = document.getElementById("copybox");
      if (box) { box.focus(); box.select(); }
    };
    try {
      navigator.clipboard.writeText(text).then(() => {
        ui.copyFallback = null;
        ui.copied = "Copied. Paste it into your post.";
        render();
      }, fallback);
    } catch (e) {
      fallback();
    }
  }

  function nativeShare() {
    const m = currentMeeting();
    if (!m || typeof navigator.share !== "function") return;
    navigator.share({ title: SITE, text: shareText(m, false), url: pageUrl(m) }).catch(() => { /* dismissed */ });
  }

  /* ---------- editor data ---------- */

  function blankRace() {
    return {
      time: "", name: "", distance: "", cls: "", comment: "",
      picks: [{ no: "", name: "" }, { no: "", name: "" }, { no: "", name: "" }],
      result: { no: "", name: "" }
    };
  }

  function nextSaturday() {
    const d = new Date();
    d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7));
    return isoDate(d);
  }

  function newMeeting() {
    const date = nextSaturday();
    const year = date.slice(0, 4);
    let lastDay = 0;
    state.meetings.forEach(m => {
      if ((m.date || "").slice(0, 4) === year && Number(m.day) > lastDay) lastDay = Number(m.day);
    });
    const races = [];
    for (let i = 0; i < 8; i++) races.push(blankRace());
    return { _origId: null, date, day: lastDay ? lastDay + 1 : "", going: "Good", notes: "", nap: null, nb: null, races };
  }

  function prepareDraft(d) {
    d.races = Array.isArray(d.races) ? d.races : [];
    d.races.forEach(r => {
      r.picks = Array.isArray(r.picks) ? r.picks : [];
      while (r.picks.length < 3) r.picks.push({ no: "", name: "" });
      if (!r.result || typeof r.result !== "object") r.result = { no: "", name: "" };
    });
    return d;
  }

  function editable(m) {
    const d = prepareDraft(clone(m));
    d._origId = m.id;
    return d;
  }

  function setPath(obj, path, value) {
    const keys = path.split(".");
    let o = obj;
    for (let i = 0; i < keys.length - 1; i++) o = o[/^\d+$/.test(keys[i]) ? Number(keys[i]) : keys[i]];
    o[keys[keys.length - 1]] = value;
  }

  function getPath(obj, path) {
    let o = obj;
    for (const k of path.split(".")) {
      if (o == null) return "";
      o = o[/^\d+$/.test(k) ? Number(k) : k];
    }
    return o == null ? "" : o;
  }

  function isEmptyRace(r) {
    return !r.time && !r.name && blank(r.distance) && !r.cls && !r.comment && !r.picks.some(hasPick) && blank(r.result.no) && !r.result.name;
  }

  function normalizeMeeting(d) {
    const txt = v => String(v == null ? "" : v).trim();
    const num = v => {
      if (blank(v)) return "";
      const n = Number(v);
      return isNaN(n) ? txt(v) : n;
    };
    const m = {
      id: d.date, date: d.date, day: num(d.day), going: d.going || "", notes: txt(d.notes),
      nap: d.nap || null, nb: d.nb || null, updatedAt: new Date().toISOString(),
      races: d.races.map(r => ({
        time: r.time || "", name: txt(r.name), distance: num(r.distance), cls: txt(r.cls), comment: txt(r.comment),
        picks: r.picks.map(p => ({ no: num(p.no), name: txt(p.name) })),
        result: { no: num(r.result && r.result.no), name: txt(r.result && r.result.name) }
      }))
    };
    // Races left completely empty at the end of the card are dropped, so a short meeting shows no blank races.
    while (m.races.length && isEmptyRace(m.races[m.races.length - 1])) m.races.pop();
    if (!bestOf(m, m.nap)) m.nap = null;
    if (!bestOf(m, m.nb)) m.nb = null;
    return m;
  }

  /* ---------- events ---------- */

  app.addEventListener("input", e => {
    const el = e.target;
    if (!el || !el.dataset) return;
    if (el.dataset.f && ui.edit) {
      setPath(ui.edit, el.dataset.f, el.value);
      if (el.dataset.f.indexOf(".picks.") > -1) {
        const box = document.getElementById("bestbets");
        if (box) box.innerHTML = bestSelects(ui.edit);
      }
      saveDraftSoon();
    } else if (el.dataset.s && ui.settingsDraft) {
      ui.settingsDraft[el.dataset.s] = el.value;
    }
  });

  app.addEventListener("change", e => {
    const el = e.target;
    if (!el || !el.dataset || !ui.edit) return;
    if (el.dataset.best) {
      const parts = String(el.value).split("-");
      ui.edit[el.dataset.best] = el.value ? { race: Number(parts[0]), pick: Number(parts[1]) } : null;
      saveDraftSoon();
      return;
    }
    // Typing a winner's number fills in the name when the winner was one of our picks.
    const match = el.dataset.f && /^races\.(\d+)\.result\.no$/.exec(el.dataset.f);
    if (!match) return;
    const i = Number(match[1]);
    const r = ui.edit.races[i];
    if (!r || !blank(r.result.name)) return;
    const pick = r.picks.find(p => sameNo(p.no, r.result.no) && p.name);
    if (!pick) return;
    r.result.name = pick.name;
    const input = document.getElementById("f-r" + i + "-res-name");
    if (input) input.value = pick.name;
    saveDraftSoon();
  });

  app.addEventListener("submit", e => {
    e.preventDefault();
    if (e.target && e.target.id === "signin") signIn(e.target);
  });

  app.addEventListener("click", e => {
    const b = e.target && e.target.closest ? e.target.closest("[data-act]") : null;
    if (!b) return;
    const act = b.dataset.act;
    if (EDITOR_ACTIONS.has(act) && !ui.signedIn) return;
    if (DRAFT_ACTIONS.has(act) && !ui.edit) return;
    switch (act) {
      case "copy": copyText(); break;
      case "native-share": nativeShare(); break;
      case "signin": openSignin(); break;
      case "signin-cancel": openView("home"); break;
      case "signout": signOut(); break;
      case "new":
        ui.edit = newMeeting();
        saveDraft();
        openView("edit");
        break;
      case "edit": {
        const m = findMeeting(b.dataset.id);
        if (m) { ui.edit = editable(m); saveDraft(); openView("edit"); }
        break;
      }
      case "resume": {
        const d = loadDraft();
        if (d) { ui.edit = prepareDraft(d); openView("edit"); }
        break;
      }
      case "discard":
        clearDraft();
        setStatus("Draft discarded.");
        render();
        break;
      case "close":
        saveDraft();
        ui.edit = null;
        ui.view = "home";
        ui.confirmDel = null;
        setStatus("Draft kept on this device. Resume it from the editor tools.");
        render();
        scrollTo(0, 0);
        break;
      case "add-race": {
        ui.edit.races.push(blankRace());
        saveDraft();
        render();
        const input = document.getElementById("f-races-" + (ui.edit.races.length - 1) + "-time");
        if (input) input.focus();
        break;
      }
      case "remove-race": {
        const i = Number(b.dataset.i);
        const d = ui.edit;
        d.races.splice(i, 1);
        ["nap", "nb"].forEach(k => {
          if (!d[k]) return;
          if (d[k].race === i) d[k] = null;
          else if (d[k].race > i) d[k] = { race: d[k].race - 1, pick: d[k].pick };
        });
        saveDraft();
        render();
        break;
      }
      case "publish": if (!ui.busy) publishMeeting(); break;
      case "del-ask": ui.confirmDel = ui.edit._origId; render(); break;
      case "del-no": ui.confirmDel = null; render(); break;
      case "del-yes": if (!ui.busy) deleteMeeting(); break;
      case "settings":
        ui.settingsDraft = { byline: state.settings.byline || "", intro: state.settings.intro || "" };
        openView("settings");
        break;
      case "settings-close":
        ui.settingsDraft = null;
        openView("home");
        break;
      case "settings-save": if (!ui.busy) saveSettings(); break;
      default: break;
    }
  });

  window.addEventListener("hashchange", () => {
    const h = readHash();
    if (h === "editor") {
      if (!ui.signedIn) openSignin();
      return;
    }
    if (!findMeeting(h)) return;
    ui.id = h;
    ui.copied = "";
    ui.copyFallback = null;
    if (ui.view === "home" || ui.view === "signin") {
      ui.view = "home";
      render();
      scrollTo(0, 0);
    }
  });

  /* ---------- start ---------- */

  async function init() {
    const hash = readHash();
    try {
      if (authToken) {
        // A token saved on this device: read straight from GitHub so the editor sees the latest data.
        try {
          const file = await getFile();
          state = normalizeState(file.data);
          ui.signedIn = true;
        } catch (e) {
          if (e && e.status === 401) {
            clearToken();
            authToken = "";
            setStatus("Your saved GitHub token no longer works. Sign in again to post.", true);
          } else {
            ui.signedIn = true;
            setStatus(explain(e, "load") + " Showing the public copy for now.", true);
          }
          state = normalizeState(await loadPublic());
        }
      } else {
        state = normalizeState(await loadPublic());
      }
      ui.view = hash === "editor" && !ui.signedIn ? "signin" : "home";
      if (findMeeting(hash)) ui.id = hash;
    } catch (e) {
      ui.view = "error";
      ui.loadErr = e && e.message ? e.message : String(e);
    }
    render();
  }

  init();
})();
