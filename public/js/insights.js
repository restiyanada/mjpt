// ============================================================
// MJPT — Insights Page
// Solo view for Mike/Jenna, combined comparison view for Both.
// ============================================================

import { db } from "/js/firebase.js";
import {
  collection, query, orderBy, getDocs, Timestamp
} from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";

import {
  $, $$, showToast, formatDate,
  getPeriodRange, calcGutScore, scoreLabel, scoreRingOffset,
  calcBristolDist, calcSymptomFreq, calcPeakTimes, calcDailyFreq,
  getFunTitle, bristolClass, bristolBadgeText, formatVolume,
  calcSyncRate, generateStory, BRISTOL, USERS
} from "/js/utils.js";


// ── STATE ──
let currentUser   = "both";
let currentPeriod = "week";
let allLogs       = [];


// ── INIT ──
document.addEventListener("DOMContentLoaded", async () => {
  initDateLabel();
  initUserToggle();
  initPeriodPills();
  initShareBtn();
  showSkeleton(); // show immediately before data loads
  await loadLogs();
  render();
});


// ── SKELETON ──
function showSkeleton() {
  const S = (w, h = 16) =>
    `<span class="skeleton" style="display:inline-block;width:${w}px;height:${h}px;border-radius:6px">&nbsp;</span>`;

  if (currentUser === "both") {
    // Combined skeleton
    document.getElementById("soloView").style.display     = "none";
    document.getElementById("combinedView").style.display = "block";

    // Duel card
    const duel = $("#duelCard");
    if (duel) duel.innerHTML = `
      <div class="duel-side">
        ${S(30, 10)} <br>
        ${S(88, 88)} <br>
        ${S(50, 18)}
        <div class="duel-meta">${S(70, 10)}</div>
      </div>
      <div class="duel-divider"><div class="duel-vs">VS</div></div>
      <div class="duel-side">
        ${S(30, 10)} <br>
        ${S(88, 88)} <br>
        ${S(50, 18)}
        <div class="duel-meta">${S(70, 10)}</div>
      </div>`;

    // H2H table
    const hth = $("#hthTable");
    if (hth) hth.innerHTML = [1,2,3,4,5,6,7].map(() =>
      `<tr><td class="hth-val">${S(36)}</td><td class="hth-label">${S(80)}</td><td class="hth-val">${S(36)}</td></tr>`
    ).join("");

    // Story
    const story = $("#storyCard");
    if (story) story.innerHTML = `${S(280, 13)}<br><br>${S(240, 13)}<br><br>${S(200, 13)}`;

  } else {
    // Solo skeleton
    document.getElementById("soloView").style.display     = "block";
    document.getElementById("combinedView").style.display = "none";

    // Score ring
    const scoreNum   = $("#scoreNum");
    const scoreLabel = $("#scoreLabel");
    const scoreBadge = $("#scoreBadge");
    if (scoreNum)   scoreNum.innerHTML   = S(40, 24);
    if (scoreLabel) scoreLabel.innerHTML = S(80, 18);
    if (scoreBadge) scoreBadge.innerHTML = S(140, 14);

    // Stat tiles
    [["statTotal",28],["statAvg",28],["statBristol",28],["statTopSymptom",28]].forEach(([id, h]) => {
      const el = $(`#${id}`);
      if (el) el.innerHTML = S(id === "statBristol" || id === "statTopSymptom" ? 60 : 40, h);
    });
  }
}


