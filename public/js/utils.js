// ============================================================
// MJPT — Utilities
// Shared helpers used across all pages.
// ============================================================

// ── TIMEZONE ──
// All timestamps stored as UTC in Firestore.
// Web display: WITA (UTC+8)
// Telegram: each user's local timezone handled per-user

export const DISPLAY_TZ = "Asia/Makassar"; // WITA UTC+8

export const USERS = {
  mike:  { name: "Mike",  color: "#c05a30", tz: "Australia/Melbourne" },
  jenna: { name: "Jenna", color: "#3d7a52", tz: "Asia/Makassar" }
};


// ── DATE FORMATTING ──

/**
 * Format a Firestore timestamp or JS Date to display string.
 * Always displays in WITA (UTC+8).
 */
export function formatTime(date) {
  const d = date?.toDate ? date.toDate() : new Date(date);
  return d.toLocaleTimeString("en-AU", {
    timeZone: DISPLAY_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  });
}

export function formatDate(date) {
  const d = date?.toDate ? date.toDate() : new Date(date);
  return d.toLocaleDateString("en-AU", {
    timeZone: DISPLAY_TZ,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  });
}

export function formatDateShort(date) {
  const d = date?.toDate ? date.toDate() : new Date(date);
  return d.toLocaleDateString("en-AU", {
    timeZone: DISPLAY_TZ,
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

export function formatDateTime(date) {
  const d = date?.toDate ? date.toDate() : new Date(date);
  return `${formatTime(d)}, ${formatDateShort(d)}`;
}

/**
 * Returns "Today", "Yesterday", or formatted date string.
 */
export function relativeDate(date) {
  const d     = date?.toDate ? date.toDate() : new Date(date);
  const now   = new Date();

  const dWITA   = toWITA(d);
  const nowWITA = toWITA(now);

  const dDay   = dWITA.toDateString();
  const nowDay = nowWITA.toDateString();

  const yesterday = new Date(nowWITA);
  yesterday.setDate(yesterday.getDate() - 1);

  if (dDay === nowDay) return "Today";
  if (dDay === yesterday.toDateString()) return "Yesterday";
  return formatDateShort(d);
}

function toWITA(date) {
  return new Date(date.toLocaleString("en-US", { timeZone: DISPLAY_TZ }));
}

/**
 * Get current date range for a period.
 * Returns { start: Date, end: Date }
 */
export function getPeriodRange(period) {
  const now   = new Date();
  const start = new Date(now);
  const end   = new Date(now);
  end.setHours(23, 59, 59, 999);

  switch (period) {
    case "today":
      start.setHours(0, 0, 0, 0);
      break;
    case "week":
      start.setDate(start.getDate() - 6);
      start.setHours(0, 0, 0, 0);
      break;
    case "month":
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      break;
    case "year":
      start.setMonth(0, 1);
      start.setHours(0, 0, 0, 0);
      break;
    case "all":
      start.setFullYear(2020, 0, 1);
      start.setHours(0, 0, 0, 0);
      break;
  }

  return { start, end };
}


// ── BRISTOL SCALE ──
// Fun names match CSV composition terms from Poopie app.
// Scientific info shown as tooltip/info only.

export const BRISTOL = {
  1: { label: "Pellet",  desc: "Separate hard little balls",     clinical: "Severe constipation — drink more water!", color: "#6B3A2A", scoreColor: "danger" },
  2: { label: "Rock",    desc: "Lumpy, hard, difficult to pass", clinical: "Mild constipation — add more fibre.",      color: "#7A4030", scoreColor: "warn"   },
  3: { label: "Crackle", desc: "Sausage-like with cracks",       clinical: "Slightly dry but mostly normal.",          color: "#8B5040", scoreColor: "good"   },
  4: { label: "Soft",    desc: "Smooth, easy to pass",           clinical: "Ideal! This is the gold standard.",        color: "#8B6355", scoreColor: "good"   },
  5: { label: "Blob",    desc: "Soft blobs with clear edges",    clinical: "Lacking fibre — eat more veggies.",        color: "#A07850", scoreColor: "warn"   },
  6: { label: "Mush",    desc: "Fluffy, mushy, ragged edges",    clinical: "Mild diarrhea — check hydration.",         color: "#B09060", scoreColor: "warn"   },
  7: { label: "Liquid",  desc: "Completely watery, no solids",   clinical: "Diarrhea — rest and hydrate urgently.",    color: "#C0A070", scoreColor: "danger" }
};

export function bristolClass(type) {
  const t = parseInt(type) || 4;
  if (t <= 2) return "danger";
  if (t === 3 || t === 4) return "good";
  if (t === 5 || t === 6) return "warn";
  return "danger";
}

export function bristolBadgeText(type) {
  return BRISTOL[parseInt(type)]?.label || "Unknown";
}


// ── STOOL COLORS ──

export const STOOL_COLORS = {
  brown:      { label: "Brown",       hex: "#8B4513", clinical: "Normal" },
  dark_brown: { label: "Dark brown",  hex: "#4A2010", clinical: "Normal/constipation" },
  yellow:     { label: "Yellow",      hex: "#DAA520", clinical: "Possible bile issue" },
  green:      { label: "Green",       hex: "#4A7A3A", clinical: "Fast transit" },
  red:        { label: "Red",         hex: "#C03020", clinical: "Possible bleeding" },
  black:      { label: "Black",       hex: "#1A1208", clinical: "Possible upper GI bleed" },
  pale:       { label: "Pale/clay",   hex: "#D2B48C", clinical: "Possible liver issue" }
};


// ── VOLUMES ──

export const VOLUMES = {
  child_size: { label: "Child Size", rank: 1 },
  small:      { label: "Small",      rank: 2 },
  normal:     { label: "Normal",     rank: 3 },
  huge:       { label: "Huge",       rank: 4 },
  gigantic:   { label: "Gigantic",   rank: 5 }
};

export function formatVolume(v) {
  return VOLUMES[v]?.label || "Normal";
}


// ── SYMPTOMS ──

export const SYMPTOMS = ["none", "bloating", "urgency", "cramps", "blood"];

export function formatSymptoms(symptoms) {
  if (!symptoms || symptoms.length === 0 || symptoms.includes("none")) {
    return "No symptoms";
  }
  return symptoms
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
    .join(", ");
}


// ── GUT SCORE ──

/**
 * Calculates a gut health score (0–100) from log data.
 * Factors: Bristol consistency, symptom rate, frequency regularity.
 */
export function calcGutScore(logs) {
  if (!logs || logs.length === 0) return null;

  // Bristol score — ensure integer lookup
  const bristolScores = { 1: 20, 2: 50, 3: 80, 4: 100, 5: 80, 6: 50, 7: 20 };
  const avgBristol = logs.reduce((acc, l) => {
    const type = parseInt(l.bristolType) || 4;
    return acc + (bristolScores[type] || 60);
  }, 0) / logs.length;

  // Symptom score
  const symptomRate  = logs.filter(l => l.symptoms && !l.symptoms.includes("none") && l.symptoms.length > 0).length / logs.length;
  const symptomScore = Math.max(0, 100 - (symptomRate * 100));

  // Frequency score — wider healthy range (1-6/day) to accommodate Jenna
  const days       = Math.max(1, [...new Set(logs.map(l => relativeDate(l.timestamp)))].length);
  const avgPerDay  = logs.length / days;
  const freqScore  = avgPerDay >= 1 && avgPerDay <= 6 ? 100
    : avgPerDay > 6 && avgPerDay <= 8 ? 80
    : avgPerDay > 8 ? 60
    : 40; // < 1 per day

  const score = Math.round((avgBristol * 0.5) + (symptomScore * 0.35) + (freqScore * 0.15));
  return Math.min(100, Math.max(0, score));
}

export function scoreLabel(score) {
  if (score === null) return { label: "No data", class: "warn" };
  if (score >= 80)  return { label: "Great",  class: "good" };
  if (score >= 60)  return { label: "Good",   class: "good" };
  if (score >= 40)  return { label: "Fair",   class: "warn" };
  return               { label: "Poor",   class: "danger" };
}

export function scoreRingOffset(score, r = 40) {
  const circumference = 2 * Math.PI * r;
  return circumference - (score / 100) * circumference;
}


// ── FUN TITLES ──

// ── FUN TITLES ──
// Titles are earned based on actual log data, not random rotation.
// Criteria applied in order — first match wins.

export function getFunTitle(user, logs) {
  if (!logs || logs.length === 0) return "Getting Started";

  const total      = logs.length;
  const days       = 7;
  const avgPerDay  = total / days;

  // Bristol distribution
  const bristolCounts = {};
  logs.forEach(l => { if (l.bristolType) bristolCounts[l.bristolType] = (bristolCounts[l.bristolType] || 0) + 1; });
  const softPct   = Math.round(((bristolCounts[4] || 0) / total) * 100);
  const liquidPct = Math.round(((bristolCounts[7] || 0) / total) * 100);
  const rockPct   = Math.round(((bristolCounts[1] || 0) + (bristolCounts[2] || 0)) / total * 100);

  // Symptoms
  const withSymptoms = logs.filter(l => l.symptoms && !l.symptoms.includes("none") && l.symptoms.length > 0).length;
  const symptomPct   = Math.round((withSymptoms / total) * 100);
  const hasBlood     = logs.some(l => l.symptoms?.includes("blood"));

  // ── CRITERIA (order matters — first match wins) ──

  // Medical concern
  if (hasBlood)               return "See a Doctor";

  // Consistency problems
  if (liquidPct >= 40)        return "Waterfall Mode";
  if (rockPct >= 50)          return "The Rock Collection";

  // Frequency extremes
  if (avgPerDay >= 6)         return user === "jenna" ? "Five-a-Day Champion" : "The Overachiever";
  if (avgPerDay < 0.5)        return "The Ghost Pooper";

  // Symptom heavy
  if (symptomPct >= 50)       return "Rough Patch";
  if (symptomPct >= 30)       return "Needs More Fibre";

  // Ideal consistency
  if (softPct >= 70)          return user === "mike" ? "Consistency King" : "Consistency Queen";
  if (softPct >= 50)          return "Smooth Operator";

  // High frequency but healthy
  if (avgPerDay >= 3)         return user === "jenna" ? "Prolific Pooper" : "Daily Achiever";

  // Default healthy
  return user === "mike" ? "The Reliable One" : "Gut Powerhouse";
}

// Full title criteria reference (for display in UI):
export const TITLE_CRITERIA = [
  { title: "See a Doctor",       criteria: "Blood detected in any log" },
  { title: "Waterfall Mode",     criteria: "40%+ logs are Liquid (Type 7)" },
  { title: "The Rock Collection",criteria: "50%+ logs are Pellet or Rock (Type 1–2)" },
  { title: "Five-a-Day Champion",criteria: "Average 6+ logs per day (Jenna)" },
  { title: "The Overachiever",   criteria: "Average 6+ logs per day (Mike)" },
  { title: "The Ghost Pooper",   criteria: "Less than 1 log every 2 days" },
  { title: "Rough Patch",        criteria: "50%+ logs have symptoms" },
  { title: "Needs More Fibre",   criteria: "30%+ logs have symptoms" },
  { title: "Consistency King/Queen", criteria: "70%+ logs are Soft (Type 4)" },
  { title: "Smooth Operator",    criteria: "50%+ logs are Soft (Type 4)" },
  { title: "Prolific Pooper",    criteria: "Average 3+ logs/day (Jenna)" },
  { title: "Daily Achiever",     criteria: "Average 3+ logs/day (Mike)" },
  { title: "The Reliable One",   criteria: "Healthy default (Mike)" },
  { title: "Gut Powerhouse",     criteria: "Healthy default (Jenna)" }
];


// ── DOM HELPERS ──

export function $(selector)  { return document.querySelector(selector); }
export function $$(selector) { return document.querySelectorAll(selector); }

const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export function escapeHtml(str) {
  if (!str) return str;
  return String(str).replace(/[&<>"']/g, c => HTML_ESCAPES[c]);
}

export function showToast(msg, duration = 2500) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), duration);
}

export function setActive(parent, activeEl) {
  parent.querySelectorAll(".active").forEach(el => el.classList.remove("active"));
  activeEl.classList.add("active");
}


// ── BRISTOL DISTRIBUTION ──

export function calcBristolDist(logs) {
  const dist = { "1-2": 0, "3": 0, "4": 0, "5": 0, "6-7": 0 };
  if (!logs.length) return dist;

  logs.forEach(l => {
    const t = parseInt(l.bristolType) || 4;
    if (t <= 2)      dist["1-2"]++;
    else if (t === 3) dist["3"]++;
    else if (t === 4) dist["4"]++;
    else if (t === 5) dist["5"]++;
    else              dist["6-7"]++;
  });

  // Convert to percentages
  Object.keys(dist).forEach(k => {
    dist[k] = Math.round((dist[k] / logs.length) * 100);
  });

  return dist;
}


// ── SYMPTOM FREQUENCY ──

export function calcSymptomFreq(logs) {
  const freq = { none: 0, bloating: 0, urgency: 0, cramps: 0, blood: 0 };
  if (!logs.length) return freq;

  logs.forEach(l => {
    if (!l.symptoms || l.symptoms.includes("none") || l.symptoms.length === 0) {
      freq.none++;
    } else {
      l.symptoms.forEach(s => { if (freq[s] !== undefined) freq[s]++; });
    }
  });

  // Convert to percentages
  Object.keys(freq).forEach(k => {
    freq[k] = Math.round((freq[k] / logs.length) * 100);
  });

  return freq;
}


// ── PEAK TIMES ──

export function calcPeakTimes(logs) {
  const buckets = {
    "06:00–08:00": 0,
    "08:00–10:00": 0,
    "10:00–12:00": 0,
    "12:00–15:00": 0,
    "15:00–18:00": 0,
    "18:00–22:00": 0
  };

  logs.forEach(l => {
    const d    = l.timestamp?.toDate ? l.timestamp.toDate() : new Date(l.timestamp);
    const hour = parseInt(d.toLocaleString("en-US", { timeZone: DISPLAY_TZ, hour: "numeric", hour12: false }));

    if (hour >= 6  && hour < 8)  buckets["06:00–08:00"]++;
    else if (hour >= 8  && hour < 10) buckets["08:00–10:00"]++;
    else if (hour >= 10 && hour < 12) buckets["10:00–12:00"]++;
    else if (hour >= 12 && hour < 15) buckets["12:00–15:00"]++;
    else if (hour >= 15 && hour < 18) buckets["15:00–18:00"]++;
    else if (hour >= 18 && hour < 22) buckets["18:00–22:00"]++;
  });

  return buckets;
}


// ── DAILY FREQUENCY (for bar chart) ──

export function calcDailyFreq(logs, days = 7) {
  const result = [];
  const today  = new Date();

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toLocaleDateString("en-AU", { timeZone: DISPLAY_TZ });

    const count = logs.filter(l => {
      const ld = l.timestamp?.toDate ? l.timestamp.toDate() : new Date(l.timestamp);
      return ld.toLocaleDateString("en-AU", { timeZone: DISPLAY_TZ }) === key;
    }).length;

    result.push({
      date:    d,
      label:   d.toLocaleDateString("en-AU", { timeZone: DISPLAY_TZ, weekday: "narrow" }),
      count,
      isToday: i === 0
    });
  }

  return result;
}


// ── SYNC RATE ──
// Returns % of days where both users logged within 2hrs of each other
export function calcSyncRate(mikeLogs, jennaLogs, tz = "Asia/Makassar") {
  if (!mikeLogs.length || !jennaLogs.length) return 0;

  // Group each user's logs by local date
  const groupByDate = (logs) => {
    const map = {};
    logs.forEach(l => {
      const d = l.timestamp?.toDate();
      if (!d) return;
      const key = d.toLocaleDateString("en-CA", { timeZone: tz });
      if (!map[key]) map[key] = [];
      map[key].push(d);
    });
    return map;
  };

  const mikeByDay  = groupByDate(mikeLogs);
  const jennaByDay = groupByDate(jennaLogs);

  const allDays = new Set([...Object.keys(mikeByDay), ...Object.keys(jennaByDay)]);
  let syncDays  = 0;

  allDays.forEach(day => {
    const md = mikeByDay[day]  || [];
    const jd = jennaByDay[day] || [];
    if (!md.length || !jd.length) return;

    // Check if any Mike log is within 2hrs of any Jenna log
    const synced = md.some(m =>
      jd.some(j => Math.abs(m - j) <= 2 * 60 * 60 * 1000)
    );
    if (synced) syncDays++;
  });

  const sharedDays = [...allDays].filter(d => mikeByDay[d] && jennaByDay[d]).length;
  if (sharedDays === 0) return 0;
  return Math.round((syncDays / sharedDays) * 100);
}


// ── STORY GENERATOR ──
export function generateStory(mikeStats, jennaStats, syncRate, period) {
  const sentences = [];

  const periodWord = {
    today: "today",
    week:  "this week",
    month: "this month",
    year:  "this year",
    all:   "overall"
  }[period] || "this period";

  const periodSpan = {
    today: "day",
    week:  "week",
    month: "month",
    year:  "year",
    all:   "overall"
  }[period] || "period";

  const describe = (s) => {
    if (s.total === 0)              return `didn't log ${periodWord}`;
    if (s.consistencyPct >= 80)    return `had an excellent ${periodSpan} gut-wise`;
    if (s.consistencyPct >= 60)    return `had a solid ${periodSpan}`;
    if (s.consistencyPct >= 40)    return `had a decent ${periodSpan}`;
    if (s.hardCount >= Math.max(3, s.total * 0.3))
                                   return `had a tough ${periodSpan} with hard stools`;
    if (s.looseCount >= Math.max(3, s.total * 0.3))
                                   return `had a rough ${periodSpan} with loose stools`;
    return `had a mixed ${periodSpan}`;
  };

  // Sentence 1 — Mike
  const mikeLogsWord = `${mikeStats.total} time${mikeStats.total !== 1 ? "s" : ""}`;
  sentences.push(
    mikeStats.total === 0
      ? `Mike didn't log ${periodWord}.`
      : `Mike logged ${mikeLogsWord} ${periodWord} and ${describe(mikeStats)}.`
  );

  // Sentence 2 — Jenna
  const jennaLogsWord = `${jennaStats.total} time${jennaStats.total !== 1 ? "s" : ""}`;
  sentences.push(
    jennaStats.total === 0
      ? `Jenna didn't log ${periodWord}.`
      : `Jenna logged ${jennaLogsWord} and ${describe(jennaStats)}.`
  );

  // Sentence 3 — Specific health observation (scaled to period)
  const hardThreshold  = period === "today" ? 1 : period === "week" ? 2 : 3;
  const looseThreshold = period === "today" ? 1 : period === "week" ? 2 : 3;

  if (mikeStats.hardCount >= hardThreshold) {
    sentences.push(`Mike had ${mikeStats.hardCount} hard stool${mikeStats.hardCount > 1 ? "s" : ""} — more water and fibre could help.`);
  } else if (jennaStats.hardCount >= hardThreshold) {
    sentences.push(`Jenna had ${jennaStats.hardCount} hard stool${jennaStats.hardCount > 1 ? "s" : ""} — remind her to stay hydrated.`);
  } else if (mikeStats.looseCount >= looseThreshold) {
    sentences.push(`Mike had ${mikeStats.looseCount} loose stool${mikeStats.looseCount > 1 ? "s" : ""} — worth watching diet and stress.`);
  } else if (jennaStats.looseCount >= looseThreshold) {
    sentences.push(`Jenna had ${jennaStats.looseCount} loose stool${jennaStats.looseCount > 1 ? "s" : ""} — check for food triggers.`);
  }

  // Sentence 4 — Sync (skip for "today")
  if (period !== "today" && mikeStats.total > 0 && jennaStats.total > 0) {
    if (syncRate >= 60) {
      sentences.push(`You two were in sync ${syncRate}% of shared days — gut twins! 👯`);
    } else if (syncRate >= 30) {
      sentences.push(`Your schedules overlapped on ${syncRate}% of shared days.`);
    } else if (syncRate > 0) {
      sentences.push(`You were on pretty different schedules ${periodWord} (${syncRate}% sync).`);
    }
  }

  // Sentence 5 — Closing
  const bothGood = mikeStats.consistencyPct >= 60 && jennaStats.consistencyPct >= 60 && mikeStats.total > 0 && jennaStats.total > 0;
  const bothBad  = mikeStats.total > 0 && jennaStats.total > 0 && mikeStats.consistencyPct < 40 && jennaStats.consistencyPct < 40;
  const neitherLogged = mikeStats.total === 0 && jennaStats.total === 0;

  if (neitherLogged) {
    sentences.push(`No logs ${periodWord}. Start logging via the bot! 💩`);
  } else if (bothGood) {
    sentences.push(`Both doing well — keep it up! 💚`);
  } else if (bothBad) {
    sentences.push(`Both could use more water, fibre, and movement ${periodWord}. 💧`);
  }

  return sentences.join(" ");
}
