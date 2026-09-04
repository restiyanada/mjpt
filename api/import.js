// ============================================================
// MJPT — CSV Importer
// One-time import of historical data from Poopie app export.
// Access: /api/import?key=ADMIN_KEY
// POST with { user: "mike"|"jenna", csv: "...raw csv string..." }
// ============================================================

const { db }   = require("./lib/firebase");
const { Timestamp } = require("firebase-admin/firestore");
const { safeEquals } = require("./lib/auth");


// ── COMPOSITION → BRISTOL TYPE ──
const COMPOSITION_MAP = {
  PELLET:   1,  // Type 1 — hard separate lumps
  ROCK:     2,  // Type 2 — lumpy sausage
  CRACKLE:  3,  // Type 3 — sausage with cracks
  SOFT:     4,  // Type 4 — smooth snake (ideal)
  BLOB:     5,  // Type 5 — soft blobs
  MUSH:     6,  // Type 6 — fluffy/mushy
  LIQUID:   7   // Type 7 — watery
};


// ── VOLUME MAP ──
const VOLUME_MAP = {
  CHILD_SIZE: "child_size",
  SMALL:      "small",
  NORMAL:     "normal",
  HUGE:       "huge",
  GIGANTIC:   "gigantic"
};
const HUE_MAP = {
  BROWN:  "brown",
  RED:    "red",
  BLACK:  "black",
  GREEN:  "green",
  YELLOW: "yellow"
};


// ── CONDITIONS → SYMPTOMS ──
const CONDITIONS_MAP = {
  CRAMPY:        "cramps",
  BURNING:       "cramps",   // map to cramps (closest)
  LACTOSE:       "bloating",
  ANXIETY:       null,       // skip — not a physical symptom
  SMELLY:        null,       // skip
  STICKY:        null,       // skip
  BLOCKAGE:      "cramps",
  HOLY_SHIT:     null,       // skip
  FLOATING:      null,       // skip
  POSEIDON_KISS: null,       // skip
  NUCLEAR_BURST: "cramps",
  DOUBLE_FLUSH:  null,       // skip
  AFTER_COFFEE:  null,       // skip
  BLOOD:         "blood"
};


// ── PARSE CSV ──
function parseCSV(raw) {
  const lines = raw.trim().split("\n");

  // Skip first line (export metadata) and second line (headers)
  const dataLines = lines.slice(2);

  return dataLines.map(line => {
    // Handle quoted fields with commas inside
    const fields = [];
    let current  = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === "," && !inQuotes) {
        fields.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    fields.push(current.trim());

    const [startDate, duration, name, volumeRaw, composition, hue, conditions, description] = fields;

    // Parse timestamp
    const ts = new Date(startDate);

    // Map composition to Bristol type
    const bristolType = COMPOSITION_MAP[composition?.trim()] || 4;

    // Map volume
    const volume = VOLUME_MAP[volumeRaw?.trim()] || "normal";

    // Map hue to color
    const color = HUE_MAP[hue?.trim()] || "brown";

    // Map conditions to symptoms
    let symptoms = ["none"];
    if (conditions && conditions.trim()) {
      const condList = conditions.split(",").map(c => c.trim());
      const mapped   = condList
        .map(c => CONDITIONS_MAP[c])
        .filter(s => s !== null && s !== undefined);
      const unique   = [...new Set(mapped)];
      if (unique.length > 0) symptoms = unique;
    }

    // Build notes from name + description
    const noteParts = [];
    if (name && name.trim())        noteParts.push(name.trim());
    if (description && description.trim()) noteParts.push(description.trim());
    const notes = noteParts.join(" — ");

    return {
      timestamp:   Timestamp.fromDate(ts),
      bristolType,
      color,
      volume,
      symptoms,
      notes,
      source:      "import",
      quick:       false,
      originalName: name?.trim() || ""
    };
  }).filter(entry => !isNaN(entry.timestamp.toDate().getTime())); // Filter invalid dates
}