function initShareBtn() {
  const btn = $("#shareBtn");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const { generateReport } = await import("/js/report.js");
    btn.innerHTML = "Generating...";
    btn.disabled  = true;
    const ok = await generateReport(currentUser, currentPeriod, allLogs);
    btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg> Share`;
    btn.disabled = false;
    if (!ok) showToast("Failed to generate image");
  });
}

function initDateLabel() {
  $("#dateLabel").textContent = new Date().toLocaleDateString("en-AU", {
    timeZone: "Asia/Makassar",
    weekday: "long", day: "numeric", month: "long"
  });
}

function initUserToggle() {
  const toggle = $("#userToggle");
  toggle.addEventListener("click", e => {
    const btn = e.target.closest(".user-toggle-btn");
    if (!btn) return;
    toggle.querySelectorAll(".user-toggle-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentUser = btn.dataset.user;
    render();
  });
}

function initPeriodPills() {
  const row = $("#periodPills");
  row.addEventListener("click", e => {
    const btn = e.target.closest(".pill");
    if (!btn) return;
    row.querySelectorAll(".pill").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentPeriod = btn.dataset.period;
    render();
  });
}




// ── SMART AVG ──
// For long periods (month/year/all), use actual log date span
// rather than the full period length to avoid misleadingly small numbers.
function calcSmartAvg(logs, periodDays) {
  if (!logs.length) return "—";

  // If period is short (<=31 days), use period days as-is
  if (periodDays <= 31) {
    return (logs.length / periodDays).toFixed(1);
  }

  // For longer periods, use actual span between first and last log
  const timestamps = logs
    .map(l => l.timestamp?.seconds)
    .filter(Boolean)
    .sort((a, b) => a - b);

  if (timestamps.length < 2) return logs.length.toFixed(1);

  const spanDays = Math.max(1, Math.round(
    (timestamps[timestamps.length-1] - timestamps[0]) / (60*60*24)
  ));

  const avg = logs.length / spanDays;
  // Show 1 decimal if < 10, else round to integer
  return avg >= 10 ? String(Math.round(avg)) : avg.toFixed(1);
}

// ── LOAD ──
async function loadLogs() {
  try {
    const snap = await getDocs(query(collection(db, "logs"), orderBy("timestamp", "desc")));
    allLogs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error("Failed to load logs:", err);
    showToast("Failed to load data");
  }
}


// ── FILTER ──
function filterLogs(user) {
  const { start, end } = getPeriodRange(currentPeriod);
  const startTs = Timestamp.fromDate(start);
  const endTs   = Timestamp.fromDate(end);
  const u = user || currentUser;

  return allLogs.filter(l => {
    const ts       = l.timestamp;
    const inPeriod = ts && ts.seconds >= startTs.seconds && ts.seconds <= endTs.seconds;
    const inUser   = u === "both" || l.user === u;
    return inPeriod && inUser;
  });
}


// ── RENDER ──
function render() {
  const solo     = document.getElementById("soloView");
  const combined = document.getElementById("combinedView");

  if (currentUser === "both") {
    solo.style.display     = "none";
    combined.style.display = "block";
    renderCombined();
  } else {
    solo.style.display     = "block";
    combined.style.display = "none";
    renderSolo();
  }
}


// ══════════════════════════════════════════
// SOLO VIEW
// ══════════════════════════════════════════

function renderSolo() {
  const logs = filterLogs();

  // Reset stale DOM
  $("#statTotal").textContent      = "—";
  $("#statAvg").textContent        = "—";
  $("#statBristol").textContent    = "—";
  $("#statBristolSub").textContent = "no logs yet";
  $("#statTopSymptom").textContent    = "—";
  $("#statTopSymptomSub").textContent = "this period";
  $("#scoreNum").textContent       = "—";
  $("#scoreLabel").textContent     = "—";
  $("#scoreBadge").textContent     = "";
  const ring = $("#scoreRing");
  if (ring) {
    ring.classList.remove("good", "warn", "danger");
    ring.style.strokeDashoffset = "251";
  }

  renderScore(logs);
  renderStats(logs);
  renderBarChart();
  renderBristolDist(logs);
  renderPeakTimes(logs);
  renderTopSymptoms(logs);
  renderInsights(logs);
}


// ── SCORE ──
function renderScore(logs) {
  const score = calcGutScore(logs);
  const info  = scoreLabel(score);
  const ring  = $("#scoreRing");
  const numEl = $("#scoreNum");
  const lblEl = $("#scoreLabel");
  const bdgEl = $("#scoreBadge");

  if (score === null) {
    numEl.textContent = "—";
    lblEl.textContent = "No data yet";
    bdgEl.textContent = "Log via Telegram to see score";
    ring.classList.remove("good", "warn", "danger");
    ring.style.strokeDashoffset = "251";
    return;
  }

  numEl.textContent = score;
  lblEl.textContent = info.label;
  ring.classList.remove("good", "warn", "danger");
  ring.classList.add(info.class);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    ring.style.strokeDashoffset = scoreRingOffset(score);
  }));
  bdgEl.textContent = "Based on this period's logs";
}


// ── STATS ──
function renderStats(logs) {
  const total = logs.length;
  const { start, end } = getPeriodRange(currentPeriod);
  const days  = Math.max(1, Math.round((end - start) / (1000 * 60 * 60 * 24)));
  const avg   = total > 0 ? calcSmartAvg(logs, days) : "—";

  const bristolCounts = {};
  logs.forEach(l => {
    if (!l.bristolType) return;
    bristolCounts[l.bristolType] = (bristolCounts[l.bristolType] || 0) + 1;
  });
  const topEntry   = Object.entries(bristolCounts).sort((a, b) => b[1] - a[1])[0];
  const topBristol = topEntry ? parseInt(topEntry[0]) : null;

  $("#statTotal").textContent = total || "0";
  $("#statAvg").textContent   = avg;

  if (topBristol) {
    const b = BRISTOL[topBristol];
    $("#statBristol").textContent    = b?.label || `T${topBristol}`;
    $("#statBristolSub").textContent = b?.desc  || "most frequent";
    const badgeEl = $("#statBristolBadge");
    badgeEl.textContent = topBristol === 4 ? "The Dream" : b?.label || "—";
    badgeEl.className   = `badge badge-${bristolClass(topBristol)}`;
  } else {
    $("#statBristol").textContent    = "—";
    $("#statBristolSub").textContent = "no logs yet";
    const badgeEl = $("#statBristolBadge");
    badgeEl.textContent = "—";
    badgeEl.className   = "badge badge-neutral";
  }

  const symFreq  = {};
  logs.forEach(l => {
    if (!l.symptoms || l.symptoms.includes("none")) return;
    l.symptoms.forEach(s => { symFreq[s] = (symFreq[s] || 0) + 1; });
  });
  const topSym = Object.entries(symFreq).sort((a, b) => b[1] - a[1])[0];

  if (topSym) {
    const pct  = Math.round((topSym[1] / total) * 100);
    const name = topSym[0].charAt(0).toUpperCase() + topSym[0].slice(1);
    $("#statTopSymptom").textContent    = name;
    $("#statTopSymptomSub").textContent = `${pct}% of logs`;
    const bdg = $("#statTopSymptomBadge");
    bdg.textContent = topSym[0] === "blood" ? "⚠ Blood" : name;
    bdg.className   = topSym[0] === "blood" ? "badge badge-danger" : "badge badge-warn";
  } else {
    $("#statTopSymptom").textContent    = "None";
    $("#statTopSymptomSub").textContent = "no symptoms logged";
    const bdg = $("#statTopSymptomBadge");
    bdg.textContent = "Clear";
    bdg.className   = "badge badge-good";
  }
}


// ── BAR CHART ──
function renderBarChart() {
  const container  = $("#barChart");
  container.innerHTML = "";

  const showMike  = currentUser === "both" || currentUser === "mike";
  const showJenna = currentUser === "both" || currentUser === "jenna";

  const mikeLogs  = showMike  ? filterLogs("mike")  : [];
  const jennaLogs = showJenna ? filterLogs("jenna") : [];

  const days     = 7;
  const dayNames = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
  const now      = new Date();
  const mikeFreq = calcDailyFreq(mikeLogs,  days);
  const jennaFreq= calcDailyFreq(jennaLogs, days);
  const maxVal   = Math.max(...mikeFreq, ...jennaFreq, 1);

  const legend = $("#chartLegend");
  legend.innerHTML = "";
  if (showMike) {
    legend.innerHTML += `<div class="legend-item"><div class="legend-dot" style="background:var(--color-ink)"></div><span>Ryan</span></div>`;
  }
  if (showJenna) {
    legend.innerHTML += `<div class="legend-item"><div class="legend-dot" style="background:var(--color-accent)"></div><span>Cia</span></div>`;
  }

  for (let i = 0; i < days; i++) {
    const d    = new Date(now);
    d.setDate(d.getDate() - (days - 1 - i));
    const lbl  = dayNames[d.getDay() === 0 ? 6 : d.getDay() - 1];
    const mVal = mikeFreq[i];
    const jVal = jennaFreq[i];

    const col  = document.createElement("div");
    col.className = "bar-col";

    let barsHTML = `<div class="bar-group">`;
    if (showMike) {
      const h = Math.max(Math.round((mVal / maxVal) * 60), mVal > 0 ? 4 : 0);
      barsHTML += `<div class="bar mike" style="height:${h}px"></div>`;
    }
    if (showJenna) {
      const h = Math.max(Math.round((jVal / maxVal) * 60), jVal > 0 ? 4 : 0);
      barsHTML += `<div class="bar jenna" style="height:${h}px"></div>`;
    }
    barsHTML += `</div>`;

    col.innerHTML = barsHTML + `<div class="bar-label">${lbl}</div>`;
    container.appendChild(col);
  }

  const sub = $("#chartSubLabel");
  const user = currentUser === "both" ? "Combined" : currentUser === "mike" ? "Ryan" : "Cia";
  sub.textContent = `${user} — past 7 days`;
}


// ── BRISTOL DIST ──
function renderBristolDist(logs) {
  const container = $("#bristolDist");
  container.innerHTML = "";

  const counts = { 1:0, 2:0, 3:0, 4:0, 5:0, 6:0, 7:0 };
  logs.forEach(l => {
    const t = parseInt(l.bristolType);
    if (t >= 1 && t <= 7) counts[t]++;
  });
  const total = logs.length || 1;

  const rows = [
    { type:1, cls:"bad",  tag:"Hard",  tagCls:"badge-danger" },
    { type:2, cls:"bad",  tag:"Rock",  tagCls:"badge-danger" },
    { type:3, cls:"ok",   tag:"OK",    tagCls:"badge-warn"   },
    { type:4, cls:"good", tag:"Ideal", tagCls:"badge-good"   },
    { type:5, cls:"ok",   tag:"Soft",  tagCls:"badge-warn"   },
    { type:6, cls:"bad",  tag:"Mushy", tagCls:"badge-danger" },
    { type:7, cls:"bad",  tag:"Liquid",tagCls:"badge-danger" }
  ];

  rows.forEach(row => {
    const pct = Math.round((counts[row.type] / total) * 100);
    const b   = BRISTOL[row.type];
    const el  = document.createElement("div");
    el.className = "bd-row";
    el.innerHTML = `
      <div class="bd-label" style="color:var(--color-ink-soft);width:56px">${b.label}</div>
      <div class="bd-track"><div class="bd-fill ${row.cls}" style="width:${pct}%"></div></div>
      <div class="bd-pct">${pct}%</div>
      <div class="bd-tag badge ${row.tagCls}">${row.tag}</div>
    `;
    container.appendChild(el);
  });
}


// ── PEAK TIMES ──
function renderPeakTimes(logs) {
  const container = $("#timeGrid");
  container.innerHTML = "";

  const times  = calcPeakTimes(logs);
  const maxVal = Math.max(...Object.values(times), 1);
  const buckets = [
    { key:"06:00–08:00", label:"06–08" },
    { key:"08:00–10:00", label:"08–10" },
    { key:"10:00–12:00", label:"10–12" },
    { key:"12:00–15:00", label:"12–15" },
    { key:"15:00–18:00", label:"15–18" },
    { key:"18:00–22:00", label:"18–22" }
  ];
  const peak = Object.entries(times).sort((a, b) => b[1] - a[1])[0]?.[0];

  buckets.forEach(({ key, label }) => {
    const h      = Math.round((times[key] / maxVal) * 44);
    const isPeak = key === peak && times[key] > 0;
    const col    = document.createElement("div");
    col.className = "time-col";
    col.innerHTML = `
      <div class="time-bar-wrap">
        <div class="time-bar-fill" style="height:${Math.max(h, 3)}px"></div>
      </div>
      ${isPeak ? `<div class="time-peak">Peak</div>` : `<div style="height:14px"></div>`}
      <div class="time-label">${label}</div>
    `;
    container.appendChild(col);
  });
}


// ── TOP SYMPTOMS ──
function renderTopSymptoms(logs) {
  const container = $("#topSymptomsCard");
  if (!container) return;
  container.innerHTML = "";

  const total = logs.length;
  if (total === 0) {
    container.innerHTML = `<div style="font-size:var(--text-sm);color:var(--color-ink-soft)">No logs this period.</div>`;
    return;
  }

  const freq = {};
  logs.forEach(l => {
    if (!l.symptoms || l.symptoms.includes("none")) return;
    l.symptoms.forEach(s => { freq[s] = (freq[s] || 0) + 1; });
  });

  const hasBlood = freq["blood"] > 0;
  const ranked   = Object.entries(freq).filter(([k]) => k !== "blood").sort((a, b) => b[1] - a[1]);

  if (ranked.length === 0 && !hasBlood) {
    container.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;padding:8px 0">
        <span class="badge badge-good">✓ Clear</span>
        <span style="font-size:var(--text-sm);color:var(--color-ink-soft)">No symptoms this period</span>
      </div>`;
    return;
  }

  const maxCount = ranked[0]?.[1] || 1;
  ranked.slice(0, 5).forEach(([sym, count], i) => {
    const pct      = Math.round((count / total) * 100);
    const barWidth = Math.round((count / maxCount) * 100);
    const label    = sym.charAt(0).toUpperCase() + sym.slice(1);
    const el       = document.createElement("div");
    el.style.cssText = "display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--color-border)";
    el.innerHTML = `
      <div style="font-size:12px;font-weight:600;color:var(--color-ink-faint);width:16px;text-align:center">${i+1}</div>
      <div style="flex:1">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px">
          <span style="font-size:var(--text-sm);font-weight:600;color:var(--color-ink)">${label}</span>
          <span style="font-size:var(--text-xs);color:var(--color-ink-soft)">${count}x · ${pct}%</span>
        </div>
        <div style="background:var(--color-border);border-radius:100px;height:4px;overflow:hidden">
          <div style="background:var(--color-accent);height:100%;width:${barWidth}%;border-radius:100px;transition:width 0.4s ease"></div>
        </div>
      </div>
    `;
    container.appendChild(el);
  });

  if (hasBlood) {
    const bloodPct = Math.round((freq["blood"] / total) * 100);
    const el = document.createElement("div");
    el.style.cssText = "display:flex;align-items:center;gap:10px;padding:10px 0;margin-top:4px";
    el.innerHTML = `
      <span class="badge badge-danger">⚠ Blood</span>
      <span style="font-size:var(--text-sm);color:var(--color-ink)">${freq["blood"]}x logged (${bloodPct}%) — monitor closely</span>
    `;
    container.appendChild(el);
  }
}


