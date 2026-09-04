// ============================================================
// MJPT — Feed Page
// Paginated log history — 20 per page, load more on demand.
// ============================================================

import { db } from "/js/firebase.js";
import {
  collection, query, orderBy, limit, startAfter, getDocs
} from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";

import {
  $, showToast, relativeDate, formatTime, escapeHtml,
  BRISTOL, STOOL_COLORS, formatSymptoms, formatVolume, USERS
} from "/js/utils.js";


// ── STATE ──
const PAGE_SIZE   = 20;
let activeFilter  = "all";
let lastDoc       = null;   // Firestore cursor for pagination
let hasMore       = true;
let loading       = false;
let renderedDates = {};     // track which date groups are already rendered


// ── INIT ──
document.addEventListener("DOMContentLoaded", async () => {
  showSkeleton();
  initFilters();
  await loadPage();
});


// ── FILTERS ──
function initFilters() {
  const row = document.querySelector(".filter-row");
  row.addEventListener("click", e => {
    const chip = e.target.closest(".filter-chip");
    if (!chip) return;
    row.querySelectorAll(".filter-chip").forEach(c => c.classList.remove("active"));
    chip.classList.add("active");
    activeFilter = chip.dataset.filter;
    resetAndReload();
  });
}


// ── RESET & RELOAD (on filter change) ──
async function resetAndReload() {
  lastDoc       = null;
  hasMore       = true;
  renderedDates = {};
  $("#feedList").innerHTML  = "";
  $("#feedCount").textContent = "";
  removeLoadMoreBtn();
  showSkeleton();
  await loadPage();
}