// ── HANDLER ──
module.exports = async (req, res) => {
  // Gate with admin key
  const key = req.query.key;
  if (!safeEquals(key, process.env.ADMIN_KEY)) {
    return res.status(404).send("Not found");
  }

  // GET — serve import UI
  if (req.method === "GET") {
    res.setHeader("Content-Type", "text/html");
    return res.send(importHTML(key));
  }

  // POST — process import
  if (req.method === "POST") {
    const { user, csv, preview } = req.body;

    if (!user || !["mike", "jenna"].includes(user)) {
      return res.status(400).json({ error: "Invalid user. Must be mike or jenna." });
    }

    if (!csv || !csv.trim()) {
      return res.status(400).json({ error: "No CSV data provided." });
    }

    try {
      const entries = parseCSV(csv);

      if (entries.length === 0) {
        return res.status(400).json({ error: "No valid entries found in CSV." });
      }

      if (preview) {
        return res.json({
          ok:      true,
          user,
          preview: true,
          count:   entries.length,
          sample:  entries.slice(0, 3).map(e => ({
            date:        e.timestamp.toDate().toISOString(),
            bristolType: e.bristolType,
            color:       e.color,
            symptoms:    e.symptoms,
            notes:       e.notes
          }))
        });
      }

      // Write in batches of 500 (Firestore limit)
      const BATCH_SIZE = 500;
      let imported = 0;

      for (let i = 0; i < entries.length; i += BATCH_SIZE) {
        const batch = db.batch();
        const chunk = entries.slice(i, i + BATCH_SIZE);

        chunk.forEach(entry => {
          const ref = db.collection("logs").doc();
          batch.set(ref, { ...entry, user });
        });

        await batch.commit();
        imported += chunk.length;
      }

      return res.json({
        ok:       true,
        user,
        imported,
        sample:   entries.slice(0, 3).map(e => ({
          date:        e.timestamp.toDate().toISOString(),
          bristolType: e.bristolType,
          color:       e.color,
          symptoms:    e.symptoms,
          notes:       e.notes
        }))
      });

    } catch (err) {
      console.error("Import error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(405).json({ error: "Method not allowed" });
};


// ── IMPORT UI ──
function importHTML(key) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>mjpt — CSV Import</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: monospace; background: #1a1208; color: #e8d8c8; padding: 32px; min-height: 100vh; }
    h1 { font-size: 24px; margin-bottom: 4px; }
    .sub { color: #7a6a58; font-size: 12px; margin-bottom: 32px; }
    .section { margin-bottom: 24px; }
    label { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: #7a6a58; margin-bottom: 8px; }
    select, textarea {
      width: 100%; background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.12); border-radius: 8px;
      color: white; padding: 12px; font-family: monospace; font-size: 12px;
    }
    textarea { height: 200px; resize: vertical; }
    .btn {
      background: #c05a30; color: white; border: none;
      padding: 12px 24px; border-radius: 8px; font-family: monospace;
      font-size: 14px; cursor: pointer; margin-right: 8px;
    }
    .btn:hover { opacity: 0.85; }
    .btn.secondary { background: rgba(255,255,255,0.08); }
    #output {
      background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1);
      border-radius: 10px; padding: 16px; font-size: 12px; line-height: 1.6;
      min-height: 80px; margin-top: 16px; white-space: pre-wrap;
      word-break: break-all; color: #b8a888;
    }
    .warning {
      background: rgba(200,96,48,0.15); border: 1px solid rgba(200,96,48,0.3);
      border-radius: 8px; padding: 12px 16px; margin-bottom: 24px;
      font-size: 12px; color: #f0a882; line-height: 1.6;
    }
    input[type="file"] { color: #e8d8c8; font-family: monospace; font-size: 12px; }
  </style>
</head>
<body>
  <h1>mjpt — CSV Import</h1>
  <div class="sub">One-time historical data import from Poopie app</div>

  <div class="warning">
    ⚠️ This will permanently add data to Firestore. Run once per user.<br>
    Make sure to import Mike's file for Mike and Jenna's file for Jenna.
  </div>

  <div class="section">
    <label>User</label>
    <select id="userSelect">
      <option value="mike">Mike</option>
      <option value="jenna">Jenna</option>
    </select>
  </div>

  <div class="section">
    <label>CSV File</label>
    <input type="file" id="fileInput" accept=".csv" onchange="loadFile(this)">
  </div>

  <div class="section">
    <label>CSV Content (auto-filled from file, or paste manually)</label>
    <textarea id="csvContent" placeholder="Paste CSV content here or upload file above..."></textarea>
  </div>

  <button class="btn secondary" onclick="preview()">Preview first 3 rows</button>
  <button class="btn" onclick="importData()">Import to Firestore</button>

  <div id="output">Output will appear here...</div>

  <script>
    const KEY = "${key}";

    function loadFile(input) {
      const file   = input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = e => {
        document.getElementById("csvContent").value = e.target.result;
        document.getElementById("output").textContent = "File loaded: " + file.name + " (" + e.target.result.split("\\n").length + " lines)";
      };
      reader.readAsText(file);
    }

    async function preview() {
      const user = document.getElementById("userSelect").value;
      const csv  = document.getElementById("csvContent").value;
      const out  = document.getElementById("output");

      if (!csv.trim()) { out.textContent = "No CSV content to preview."; return; }

      out.textContent = "Previewing...";

      try {
        const res  = await fetch("/api/import?key=" + KEY + "&preview=1", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ user, csv, preview: true })
        });
        const data = await res.json();
        out.textContent = JSON.stringify(data, null, 2);
      } catch (err) {
        out.textContent = "Error: " + err.message;
      }
    }

    async function importData() {
      const user = document.getElementById("userSelect").value;
      const csv  = document.getElementById("csvContent").value;
      const out  = document.getElementById("output");

      if (!csv.trim()) { out.textContent = "No CSV content to import."; return; }
      if (!confirm("Import CSV data for " + user + "? This cannot be undone.")) return;

      out.textContent = "Importing...";

      try {
        const res  = await fetch("/api/import?key=" + KEY, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ user, csv })
        });
        const data = await res.json();
        out.textContent = JSON.stringify(data, null, 2);
      } catch (err) {
        out.textContent = "Error: " + err.message;
      }
    }
  </script>
</body>
</html>`;
}