// ── CLINICAL INSIGHTS ──
function renderInsights(logs) {
  const container = $("#insightsList");
  container.innerHTML = "";

  if (logs.length === 0) {
    container.innerHTML = `<div class="insight-item"><div class="insight-pill info">Info</div><div class="insight-text">No logs found. Start logging via Telegram.</div></div>`;
    return;
  }

  const dist       = calcBristolDist(logs);
  const freq       = calcSymptomFreq(logs);
  const times      = calcPeakTimes(logs);
  const score      = calcGutScore(logs);
  const idealPct   = (dist["3"] || 0) + (dist["4"] || 0);
  const peakBucket = Object.entries(times).sort((a, b) => b[1] - a[1])[0]?.[0];
  const insights   = [];

  if (idealPct >= 60) {
    insights.push({ type:"good", text:`<strong>${idealPct}% of logs were Crackle or Soft</strong> — that's the sweet spot. Your gut is doing great!` });
  } else if (idealPct >= 40) {
    insights.push({ type:"note", text:`<strong>${idealPct}% were in the good range.</strong> Still room to improve — try more water and fibre.` });
  } else {
    insights.push({ type:"note", text:`<strong>Consistency needs work.</strong> Most logs were on the harder or mushier side. Check diet and hydration.` });
  }
  if (freq.bloating > 0) insights.push({ type:"note", text:`<strong>Bloating in ${freq.bloating}% of logs.</strong> Dairy and gluten are common culprits.` });
  if (freq.cramps > 0)   insights.push({ type:"note", text:`<strong>Cramps in ${freq.cramps}% of logs.</strong> Could be stress, diet, or a rough week.` });
  if (freq.blood > 0)    insights.push({ type:"note", text:`<strong>Blood in ${freq.blood}% of logs.</strong> Often harmless, but see a doctor if it continues.` });
  if (peakBucket && times[peakBucket] > 0) {
    const isMorning = peakBucket.startsWith("06") || peakBucket.startsWith("08") || peakBucket.startsWith("10");
    insights.push({ type:"info", text:`<strong>Peak time: ${peakBucket}.</strong> ${isMorning ? "Your gut loves mornings." : "You tend to go later in the day."}` });
  }
  if (score !== null) {
    const txt = score >= 80 ? "Your gut is killing it." : score >= 60 ? "Doing well with a few things to watch." : "Consistency and symptoms are dragging the score down.";
    insights.push({ type: score >= 60 ? "good" : "note", text:`<strong>Gut score: ${score}/100.</strong> ${txt}` });
  }

  insights.forEach(({ type, text }) => {
    const el = document.createElement("div");
    el.className = "insight-item fade-in";
    el.innerHTML = `
      <div class="insight-pill ${type}">${type === "good" ? "Good" : type === "note" ? "Note" : "Pattern"}</div>
      <div class="insight-text">${text}</div>
    `;
    container.appendChild(el);
  });
}