// ── LOAD PAGE ──
async function loadPage() {
  if (loading || !hasMore) return;
  loading = true;

  try {
    // Simple query — no composite index needed
    // Fetch ordered by timestamp, filter user in JS
    let q;
    if (lastDoc) {
      q = query(collection(db, "logs"), orderBy("timestamp","desc"), startAfter(lastDoc), limit(PAGE_SIZE * 3));
    } else {
      q = query(collection(db, "logs"), orderBy("timestamp","desc"), limit(PAGE_SIZE * 3));
    }

    const snap = await getDocs(q);
    let docs = snap.docs;

    // Filter by user in JS — avoids composite index requirement
    if (activeFilter === "mike" || activeFilter === "jenna") {
      docs = docs.filter(d => d.data().user === activeFilter);
    }

    // Trim to page size
    const pageDocs = docs.slice(0, PAGE_SIZE);
    hasMore = snap.docs.length === PAGE_SIZE * 3; // approximation

    if (pageDocs.length === 0 && !lastDoc) {
      $("#feedList").innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg>
          <p>No logs yet. Start logging via the Telegram bot.</p>
        </div>`;
      removeLoadMoreBtn();
      loading = false;
      return;
    }

    // Update cursor to last raw doc (not filtered)
    if (snap.docs.length > 0) {
      lastDoc = snap.docs[snap.docs.length - 1];
    }

    // Render
    const container = $("#feedList");
    const logs      = pageDocs.map(d => ({ id: d.id, ...d.data() }));

    // Clear skeleton on first load
    if (container.querySelector(".skeleton")) {
      container.innerHTML = "";
      renderedDates = {};
    }

    logs.forEach(log => {
      const dateKey = relativeDate(log.timestamp);

      if (!renderedDates[dateKey]) {
        renderedDates[dateKey] = true;
        const divider = document.createElement("div");
        divider.className   = "date-divider";
        divider.textContent = dateKey;
        container.appendChild(divider);

        const list = document.createElement("div");
        list.className = "history-list";
        list.id        = `group-${dateKey.replace(/\s/g, "-")}`;
        container.appendChild(list);
      }

      const group = document.getElementById(`group-${dateKey.replace(/\s/g, "-")}`);
      if (group) group.appendChild(buildLogItem(log));
    });

    // Update count
    const totalShown = container.querySelectorAll(".history-item").length;
    $("#feedCount").textContent = `${totalShown} log${totalShown !== 1 ? "s" : ""}${hasMore ? "+" : ""}`;

    if (hasMore && pageDocs.length > 0) {
      showLoadMoreBtn();
    } else {
      removeLoadMoreBtn();
    }

  } catch (err) {
    console.error("loadPage error:", err.code, err.message);
    const container = $("#feedList");
    container.innerHTML = `
      <div class="empty-state">
        <p>Failed to load: ${err.message}</p>
        <button class="btn btn-secondary" onclick="resetAndReload()" style="margin-top:12px">Retry</button>
      </div>`;
    $("#feedCount").textContent = "";
    showToast("Failed to load logs");
  }

  loading = false;
}


// ── LOAD MORE BUTTON ──
function showLoadMoreBtn() {
  removeLoadMoreBtn();
  const btn = document.createElement("button");
  btn.id        = "loadMoreBtn";
  btn.className = "btn btn-secondary";
  btn.style.cssText = "width:calc(100% - 32px);margin:0 16px 24px;";
  btn.textContent   = "Load more";
  btn.addEventListener("click", async () => {
    btn.textContent = "Loading...";
    btn.disabled    = true;
    await loadPage();
  });
  document.getElementById("feedList").after(btn);
}

function removeLoadMoreBtn() {
  const btn = document.getElementById("loadMoreBtn");
  if (btn) btn.remove();
}


// ── SKELETON ──
function showSkeleton() {
  const container = $("#feedList");
  container.innerHTML = "";

  for (let g = 0; g < 2; g++) {
    const div = document.createElement("div");
    div.className = "date-divider";
    div.innerHTML = `<span class="skeleton" style="display:inline-block;width:60px;height:11px;border-radius:4px">&nbsp;</span>`;
    container.appendChild(div);

    const list = document.createElement("div");
    list.className = "history-list";

    for (let i = 0; i < 4; i++) {
      const item = document.createElement("div");
      item.className = "history-item";
      item.style.pointerEvents = "none";
      item.innerHTML = `
        <div class="hi-dot skeleton" style="background:transparent;width:10px;height:10px;border-radius:50%"></div>
        <div class="hi-body" style="gap:6px;display:flex;flex-direction:column">
          <span class="skeleton" style="display:inline-block;width:40px;height:10px;border-radius:4px">&nbsp;</span>
          <span class="skeleton" style="display:inline-block;width:${130 + i*18}px;height:13px;border-radius:4px">&nbsp;</span>
        </div>
        <div class="hi-right" style="gap:6px;display:flex;flex-direction:column;align-items:flex-end">
          <span class="skeleton" style="display:inline-block;width:36px;height:10px;border-radius:4px">&nbsp;</span>
          <span class="skeleton" style="display:inline-block;width:28px;height:10px;border-radius:4px">&nbsp;</span>
        </div>
      `;
      list.appendChild(item);
    }
    container.appendChild(list);
  }

  $("#feedCount").innerHTML = `<span class="skeleton" style="display:inline-block;width:40px;height:11px;border-radius:4px">&nbsp;</span>`;
}


// ── BUILD LOG ITEM ──
function buildLogItem(log) {
  const bristol  = BRISTOL[log.bristolType] || BRISTOL[4];
  const colorHex = STOOL_COLORS[log.color]?.hex || "#8B4513";
  const time     = formatTime(log.timestamp);
  const user     = USERS[log.user] || USERS.mike;
  const vol      = formatVolume(log.volume);
  const hasSymp  = log.symptoms && !log.symptoms.includes("none") && log.symptoms.length > 0;

  const item = document.createElement("div");
  item.className = "history-item";
  item.innerHTML = `
    <div class="hi-dot" style="background:${colorHex}"></div>
    <div class="hi-body">
      <div class="hi-who ${log.user}">${user.name}</div>
      <div class="hi-desc">${bristol.label} · ${vol}${hasSymp ? " · " + log.symptoms.map(s => s.charAt(0).toUpperCase()+s.slice(1)).join(", ") : ""}</div>
      ${log.notes ? `<div class="hi-meta" style="font-style:italic;color:var(--color-ink-soft)">"${escapeHtml(log.notes)}"</div>` : ""}
    </div>
    <div class="hi-right">
      <div class="hi-time">${time}</div>
      <div class="hi-type" style="color:${colorHex}">${STOOL_COLORS[log.color]?.label || "Brown"}</div>
    </div>
  `;

  item.addEventListener("click", () => showLogDetail(log));
  return item;
}


// ── LOG DETAIL MODAL ──
function showLogDetail(log) {
  const existing = document.getElementById("logDetailModal");
  if (existing) existing.remove();

  const bristol  = BRISTOL[log.bristolType] || BRISTOL[4];
  const colorObj = STOOL_COLORS[log.color]  || STOOL_COLORS.brown;
  const user     = USERS[log.user]          || USERS.mike;
  const symptoms = formatSymptoms(log.symptoms);
  const vol      = formatVolume(log.volume);
  const time     = formatTime(log.timestamp);
  const date     = relativeDate(log.timestamp);

  const overlay = document.createElement("div");
  overlay.id    = "logDetailModal";
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:300;display:flex;align-items:flex-end;backdrop-filter:blur(4px)";

  overlay.innerHTML = `
    <div style="background:var(--color-bg);border-radius:24px 24px 0 0;width:100%;padding:16px 20px 48px;max-height:80vh;overflow-y:auto">
      <div style="width:36px;height:4px;background:var(--color-border);border-radius:2px;margin:0 auto 20px"></div>

      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px">
        <div>
          <div style="font-size:10px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:var(--color-ink-faint);margin-bottom:3px">${date} · ${time}</div>
          <div style="font-family:var(--font-display);font-size:24px;letter-spacing:-0.5px;color:var(--color-ink)">${user.name}'s log</div>
        </div>
        <div style="width:36px;height:36px;border-radius:50%;background:${colorObj.hex};flex-shrink:0;border:2px solid var(--color-border)"></div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
        <div style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:12px;padding:12px">
          <div style="font-size:9px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:var(--color-ink-faint);margin-bottom:4px">Consistency</div>
          <div style="font-size:15px;font-weight:600;color:var(--color-ink)">${bristol.label}</div>
          <div style="font-size:11px;color:var(--color-ink-soft);margin-top:2px;line-height:1.4">${bristol.desc}</div>
        </div>
        <div style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:12px;padding:12px">
          <div style="font-size:9px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:var(--color-ink-faint);margin-bottom:4px">Volume</div>
          <div style="font-size:15px;font-weight:600;color:var(--color-ink)">${vol}</div>
        </div>
        <div style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:12px;padding:12px">
          <div style="font-size:9px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:var(--color-ink-faint);margin-bottom:4px">Color</div>
          <div style="display:flex;align-items:center;gap:6px">
            <div style="width:10px;height:10px;border-radius:50%;background:${colorObj.hex};flex-shrink:0"></div>
            <div style="font-size:15px;font-weight:600;color:var(--color-ink)">${colorObj.label}</div>
          </div>
        </div>
        <div style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:12px;padding:12px">
          <div style="font-size:9px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:var(--color-ink-faint);margin-bottom:4px">Symptoms</div>
          <div style="font-size:15px;font-weight:600;color:var(--color-ink)">${symptoms}</div>
        </div>
      </div>

      ${log.notes ? `<div style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:12px;padding:12px;margin-bottom:10px">
        <div style="font-size:9px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:var(--color-ink-faint);margin-bottom:4px">Notes</div>
        <div style="font-size:13px;color:var(--color-ink);font-style:italic;line-height:1.5">"${escapeHtml(log.notes)}"</div>
      </div>` : ""}

      <div style="background:var(--color-surface-2);border:1px solid var(--color-border);border-radius:12px;padding:12px">
        <div style="font-size:11px;color:var(--color-ink-soft);line-height:1.5">
          <strong style="font-weight:600;color:var(--color-ink)">${bristol.label}</strong> — ${bristol.clinical}
        </div>
      </div>
    </div>
  `;

  overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}