// ══════════════════════════════════════════
// COMBINED VIEW
// ══════════════════════════════════════════

function renderCombined() {
  const mikeLogs  = filterLogs("mike");
  const jennaLogs = filterLogs("jenna");

  renderDuel(mikeLogs, jennaLogs);
  renderHeadToHead(mikeLogs, jennaLogs);
  renderSplitBristol(mikeLogs, jennaLogs);
  renderActivityTimeline(mikeLogs, jennaLogs);
  renderSyncRate(mikeLogs, jennaLogs);
  renderStory(mikeLogs, jennaLogs);
  renderCombinedInsights(mikeLogs, jennaLogs);
}


// ── DUEL RINGS ──
function renderDuel(mikeLogs, jennaLogs) {
  const container = $("#duelCard");
  container.innerHTML = "";

  const mikeScore  = calcGutScore(mikeLogs);
  const jennaScore = calcGutScore(jennaLogs);
  const { start, end } = getPeriodRange(currentPeriod);
  const days = Math.max(1, Math.round((end - start) / (1000 * 60 * 60 * 24)));

  const mikeAvg  = calcSmartAvg(mikeLogs,  days);
  const jennaAvg = calcSmartAvg(jennaLogs, days);

  const mikeBristol  = getTopBristol(mikeLogs);
  const jennaBristol = getTopBristol(jennaLogs);

  const mikeWins  = (mikeScore  ?? -1) > (jennaScore ?? -1);
  const jennaWins = (jennaScore ?? -1) > (mikeScore  ?? -1);

  const makeRingSVG = (score) => {
    const info   = scoreLabel(score);
    const offset = score !== null ? scoreRingOffset(score) : 251;
    const cls    = score !== null ? (info?.class || "neutral") : "";
    return `
      <svg width="90" height="90" viewBox="0 0 100 100">
        <circle class="ring-bg" cx="50" cy="50" r="40"/>
        <circle class="ring-fill ${cls}" cx="50" cy="50" r="40"
          stroke-dasharray="251" stroke-dashoffset="${offset}"/>
      </svg>`;
  };

  const makeSide = (user, logs, score, avg, topBristol, isWinner) => {
    const info      = scoreLabel(score);
    const label     = info?.label || "No data";
    const bristol   = topBristol ? (BRISTOL[topBristol]?.label || "—") : "—";
    const userName  = user === "mike" ? "Ryan" : "Cia";

    return `
      <div class="duel-side">
        <div class="duel-name">${userName}</div>
        <div class="duel-ring-wrap">
          ${makeRingSVG(score)}
          ${isWinner ? `<div class="duel-crown">👑</div>` : ""}
          <div class="duel-ring-center">
            <div style="font-family:var(--font-display);font-size:22px;color:white;line-height:1;letter-spacing:-1px">${score ?? "—"}</div>
            <div style="font-size:9px;color:rgba(255,255,255,0.3);margin-top:1px">/100</div>
          </div>
        </div>
        <div class="duel-score-label">${label}</div>
        <div class="duel-meta">
          ${logs.length} log${logs.length !== 1 ? "s" : ""} · ${avg}/day<br>
          Top: ${bristol}
        </div>
      </div>`;
  };

  container.innerHTML =
    makeSide("mike",  mikeLogs,  mikeScore,  mikeAvg,  mikeBristol,  mikeWins)
    + `<div class="duel-divider"><div class="duel-vs">VS</div></div>`
    + makeSide("jenna", jennaLogs, jennaScore, jennaAvg, jennaBristol, jennaWins);
}

function getTopBristol(logs) {
  const counts = {};
  logs.forEach(l => {
    if (!l.bristolType) return;
    counts[l.bristolType] = (counts[l.bristolType] || 0) + 1;
  });
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return top ? parseInt(top[0]) : null;
}


// ── HEAD TO HEAD ──
function renderHeadToHead(mikeLogs, jennaLogs) {
  const table = $("#hthTable");
  table.innerHTML = "";

  const { start, end } = getPeriodRange(currentPeriod);
  const days = Math.max(1, Math.round((end - start) / (1000 * 60 * 60 * 24)));

  const calcStats = (logs) => {
    const total       = logs.length;
    const avg         = total > 0 ? calcSmartAvg(logs, days) : "0";
    const topBristol  = getTopBristol(logs);
    const topBLabel   = topBristol ? (BRISTOL[topBristol]?.label || "—") : "—";
    const withSym     = logs.filter(l => l.symptoms && !l.symptoms.includes("none") && l.symptoms.length > 0).length;
    const symPct      = total > 0 ? Math.round((withSym / total) * 100) : 0;
    const symFreq     = {};
    logs.forEach(l => { if (!l.symptoms || l.symptoms.includes("none")) return; l.symptoms.forEach(s => { symFreq[s] = (symFreq[s]||0)+1; }); });
    const topSym      = Object.entries(symFreq).sort((a,b)=>b[1]-a[1])[0];
    const topSymLabel = topSym ? topSym[0].charAt(0).toUpperCase()+topSym[0].slice(1) : "None";
    const score       = calcGutScore(logs);
    const consistency = Math.round((logs.filter(l => [3,4,5].includes(parseInt(l.bristolType))).length / Math.max(total,1)) * 100);
    return { total, avg, topBLabel, symPct, topSymLabel, score, consistency };
  };

  const m = calcStats(mikeLogs);
  const j = calcStats(jennaLogs);

  const rows = [
    { label:"Total logs",    mVal: String(m.total),       jVal: String(j.total),       compare: (a,b)=>parseInt(a)>parseInt(b) },
    { label:"Daily avg",     mVal: m.avg,                  jVal: j.avg,                  compare: (a,b)=>parseFloat(a)>parseFloat(b) },
    { label:"Gut score",     mVal: m.score ? String(m.score) : "—", jVal: j.score ? String(j.score) : "—", compare: (a,b)=>parseInt(a)>parseInt(b) },
    { label:"Consistency",   mVal: `${m.consistency}%`,   jVal: `${j.consistency}%`,   compare: (a,b)=>parseInt(a)>parseInt(b) },
    { label:"Top bristol",   mVal: m.topBLabel,             jVal: j.topBLabel,             compare: null },
    { label:"Symptom rate",  mVal: `${m.symPct}%`,         jVal: `${j.symPct}%`,         compare: (a,b)=>parseInt(a)<parseInt(b) }, // lower is better
    { label:"Top symptom",   mVal: m.topSymLabel,           jVal: j.topSymLabel,           compare: null }
  ];

  // Header
  table.innerHTML = `<tr>
    <td class="hth-val" style="color:var(--color-ink);font-weight:700">Ryan</td>
    <td class="hth-label">Metric</td>
    <td class="hth-val" style="color:var(--color-accent);font-weight:700">Cia</td>
  </tr>`;

  rows.forEach(row => {
    let mClass = "", jClass = "";
    if (row.compare && row.mVal !== "—" && row.jVal !== "—") {
      if (row.compare(row.mVal, row.jVal)) { mClass = "winner"; jClass = "loser"; }
      else if (row.compare(row.jVal, row.mVal)) { jClass = "winner"; mClass = "loser"; }
    }
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="hth-val ${mClass}">${row.mVal}</td>
      <td class="hth-label">${row.label}</td>
      <td class="hth-val ${jClass}">${row.jVal}</td>
    `;
    table.appendChild(tr);
  });
}


// ── SPLIT BRISTOL ──
function renderSplitBristol(mikeLogs, jennaLogs) {
  const container = $("#splitBristolDist");
  container.innerHTML = "";

  const countByType = (logs) => {
    const c = { 1:0, 2:0, 3:0, 4:0, 5:0, 6:0, 7:0 };
    logs.forEach(l => { const t = parseInt(l.bristolType); if (t>=1&&t<=7) c[t]++; });
    return c;
  };

  const mc = countByType(mikeLogs);
  const jc = countByType(jennaLogs);
  const mTotal = mikeLogs.length  || 1;
  const jTotal = jennaLogs.length || 1;

  const types = [
    { type:1, tag:"Hard",  tagCls:"badge-danger" },
    { type:2, tag:"Rock",  tagCls:"badge-danger" },
    { type:3, tag:"OK",    tagCls:"badge-warn"   },
    { type:4, tag:"Ideal", tagCls:"badge-good"   },
    { type:5, tag:"Soft",  tagCls:"badge-warn"   },
    { type:6, tag:"Mushy", tagCls:"badge-danger" },
    { type:7, tag:"Liquid",tagCls:"badge-danger" }
  ];

  types.forEach(({ type, tag, tagCls }) => {
    const b    = BRISTOL[type];
    const mPct = Math.round((mc[type] / mTotal) * 100);
    const jPct = Math.round((jc[type] / jTotal) * 100);
    if (mPct === 0 && jPct === 0) return;

    const el = document.createElement("div");
    el.className = "split-bd-row";
    el.innerHTML = `
      <div class="split-bd-label">
        <span>${b.label}</span>
        <span class="badge ${tagCls}" style="font-size:9px">${tag}</span>
      </div>
      <div class="split-bd-bars">
        <div class="split-bd-bar-row">
          <div class="split-bd-who">MIKE</div>
          <div class="split-bd-track"><div class="split-bd-fill mike" style="width:${mPct}%"></div></div>
          <div class="split-bd-pct">${mPct}%</div>
        </div>
        <div class="split-bd-bar-row">
          <div class="split-bd-who">JENNA</div>
          <div class="split-bd-track"><div class="split-bd-fill jenna" style="width:${jPct}%"></div></div>
          <div class="split-bd-pct">${jPct}%</div>
        </div>
      </div>
    `;
    container.appendChild(el);
  });

  if (!container.children.length) {
    container.innerHTML = `<div style="font-size:var(--text-sm);color:var(--color-ink-soft)">No logs this period.</div>`;
  }
}


// ── ACTIVITY TIMELINE ──
function renderActivityTimeline(mikeLogs, jennaLogs) {
  const container = $("#activityTimeline");
  container.innerHTML = "";

  const days     = 7;
  const dayNames = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
  const now      = new Date();

  const countByDay = (logs) => {
    const c = {};
    for (let i = 0; i < days; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - (days - 1 - i));
      const key = d.toLocaleDateString("en-CA");
      c[key] = 0;
    }
    logs.forEach(l => {
      const d = l.timestamp?.toDate();
      if (!d) return;
      const key = d.toLocaleDateString("en-CA");
      if (key in c) c[key]++;
    });
    return c;
  };

  const mkCounts = countByDay(mikeLogs);
  const jnCounts = countByDay(jennaLogs);
  const dateKeys = Object.keys(mkCounts);
  const maxCount = Math.max(...Object.values(mkCounts), ...Object.values(jnCounts), 1);

  const makeRow = (who, counts, color) => {
    const daysHTML = dateKeys.map((key, i) => {
      const count = counts[key] || 0;
      const size  = count > 0 ? Math.max(8, Math.round((count / maxCount) * 18)) : 0;
      const d = new Date(now);
      d.setDate(d.getDate() - (days - 1 - i));
      const lbl = dayNames[d.getDay() === 0 ? 6 : d.getDay() - 1];
      return `
        <div class="timeline-day">
          <div class="timeline-dot-wrap">
            ${count > 0 ? `<div class="timeline-dot" style="width:${size}px;height:${size}px;background:${color};opacity:${0.4 + (count/maxCount)*0.6}"></div>` : `<div style="width:6px;height:6px;border-radius:50%;background:var(--color-border)"></div>`}
          </div>
          <div class="timeline-day-lbl">${lbl}</div>
        </div>`;
    }).join("");

    return `<div class="timeline-row">
      <div class="timeline-who">${who}</div>
      <div class="timeline-days">${daysHTML}</div>
    </div>`;
  };

  container.innerHTML = `<div class="timeline-grid">
    ${makeRow("MIKE",  mkCounts, "var(--color-ink)")}
    ${makeRow("JENNA", jnCounts, "var(--color-accent)")}
  </div>`;
}


// ── SYNC RATE ──
function renderSyncRate(mikeLogs, jennaLogs) {
  const container = $("#syncCard");
  container.innerHTML = "";

  const syncPct = calcSyncRate(mikeLogs, jennaLogs);

  let desc;
  if (mikeLogs.length === 0 || jennaLogs.length === 0) {
    desc = "Both need to log to calculate sync rate.";
  } else if (syncPct >= 60) {
    desc = `You two logged within 2hrs of each other on ${syncPct}% of shared days. Gut twins! 👯`;
  } else if (syncPct >= 30) {
    desc = `Your schedules overlapped on ${syncPct}% of shared days.`;
  } else if (syncPct > 0) {
    desc = `You were on pretty different schedules — ${syncPct}% of days had a close log.`;
  } else {
    desc = "No shared days with overlapping logs this period.";
  }

  container.innerHTML = `
    <div class="sync-num">${syncPct}%</div>
    <div class="sync-body">
      <div class="sync-label">Gut Sync Rate</div>
      <div class="sync-sub">${desc}</div>
    </div>
  `;
}


// ── STORY ──
function renderStory(mikeLogs, jennaLogs) {
  const container = $("#storyCard");
  container.innerHTML = "";

  const buildStats = (logs) => {
    const total        = logs.length;
    const hardCount    = logs.filter(l => parseInt(l.bristolType) <= 2).length;
    const looseCount   = logs.filter(l => parseInt(l.bristolType) >= 6).length;
    const healthyCount = logs.filter(l => [3,4,5].includes(parseInt(l.bristolType))).length;
    const consistencyPct = total > 0 ? Math.round((healthyCount / total) * 100) : 0;
    return { total, hardCount, looseCount, consistencyPct };
  };

  const mikeStats  = { ...buildStats(mikeLogs),  user: "mike"  };
  const jennaStats = { ...buildStats(jennaLogs), user: "jenna" };
  const syncRate   = calcSyncRate(mikeLogs, jennaLogs);
  const story      = generateStory(mikeStats, jennaStats, syncRate, currentPeriod);

  container.innerHTML = `<div class="story-text">${story}</div>`;
}


// ── COMBINED INSIGHTS ──
function renderCombinedInsights(mikeLogs, jennaLogs) {
  const container = $("#combinedInsightsList");
  container.innerHTML = "";

  const insights = [];
  const mikeScore  = calcGutScore(mikeLogs);
  const jennaScore = calcGutScore(jennaLogs);

  if (mikeScore !== null && jennaScore !== null) {
    const diff = Math.abs(mikeScore - jennaScore);
    const leader = mikeScore >= jennaScore ? "Ryan" : "Cia";
    if (diff >= 15) {
      insights.push({ type:"note", text:`<strong>${leader} is leading by ${diff} points.</strong> The gap is mainly driven by consistency and symptom frequency.` });
    } else {
      insights.push({ type:"good", text:`<strong>Both of you are within ${diff} points of each other.</strong> Very matched gut health this period.` });
    }
  }

  const mikeHard   = mikeLogs.filter(l  => parseInt(l.bristolType) <= 2).length;
  const jennaHard  = jennaLogs.filter(l => parseInt(l.bristolType) <= 2).length;
  const mikeLoose  = mikeLogs.filter(l  => parseInt(l.bristolType) >= 6).length;
  const jennaLoose = jennaLogs.filter(l => parseInt(l.bristolType) >= 6).length;

  if (mikeHard >= 2 && jennaHard >= 2) {
    insights.push({ type:"note", text:`<strong>Both of you had hard stools this period.</strong> Might be a shared diet or lifestyle factor — check hydration and fibre.` });
  } else if (mikeHard >= 2) {
    insights.push({ type:"note", text:`<strong>Ryan had ${mikeHard} hard stools.</strong> More water and fibre should help.` });
  } else if (jennaHard >= 2) {
    insights.push({ type:"note", text:`<strong>Cia had ${jennaHard} hard stools.</strong> Remind her to stay hydrated.` });
  }

  if (mikeLoose >= 2 && jennaLoose >= 2) {
    insights.push({ type:"note", text:`<strong>Both had loose stools this period.</strong> Could be a shared food trigger or environment — worth tracking meals.` });
  }

  const mikeBlood  = mikeLogs.some(l  => l.symptoms?.includes("blood"));
  const jennaBlood = jennaLogs.some(l => l.symptoms?.includes("blood"));
  if (mikeBlood)  insights.push({ type:"note", text:`<strong>Ryan logged blood this period.</strong> Monitor closely — if it recurs, see a doctor.` });
  if (jennaBlood) insights.push({ type:"note", text:`<strong>Cia logged blood this period.</strong> Monitor closely — if it recurs, see a doctor.` });

  if (insights.length === 0) {
    insights.push({ type:"good", text:"<strong>No major concerns this period.</strong> Keep up the good work, both of you!" });
  }

  insights.forEach(({ type, text }) => {
    const el = document.createElement("div");
    el.className = "insight-item fade-in";
    el.innerHTML = `
      <div class="insight-pill ${type}">${type === "good" ? "Good" : "Note"}</div>
      <div class="insight-text">${text}</div>
    `;
    container.appendChild(el);
  });
}
