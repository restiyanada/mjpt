// ============================================================
// MJPT — Telegram Webhook
// Receives all messages from Telegram and processes them.
// Deployed as a Vercel serverless function.
// ============================================================

const { db, BOT, API } = require("./lib/firebase");
const { Timestamp } = require("firebase-admin/firestore");
const { escapeMarkdown } = require("./lib/escape");
const { safeEquals } = require("./lib/auth");

// ── FIREBASE ADMIN INIT (see api/lib/firebase.js) ──

// ── BRISTOL INFO ──
const BRISTOL = {
  1: { label: "Pellet",  desc: "Separate hard lumps — severe constipation" },
  2: { label: "Rock",    desc: "Lumpy, hard, difficult to pass" },
  3: { label: "Crackle", desc: "Sausage with cracks — mostly normal" },
  4: { label: "Soft",    desc: "Smooth, easy to pass — ideal!" },
  5: { label: "Blob",    desc: "Soft blobs — lacking fibre" },
  6: { label: "Mush",    desc: "Fluffy, mushy — mild diarrhea" },
  7: { label: "Liquid",  desc: "Watery — severe diarrhea" }
};

const COLORS = ["brown", "dark_brown", "yellow", "green", "red", "black", "pale"];
const SYMPTOMS = ["none", "bloating", "urgency", "cramps", "blood"];

const VOLUME_LABELS = {
  child_size: "Child Size",
  small:      "Small",
  normal:     "Normal",
  huge:       "Huge",
  gigantic:   "Gigantic"
};

function formatVolume(v) {
  return VOLUME_LABELS[v] || "Normal";
}

const { getTodayStr, formatLocalDate } = require("./lib/time");

// ── CONVERSATION STATE (Firestore-backed — survives serverless cold starts) ──
const sessions = {}; // local cache within same invocation only

async function getSession(chatId) {
  // Check local cache first
  if (sessions[chatId]) return sessions[chatId];
  // Fall back to Firestore
  try {
    const snap = await db.collection("sessions").doc(String(chatId)).get();
    if (snap.exists) {
      const data = snap.data();
      // Expire sessions older than 30 minutes
      const age = Date.now() - (data.updatedAt || 0);
      if (age < 30 * 60 * 1000) {
        sessions[chatId] = data;
        return data;
      }
      // Expired — delete it
      await db.collection("sessions").doc(String(chatId)).delete();
    }
  } catch (err) {
    console.error("getSession error:", err);
  }
  return null;
}

async function setSession(chatId, session) {
  session.updatedAt = Date.now();
  sessions[chatId] = session;
  try {
    await db.collection("sessions").doc(String(chatId)).set(session);
  } catch (err) {
    console.error("setSession error:", err);
  }
}

async function deleteSession(chatId) {
  delete sessions[chatId];
  try {
    await db.collection("sessions").doc(String(chatId)).delete();
  } catch (err) {
    console.error("deleteSession error:", err);
  }
}




// ── MESSAGE HANDLER ──
async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const text   = (msg.text || "").trim();

  console.log(`MSG from ${chatId}: ${text}`);

  // Identify user
  const user = await getUserByChatId(chatId);
  console.log(`User found:`, user ? user.id : "none");

  if (text.startsWith("/start")) {
    console.log("Handling /start");
    await handleStart(chatId, user);
    return;
  }

  if (!user) {
    await sendMsg(chatId, "I don't know who you are yet. Send /start to register.");
    return;
  }

  if (text.startsWith("/quick") || text === "q") {
    await handleQuickLog(chatId, user);
    return;
  }

  if (text.startsWith("/log") || text === "l") {
    await handleLogStart(chatId, user);
    return;
  }

  if (text.startsWith("/history") || text === "/h") {
    await handleHistory(chatId, user);
    return;
  }

  if (text.startsWith("/preset")) {
    await handlePreset(chatId, user);
    return;
  }

  if (text.startsWith("/help")) {
    await handleHelp(chatId, user);
    return;
  }

  if (text.startsWith("/check") || text === "c") {
    await handleCheck(chatId, user);
    return;
  }

  // Handle conversation state
  const session = await getSession(chatId);
  if (session) {
    await handleConversation(chatId, user, text, session, msg);
    return;
  }

  await handleHelp(chatId, user);
}


// ── /start ──
async function handleStart(chatId, existingUser) {
  console.log("handleStart called, existingUser:", existingUser?.id);
  if (existingUser) {
    await sendMsg(chatId, `Welcome back, ${existingUser.name}! 👋\n\nUse /quick to log fast or /log for full entry.`);
    return;
  }

  console.log("Sending registration message to:", chatId);
  const result = await sendMsg(chatId, "Hey! Welcome to mjpt 💩\n\nWho are you?", [
    [
      { text: "Mike",  callback_data: "register:mike"  },
      { text: "Jenna", callback_data: "register:jenna" }
    ]
  ]);
  console.log("sendMsg result:", JSON.stringify(result));
}


// ── /quick ──
async function handleQuickLog(chatId, user) {
  const preset = await getUserPreset(user.id);

  const logEntry = {
    user:        user.id,
    bristolType: parseInt(preset.bristolType) || 4,
    color:       preset.color    || "brown",
    volume:      preset.volume   || "normal",
    symptoms:    preset.symptoms || ["none"],
    notes:       "",
    quick:       true,
    source:      "telegram",
    timestamp:   Timestamp.now()
  };

  await db.collection("logs").add(logEntry);

  const b   = BRISTOL[parseInt(preset.bristolType)] || BRISTOL[4];
  const vol = formatVolume(preset.volume || "normal");
  await sendMsg(chatId,
    `*Logged!* ${b.label}\n\n${vol} · ${preset.color?.replace(/_/g," ") || "brown"} · No symptoms\n\n_Use /log for a full entry_`,
    null, { parse_mode: "Markdown" }
  );
}


// ── /log — start guided flow ──
async function handleLogStart(chatId, user) {
  const session = { step: "bristol", data: { user: user.id, source: "telegram", quick: false } };
  await setSession(chatId, session);

  await sendMsg(chatId, `Full Log Entry\n\nWhat's the Bristol type?`, {
    inline_keyboard: [
      [
        { text: "1 — Hard lumps",     callback_data: "log:bristol:1" },
        { text: "2 — Lumpy sausage",  callback_data: "log:bristol:2" }
      ],
      [
        { text: "3 — Cracked sausage", callback_data: "log:bristol:3" },
        { text: "4 — Smooth (ideal)",  callback_data: "log:bristol:4" }
      ],
      [
        { text: "5 — Soft blobs",    callback_data: "log:bristol:5" },
        { text: "6 — Fluffy pieces", callback_data: "log:bristol:6" }
      ],
      [
        { text: "7 — Watery", callback_data: "log:bristol:7" }
      ]
    ]
  }, { parse_mode: "Markdown" });
}


// ── CALLBACK HANDLER ──
async function handleCallback(cb) {
  const chatId = cb.message.chat.id;
  const data   = cb.data;
  const msgId  = cb.message.message_id;
  const user   = await getUserByChatId(chatId);

  // Acknowledge callback
  await fetch(`${API}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: cb.id })
  });

  // Registration
  if (data.startsWith("register:")) {
    const userId = data.split(":")[1];
    if (!["mike", "jenna"].includes(userId)) return;
    await registerUser(chatId, userId, cb.from);
    const name = userId === "mike" ? "Mike" : "Jenna";
    await editMsg(chatId, msgId, `You're all set, ${name}! 🎉\n\nCommands:\n/quick — instant log\n/log — full entry\n/history — recent logs\n/preset — update defaults`);
    return;
  }

  // Logging flow
  if (data.startsWith("log:")) {
    const parts = data.split(":");
    const field = parts[1];
    const value = parts[2];

    // Reminder button shortcuts
    if (field === "quick") {
      await handleQuickLog(chatId, user);
      return;
    }
    if (field === "full") {
      await handleLogStart(chatId, user);
      return;
    }
    if (field === "skip") {
      await editMsg(chatId, msgId, "No worries! Don't forget to log later. 👋");
      return;
    }

    await handleLogCallback(chatId, msgId, user, field, value);
    return;
  }

  // Preset flow
  if (data.startsWith("preset:")) {
    const parts = data.split(":");
    const field = parts[1];
    const value = parts[2];
    await handlePresetCallback(chatId, msgId, user, field, value);
    return;
  }
}


// ── LOG CALLBACK FLOW ──
async function handleLogCallback(chatId, msgId, user, field, value) {
  let session = await getSession(chatId);
  if (!session) {
    session = { step: field, data: { user: user?.id, source: "telegram", quick: false } };
  }
  await setSession(chatId, session);

  if (field === "bristol") {
    session.data.bristolType = parseInt(value);
    session.step = "color";

    await replyMsg(chatId, msgId, `Type ${value} selected.\n\nWhat color?`, {
      inline_keyboard: [
        [
          { text: "Brown",      callback_data: "log:color:brown"      },
          { text: "Dark brown", callback_data: "log:color:dark_brown" },
          { text: "Yellow",     callback_data: "log:color:yellow"     }
        ],
        [
          { text: "Green",     callback_data: "log:color:green" },
          { text: "Red",       callback_data: "log:color:red"   },
          { text: "Black",     callback_data: "log:color:black" },
          { text: "Pale/clay", callback_data: "log:color:pale"  }
        ]
      ]
    });
    await setSession(chatId, session);
    return;
  }

  if (field === "color") {
    session.data.color = value;
    session.step = "volume";

    await replyMsg(chatId, msgId, `${value} noted.\n\nWhat's the volume?`, {
      inline_keyboard: [
        [
          { text: "Child Size", callback_data: "log:volume:child_size" },
          { text: "Small",      callback_data: "log:volume:small"      }
        ],
        [
          { text: "Normal",  callback_data: "log:volume:normal"  },
          { text: "Huge",    callback_data: "log:volume:huge"    }
        ],
        [
          { text: "Gigantic", callback_data: "log:volume:gigantic" }
        ]
      ]
    });
    await setSession(chatId, session);
    return;
  }

  if (field === "volume") {
    session.data.volume = value;
    session.step = "symptoms";

    await replyMsg(chatId, msgId, `Got it.\n\nAny symptoms? (tap all that apply, then Done)`, {
      inline_keyboard: [
        [
          { text: "None",     callback_data: "log:symptoms:none"     },
          { text: "Bloating", callback_data: "log:symptoms:bloating" }
        ],
        [
          { text: "Urgency", callback_data: "log:symptoms:urgency" },
          { text: "Cramps",  callback_data: "log:symptoms:cramps"  }
        ],
        [
          { text: "Blood",   callback_data: "log:symptoms:blood" },
          { text: "Done",    callback_data: "log:done:done"       }
        ]
      ]
    });

    session.data.symptoms = [];
    await setSession(chatId, session);
    return;
  }

  if (field === "symptoms") {
    if (value === "none") {
      session.data.symptoms = ["none"];
    } else {
      session.data.symptoms = session.data.symptoms || [];
      if (!session.data.symptoms.includes(value)) {
        session.data.symptoms.push(value);
      }
      session.data.symptoms = session.data.symptoms.filter(s => s !== "none");
    }
    // Don't advance — let user tap Done
    await setSession(chatId, session);
    return;
  }

  if (field === "done") {
    if (!session.data.symptoms || session.data.symptoms.length === 0) {
      session.data.symptoms = ["none"];
    }
    session.step = "when";

    await replyMsg(chatId, msgId,
      `Got it! When was this?`, {
      inline_keyboard: [[
        { text: "Right now",  callback_data: "log:when:now"       },
        { text: "Yesterday",  callback_data: "log:when:yesterday" }
      ]]
    });
    await setSession(chatId, session);
    return;
  }

  if (field === "when") {
    if (value === "now") {
      session.data.backdated = false;
      session.step = "notes";
      await replyMsg(chatId, msgId,
        `Any notes? (Reply with text, or tap Skip)`, {
        inline_keyboard: [[{ text: "Skip", callback_data: "log:notes:skip" }]]
      });
    } else {
      // Yesterday — ask for time
      session.data.backdated = true;
      session.step = "time";
      await replyMsg(chatId, msgId,
        `What time yesterday? (HH:MM, 24hr — e.g. 08:30 or 21:00)`, {
        inline_keyboard: [[{ text: "Skip (use midnight)", callback_data: "log:time:00:00" }]]
      });
    }
    await setSession(chatId, session);
    return;
  }

  if (field === "time") {
    const timeParts = value.split(":");
    const hh = parseInt(timeParts[0]) || 0;
    const mm = parseInt(timeParts[1]) || 0;

    const tz        = session.data.user === "mike" ? "Australia/Melbourne" : "Asia/Makassar";
    const nowLocal  = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
    const yesterday = new Date(nowLocal);
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(hh, mm, 0, 0);

    const utcOffset = new Date().getTime() - new Date(new Date().toLocaleString("en-US", { timeZone: tz })).getTime();
    const utcDate   = new Date(yesterday.getTime() + utcOffset);
    session.data.backdatedTimestamp = utcDate;
    session.step = "notes";

    const timeStr   = `${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}`;
    const replyText = `Got it — logging for yesterday at ${timeStr}.\n\nAny notes? (Reply with text, or tap Skip)`;
    const keyboard  = [[{ text: "Skip", callback_data: "log:notes:skip" }]];

    if (msgId) {
      await replyMsg(chatId, msgId, replyText, keyboard);
    } else {
      await sendMsg(chatId, replyText, keyboard);
    }

    await setSession(chatId, session);
    return;
  }

  if (field === "notes") {
    session.data.notes = value === "skip" ? "" : value;
    await saveLog(chatId, session.data, msgId);
    return;
  }
}


// ── SAVE LOG ──
async function saveLog(chatId, data, msgId, replyToMsgId = null) {
  if (data.backdatedTimestamp) {
    data.timestamp = Timestamp.fromDate(data.backdatedTimestamp);
    delete data.backdatedTimestamp;
    delete data.backdated;
  } else {
    data.timestamp = Timestamp.now();
  }

  data.notes       = data.notes    || "";
  data.symptoms    = data.symptoms || ["none"];
  data.color       = data.color    || "brown";
  data.volume      = data.volume   || "normal";
  data.bristolType = parseInt(data.bristolType) || 4;

  try {
    // Gather context BEFORE saving so daysSince is accurate
    const tz        = data.user === "mike" ? "Australia/Melbourne" : "Asia/Makassar";
    const localHour = getLocalHour(new Date(), tz);
    const streak    = await getStreak(data.user, tz);
    const daysSince = await getDaysSinceLastLog(data.user, tz);
    const logsToday = await countLoggedToday(data.user, tz);

    await db.collection("logs").add(data);

    const msg = buildConfirmationMsg({
      data, localHour, streak, daysSince, logsToday
    });

    if (msgId) {
      await editMsg(chatId, msgId, msg, null, { parse_mode: "Markdown" });
    } else if (replyToMsgId) {
      await sendMsg(chatId, msg, null, { parse_mode: "Markdown", reply_to_message_id: replyToMsgId });
    } else {
      await sendMsg(chatId, msg, null, { parse_mode: "Markdown" });
    }

    await notifyPartner(data.user, data.bristolType, data.volume, data.symptoms, localHour, logsToday);

  } catch (err) {
    console.error(err);
    await sendMsg(chatId, "Failed to save log. Try again.");
  }

  await deleteSession(chatId);
}


// ── BUILD CONFIRMATION MESSAGE ──
function buildConfirmationMsg({ data, localHour, streak, daysSince, logsToday }) {
  const b          = BRISTOL[data.bristolType] || BRISTOL[4];
  const vol        = formatVolume(data.volume);
  const color      = data.color.replace(/_/g, " ");
  const t          = data.bristolType;
  const syms       = data.symptoms || ["none"];
  const hasCramps  = syms.includes("cramps");
  const hasBloat   = syms.includes("bloating");
  const hasUrgency = syms.includes("urgency");
  const hasBlood   = syms.includes("blood");
  const hasSymp    = !syms.includes("none") && syms.length > 0;
  const isHard     = t <= 2;
  const isSoft     = t === 4;
  const isLoose    = t >= 6;
  const isCrackle  = t === 3;
  const isBlob     = t === 5;
  const isGig      = data.volume === "gigantic";
  const isHuge     = data.volume === "huge";
  const isSmall    = data.volume === "child_size" || data.volume === "small";

  const timeWord = getTimeWord(localHour);

  // ── BLOCK 1: opener line + flowing observation ──
  const obs = buildObs({ t, b, isHard, isSoft, isLoose, isCrackle, isBlob,
    hasSymp, hasCramps, hasBloat, hasUrgency, hasBlood, isGig, isHuge, isSmall, vol, color, data });

  const block1 = obs
    ? `${timeWord} — ${b.label}, ${vol}, ${color}.\n\n${obs}`
    : `${timeWord} — ${b.label}, ${vol}, ${color}.`;

  // ── BLOCK 2: gap / repeat / streak / notes woven together ──
  const b2 = [];

  // Gap or repeat
  if (daysSince >= 5) {
    b2.push(pick([
      `It has been ${daysSince} days since your last log. Glad you are back.`,
      `${daysSince} days — your gut was clearly taking its time. Welcome back.`,
      `Back after ${daysSince} days. Hope everything came out alright.`,
      `${daysSince} days is a while. Better late than never.`
    ]));
  } else if (daysSince >= 3) {
    b2.push(pick([
      `Been ${daysSince} days since the last one — your gut was clearly building up to this.`,
      `${daysSince} days between logs, so that one was probably a long time coming.`,
      `Back at it after ${daysSince} days. Hope that cleared things up.`,
      `Your gut had ${daysSince} days to think about this. How does it feel now?`
    ]));
  } else if (logsToday >= 4) {
    b2.push(pick([
      `That is ${logsToday + 1} today. Your gut is really making itself known.`,
      `${logsToday + 1} visits in one day — quite the active gut day you are having.`,
      `Number ${logsToday + 1} today. Everything okay? That is a busy gut.`
    ]));
  } else if (logsToday === 3) {
    b2.push(pick([
      `That is four today. Your gut clearly has a lot going on.`,
      `Fourth visit today — your gut is not done yet apparently.`,
      `Four in one day. Keep an eye on that if it keeps up.`
    ]));
  } else if (logsToday === 2) {
    b2.push(pick([
      `That is three today. Your gut is very vocal right now.`,
      `Third visit today — something is clearly moving.`,
      `Three in one day. Could be something you ate earlier.`,
      `Going three times today — worth noting if this keeps happening.`
    ]));
  } else if (logsToday === 1) {
    b2.push(pick([
      `Second one today — some days are just like that.`,
      `Back again already. Your gut has more to say apparently.`,
      `Two in one day, nothing unusual. Your gut was not quite done earlier.`,
      `Second visit today. Happens to the best of us.`,
      `Your gut had unfinished business from earlier it seems.`
    ]));
  }

  // Streak
  if (streak >= 30) {
    b2.push(pick([
      `${streak} days straight by the way. That is not a streak anymore, that is just who you are now.`,
      `${streak} days of logging in a row. Your gut thanks you for the attention.`,
      `${streak}-day streak. Genuinely impressive commitment.`
    ]));
  } else if (streak >= 14) {
    b2.push(pick([
      `${streak} days in a row. Two weeks of logging — your gut data is looking really solid.`,
      `${streak}-day streak. That kind of consistency actually matters.`,
      `Two weeks straight. You are building something useful here.`
    ]));
  } else if (streak >= 7) {
    b2.push(pick([
      `${streak} days in a row. A full week — that is worth something.`,
      `${streak}-day streak. One week of consistent logging. Keep it going.`,
      `Seven days straight. Your gut appreciates the attention.`
    ]));
  } else if (streak >= 5) {
    b2.push(pick([
      `${streak} days in a row. The habit is forming.`,
      `${streak}-day streak. You are on a roll, do not stop now.`,
      `Five days straight. Something is clicking — keep going.`
    ]));
  } else if (streak >= 3) {
    b2.push(pick([
      `${streak} days in a row by the way. Small streak but it counts.`,
      `Three days straight. The habit is starting to form.`,
      `${streak} days running. Your gut is getting properly tracked.`
    ]));
  }

  // Notes — woven in last, seamlessly
  if (data.notes) {
    const note = escapeMarkdown(
      data.notes.trim().charAt(0).toLowerCase() + data.notes.trim().slice(1).replace(/\.$/, "")
    );
    b2.push(pick([
      `You also mentioned that ${note}.`,
      `Worth noting — ${note}.`,
      `You added: ${note}.`
    ]));
  }

  const block2 = b2.join(" ");
  return block2 ? `${block1}\n\n${block2}` : block1;
}


// ── OBSERVATION PARAGRAPH ──
function buildObs({ t, b, isHard, isSoft, isLoose, isCrackle, isBlob,
  hasSymp, hasCramps, hasBloat, hasUrgency, hasBlood, isGig, isHuge, isSmall, vol, color, data }) {

  // Blood — always serious, always standalone
  if (hasBlood) {
    return pick([
      "You flagged blood. If that keeps happening, please see a doctor — do not put it off.",
      "Blood was logged. Could be nothing, could be something. See a doctor if it shows up again.",
      "You noted blood. Take that seriously — worth getting checked if it repeats."
    ]);
  }

  // Hard + cramps
  if (isHard && hasCramps) {
    return pick([
      `Came out hard with cramps on top — your gut was really struggling with that one. Drink a lot of water today and try some warm food tonight, it should ease things up.`,
      `Hard and crampy — that is a rough combination. Your gut needs more hydration and probably some gentle movement. Take it easy today.`,
      `Came out as a ${b.label} and it brought cramps along. That means your gut has been working too hard. More water, less processed food, and a short walk if you can manage it.`,
      `That one came out hard and painful. Drink water now, eat something warm later, and try not to force anything next time — let it come naturally.`
    ]);
  }

  // Hard + bloating
  if (isHard && hasBloat) {
    return pick([
      `Came out hard with some bloating — double trouble for your gut today. More water and skip the dairy if you can.`,
      `Hard stool and bloating together usually means dehydration and something irritating your gut. Water and lighter food should help.`,
      `Came out as a ${b.label} and you are feeling bloated too. Your gut wants more fluids and probably less of whatever you had yesterday.`
    ]);
  }

  // Hard only
  if (isHard) {
    const sizeNote = isGig || isHuge
      ? " Impressive effort given how hard it was though."
      : isSmall ? " Small volume too — your gut did not have much to work with." : "";
    return pick([
      `Came out hard — classic sign your gut needs more water.${sizeNote} Drink a full glass now and try to get more fibre in today before the next one gets worse.`,
      `Came out as a ${b.label} which means your gut is moving too slowly. Water, fruit, and a short walk are your best tools right now.${sizeNote}`,
      `Hard one today.${sizeNote} Your gut is telling you it needs more hydration. Drink water, eat something fibrous, and try to move around a bit.`,
      `That came out harder than it should.${sizeNote} More water today — your gut was clearly not happy with how things have been going.`
    ]);
  }

  // Loose + cramps + bloating
  if (isLoose && hasCramps && hasBloat) {
    return pick([
      `Came out loose with cramps and bloating — your gut is really not happy right now. Keep food plain and light today, drink plenty of fluids, and rest if you can.`,
      `Loose, crampy, and bloated all at once — that is a rough gut day. Your body needs rest, fluids, and nothing heavy. Take it easy.`,
      `That is a lot going on at once — ${b.label} with cramps and bloating. Something clearly irritated your gut. Bland food, lots of water, and let it settle.`
    ]);
  }

  // Loose + cramps
  if (isLoose && hasCramps) {
    return pick([
      `Came out loose and with cramps — your gut is having a hard time right now. Rest up, drink fluids, and keep food plain today.`,
      `${b.label} with cramps is uncomfortable. Something is irritating your gut — light food, plenty of water, and take it easy.`,
      `Came out loose and painful today. Your gut needs a break — avoid heavy food and dairy and see if it settles down.`
    ]);
  }

  // Loose + bloating
  if (isLoose && hasBloat) {
    return pick([
      `Came out loose and you are feeling bloated on top of it. Your gut is unsettled — light food and lots of fluids should help.`,
      `${b.label} with bloating — something is clearly not sitting right. Try cutting dairy for today and see if it helps.`,
      `Loose and bloated is a sign your gut is reacting to something. Keep an eye on what you eat and drink plenty of water.`
    ]);
  }

  // Loose only
  if (isLoose) {
    return pick([
      `Came out loose today — could be stress, something you ate, or just your gut having a moment. Stay hydrated and keep food plain for now.`,
      `Running ${b.label.toLowerCase()} which means your gut is moving faster than it should. Drink plenty of fluids, rest if you can, and avoid heavy food.`,
      `Came out loose. Your gut needs some recovery time today — electrolytes, bland food, and take it easy. Should settle down.`,
      `${b.label} today. Something triggered your gut — could be diet, stress, or just a bad day. Rest and fluids are the move right now.`
    ]);
  }

  // Ideal + cramps
  if (isSoft && hasCramps) {
    return pick([
      `Came out clean and smooth which is great, but the cramps are worth paying attention to. A warm compress or peppermint tea might help.`,
      `Good consistency — came out as a clean ${b.label}. The cramping is a bit odd given how well it came out. Could be stress. See how the day goes.`,
      `Came out perfectly but you had cramps with it. That sometimes happens with stress or hormones. Worth noting if it keeps up.`
    ]);
  }

  // Ideal + bloating
  if (isSoft && hasBloat) {
    return pick([
      `Came out clean and smooth — the consistency is perfect. The bloating is probably something you ate. Try skipping dairy today and see if it eases.`,
      `Good drop, came out as a proper ${b.label}. The bloating on top of it might be from something specific — worth thinking about what you had earlier.`,
      `Clean ${b.label} which is exactly right, but feeling bloated afterward. Ginger tea or skipping processed food today might help with that.`
    ]);
  }

  // Ideal + urgency
  if (isSoft && hasUrgency) {
    return pick([
      `Came out clean but with urgency — your gut had its own timeline today. Nothing to worry about as long as it does not keep happening.`,
      `Good consistency, came out as a proper ${b.label}. The urgency just means your gut was in a rush — happens sometimes.`
    ]);
  }

  // Ideal only — no symptoms
  if (isSoft) {
    if (isGig) {
      return pick([
        `Came out perfectly smooth — and that was a big one. Huge volume, clean ${b.label}. Your gut is genuinely thriving right now.`,
        `That was a lot and it came out perfectly clean. Huge volume ${b.label} is about as good as it gets. Your gut is very happy today.`,
        `Came out as a clean ${b.label} and honestly that volume is impressive. Your gut had a lot stored up and handled it perfectly.`
      ]);
    }
    if (isHuge) {
      return pick([
        `Came out clean and smooth — big volume too. Your gut clearly had a lot to get through and handled it really well.`,
        `Clean ${b.label} with a good amount of volume. Your gut is in great shape right now.`,
        `Came out perfectly. ${b.label} is the gold standard and the volume is solid too. Nothing to complain about here.`
      ]);
    }
    if (isSmall) {
      return pick([
        `Came out clean — small volume today but the consistency is perfect. Quality over quantity.`,
        `Small but came out as a clean ${b.label}. Your gut is doing its job properly.`,
        `Came out smooth and clean. Small one today but that is fine — your gut checked in properly.`
      ]);
    }
    return pick([
      `Came out clean and smooth — that is exactly how it should be. Your gut is happy today.`,
      `Came out perfectly. ${b.label} is the gold standard and you hit it. Nothing to change.`,
      `Clean ${b.label}. Smooth, easy, no complaints at all. Your gut is in a really good place right now.`,
      `Came out exactly right today. ${b.label}, no symptoms, clean all the way through. Whatever you have been doing, keep doing it.`,
      `Perfect drop. Came out clean and smooth. Your gut has nothing to complain about today.`,
      `Came out as a proper ${b.label} — smooth, clean, easy. Days like this mean your gut is genuinely happy.`
    ]);
  }

  // Crackle (T3)
  if (isCrackle) {
    if (hasCramps) {
      return pick([
        `Came out a little firm with some cramps — your gut is not totally relaxed today. More water should help.`,
        `Came out as a ${b.label} with cramps. A bit more hydration and something warm should ease it up.`
      ]);
    }
    if (hasBloat) {
      return pick([
        `Came out a little firm and you are feeling bloated. Your gut wants more water and probably less dairy today.`,
        `${b.label} with bloating — close to perfect but not quite there. Drink more today and it should sort itself out.`
      ]);
    }
    return pick([
      `Came out a little firm today — nothing to worry about but one more glass of water and you would have hit that Soft. Close.`,
      `Came out as a ${b.label} — solid result, just a touch on the firm side. A bit more hydration and you will nail it next time.`,
      `Almost perfect today. Came out slightly firm but you are in good shape. Just drink a little more water.`,
      `${b.label} — not quite the gold standard but close. Your gut is doing fine, just needs a bit more fluid.`
    ]);
  }

  // Blob (T5)
  if (isBlob) {
    if (hasCramps || hasBloat) {
      return pick([
        `Came out a little mushy and with ${hasCramps && hasBloat ? "cramps and bloating" : hasCramps ? "cramps" : "bloating"}. Your gut is a bit unsettled today — keep an eye on what you eat.`,
        `Came out soft and mushy with some discomfort. Something is not sitting right. Lighter food and more water today.`
      ]);
    }
    return pick([
      `Came out a little mushy today — slightly softer than ideal but you are in the safe zone. Keep an eye on what you ate.`,
      `Came out as a ${b.label} — a touch softer than perfect but nothing to worry about. Watch the dairy and processed food today.`,
      `Came out soft and mushy which is fine, just not quite ideal. Your gut is a little unsettled but managing.`,
      `Slightly mushier than you want. Not alarming but something might not have agreed with you today.`
    ]);
  }

  // Any symptoms with no specific bristol match
  if (hasSymp) {
    if (hasCramps && hasBloat) {
      return `Came out with cramps and bloating — your gut is clearly not happy right now. Take it easy, eat light, and drink plenty of water today.`;
    }
    if (hasCramps) {
      return pick([
        `Came out with cramps. A warm drink and some rest should help settle that down.`,
        `You had cramps with that one. Could be stress or something you ate — take it easy and drink plenty of water.`
      ]);
    }
    if (hasBloat) {
      return pick([
        `Came out with some bloating. Try skipping dairy today and see if that helps.`,
        `Feeling bloated after that one. Could be something you ate — ginger tea or skipping processed food might help.`
      ]);
    }
    if (hasUrgency) {
      return pick([
        `Came out with urgency — your gut had its own schedule today. Nothing to worry about unless it keeps happening.`,
        `Your gut decided the timing on that one. Urgency is usually fine but worth noting if it becomes a pattern.`
      ]);
    }
  }

  // Volume only — no symptoms, no notable bristol
  if (isGig) {
    return pick([
      `That was a big one. Came out fine though — hope you feel a lot lighter now.`,
      `Gigantic volume today. Everything came out okay — your gut clearly had a lot stored up.`,
      `That was a lot. Came out clean though, so your gut handled it well. How do you feel?`
    ]);
  }
  if (isSmall) {
    return pick([
      `Small one today — sometimes that is all there is. Your gut said what it needed to say.`,
      `Tiny visit but it counts. Your gut checked in.`,
      `Small volume today but that is perfectly normal. Your gut is doing its thing.`
    ]);
  }

  return null;
}


// ── CROSS NOTIFICATION ──
async function notifyPartner(loggedBy, bristolType, volume, symptoms, localHour, logsToday) {
  try {
    const partnerKey = loggedBy === "mike" ? "jenna" : "mike";
    const name       = loggedBy === "mike" ? "Mike" : "Jenna";
    const b          = BRISTOL[parseInt(bristolType)] || BRISTOL[4];
    const vol        = formatVolume(volume);
    const syms       = symptoms || ["none"];
    const hasSymp    = !syms.includes("none") && syms.length > 0;
    const hasCramps  = syms.includes("cramps");
    const hasBloat   = syms.includes("bloating");
    const hasUrgency = syms.includes("urgency");
    const hasBlood   = syms.includes("blood");
    const isHard     = parseInt(bristolType) <= 2;
    const isSoft     = parseInt(bristolType) === 4;
    const isLoose    = parseInt(bristolType) >= 6;
    const isCrackle  = parseInt(bristolType) === 3;
    const isBlob     = parseInt(bristolType) === 5;
    const isGig      = volume === "gigantic";
    const isHuge     = volume === "huge";
    const isSmall    = volume === "child_size" || volume === "small";
    const count      = (logsToday || 0) + 1; // +1 because logsToday was counted before saving

    // Time word for opener
    let timeWord;
    if (localHour >= 5  && localHour < 11) timeWord = "morning";
    else if (localHour >= 11 && localHour < 14) timeWord = "midday";
    else if (localHour >= 14 && localHour < 17) timeWord = "afternoon";
    else if (localHour >= 17 && localHour < 21) timeWord = "evening";
    else timeWord = "late night";

    // ── OPENER: count-aware ──
    let opener;
    if (count === 1) {
      opener = `${name} just logged — ${b.label}, ${vol}, ${timeWord}.`;
    } else if (count === 2) {
      opener = `${name} just logged again — ${b.label}, ${vol}. Second one today.`;
    } else if (count === 3) {
      opener = `${name} logged a third time today — ${b.label}, ${vol}.`;
    } else {
      opener = `${name} logged again — ${b.label}, ${vol}. That is ${count} today.`;
    }

    // ── BODY: one flowing paragraph ──
    let body;

    if (hasBlood) {
      body = pick([
        `Came out with blood flagged. Make sure they know to take that seriously if it keeps happening.`,
        `They logged blood today. Could be nothing but worth keeping an eye on — check in on them.`,
        `Blood was flagged in their log. Please make sure they do not ignore that if it shows up again.`
      ]);
    } else if (isHard && hasCramps) {
      body = pick([
        `Came out hard with cramps on top — that is a rough combination. Maybe check in on them and remind them to drink more water today.`,
        `Hard and crampy, which sounds uncomfortable. They could probably use some water and a warm compress. Worth a quick check-in.`,
        `Came out as a ${b.label} with cramps — their gut has been working hard. A nudge to hydrate and take it easy would go a long way.`,
        `Hard stool and cramps together is no fun. Check in on them if you get a chance — they might appreciate it.`
      ]);
    } else if (isHard && hasBloat) {
      body = pick([
        `Came out hard with some bloating — their gut is not totally happy today. A nudge to drink more water and skip the dairy might help.`,
        `Hard and bloated — double trouble. Remind them to hydrate and keep food light today.`,
        `Came out as a ${b.label} with bloating on top. Their gut needs more fluids and probably lighter food today.`
      ]);
    } else if (isHard) {
      const sizeNote = isGig || isHuge ? " Big volume too given how hard it was — that took some effort." : "";
      body = pick([
        `Came out hard — their gut is asking for more water.${sizeNote} Worth a gentle nudge to hydrate today.`,
        `Came out as a ${b.label} which means things are moving a bit slowly over there.${sizeNote} Remind them to drink more water if you see them.`,
        `Hard one today.${sizeNote} Classic sign of dehydration — they could use some water and fibre. Maybe mention it.`,
        `Their gut came out hard which is not ideal.${sizeNote} A nudge to drink more water today would probably help.`
      ]);
    } else if (isLoose && hasCramps && hasBloat) {
      body = pick([
        `Came out loose with cramps and bloating — their gut is having a really rough time. Worth checking if they are okay.`,
        `Loose, crampy, and bloated all at once. Their gut is not happy. Check in on them — they might need some support today.`,
        `That is a lot going on at once. Came out loose with cramps and bloating — something clearly upset their gut. Hope they are okay.`
      ]);
    } else if (isLoose && hasCramps) {
      body = pick([
        `Came out loose with cramps — sounds uncomfortable. Worth checking in on them to see how they are doing.`,
        `Loose and crampy today. Their gut is not happy — a check-in might go a long way right now.`,
        `Came out loose and painful. Their gut is having a hard time today — hope they are resting up.`
      ]);
    } else if (isLoose && hasBloat) {
      body = pick([
        `Came out loose and a bit bloated — something is not sitting right. Check in on them if you can.`,
        `Loose with bloating — their gut is unsettled today. A check-in and a reminder to drink water would help.`
      ]);
    } else if (isLoose) {
      body = pick([
        `Came out loose today — could be stress or something they ate. Hope they are staying hydrated.`,
        `Running ${b.label.toLowerCase()} over there. Their gut needs some recovery time — fluids and rest.`,
        `Came out loose. Nothing too serious but their gut is moving fast. Hope they are taking it easy today.`,
        `${b.label} today for ${name}. Remind them to drink plenty of fluids and keep food plain for now.`
      ]);
    } else if (isSoft && hasCramps) {
      body = pick([
        `Came out clean and smooth which is great, but they had cramps with it. Worth asking how they are feeling.`,
        `Good consistency — came out as a clean ${b.label} — but cramps tagged along. Could be stress. Worth a check-in.`,
        `Came out perfectly but flagged cramps. Something is still bothering their gut even if the stool looks fine.`
      ]);
    } else if (isSoft && hasBloat) {
      body = pick([
        `Came out clean and smooth — consistency is perfect. The bloating is probably something they ate. Check in if you get a chance.`,
        `Good drop, came out as a proper ${b.label}, but they are feeling bloated. Worth asking what they had today.`,
        `Clean ${b.label} which is great, but they are bloated. Maybe ask if they had anything unusual to eat.`
      ]);
    } else if (isSoft && hasSymp) {
      body = pick([
        `Came out clean but flagged some symptoms. Everything looks fine consistency-wise — the symptoms are the thing to watch.`,
        `Good drop but they had ${syms.filter(s => s !== "none").join(" and ")} with it. Worth checking in.`
      ]);
    } else if (isSoft) {
      if (isGig) {
        body = pick([
          `Came out perfectly smooth — and that was a huge one. Their gut is clearly very happy today.`,
          `Clean ${b.label} and massive volume. Their gut is absolutely thriving right now.`,
          `That was a big clean one. Everything came out perfectly over there.`
        ]);
      } else if (isHuge) {
        body = pick([
          `Came out clean and smooth with good volume. Their gut is in really good shape today.`,
          `Clean ${b.label} with solid volume. Everything is going well over there.`,
          `Came out perfectly. Their gut is happy and healthy today.`
        ]);
      } else if (isSmall) {
        body = pick([
          `Came out clean — small volume but the consistency is perfect. All good over there.`,
          `Small but came out as a clean ${b.label}. Their gut is doing its job properly.`,
          `Came out fine. Small one today but everything looks healthy.`
        ]);
      } else {
        body = pick([
          `Came out clean and smooth — their gut is happy today. Nothing to worry about.`,
          `Came out perfectly. ${b.label}, smooth, no complaints at all from their gut today.`,
          `Clean ${b.label}. Everything is looking good over there today.`,
          `Came out exactly right. Their gut is in a good place today.`,
          `Perfect drop on their end. Smooth, clean, no issues.`,
          `All good over there — came out as a clean ${b.label} with nothing to report.`
        ]);
      }
    } else if (isCrackle) {
      body = pick([
        `Came out a little firm today — nothing serious but their gut could use a bit more water.`,
        `Came out as a ${b.label} — close to perfect but slightly firm. A bit more hydration and they will be fine.`,
        `Their gut came out a little on the hard side today. Nothing to worry about — just needs more water.`
      ]);
    } else if (isBlob) {
      body = pick([
        `Came out a little mushy today — slightly softer than ideal but nothing to worry about.`,
        `Their gut came out as a ${b.label} — a touch soft but in the safe zone. Worth keeping an eye on.`,
        `Slightly mushy today. Their gut is a little unsettled but managing fine.`
      ]);
    } else if (hasSymp) {
      body = pick([
        `Came out with some ${syms.filter(s => s !== "none").join(" and ")} flagged. Worth a quick check-in.`,
        `Their gut logged some symptoms today — ${syms.filter(s => s !== "none").join(", ")}. Hope they are feeling okay.`
      ]);
    } else {
      body = pick([
        `All logged — nothing concerning to report.`,
        `Came out fine. Nothing unusual to note over there.`,
        `Their gut checked in. Everything looks normal.`
      ]);
    }

    const msg = `${opener}\n\n${body}`;

    const partnerSnap = await db.collection("users").doc(partnerKey).get();
    if (!partnerSnap.exists) return;
    const partnerChatId = partnerSnap.data()?.chatId;
    if (!partnerChatId) return;

    await sendMsg(partnerChatId, msg);
  } catch (err) {
    console.error("Cross notification failed:", err);
  }
}


// ── UTILITY FUNCTIONS ──

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getTimeWord(hour) {
  if (hour >= 5  && hour < 11) return pick([
    "Morning drop", "Early morning visit", "Starting the day right",
    "Morning gut check done", "First thing in the morning",
    "Early bird", "Morning business handled", "Bright and early"
  ]);
  if (hour >= 11 && hour < 14) return pick([
    "Midday drop", "Lunchtime visit", "Midday check-in",
    "Right around lunch", "Noon visit", "Pre-lunch drop",
    "Post-morning check-in", "Midday business"
  ]);
  if (hour >= 14 && hour < 17) return pick([
    "Afternoon drop", "Afternoon visit", "Mid-afternoon check-in",
    "Post-lunch drop", "Afternoon gut check",
    "Afternoon pit stop", "The afternoon edition"
  ]);
  if (hour >= 17 && hour < 21) return pick([
    "Evening drop", "End of day visit", "Evening check-in",
    "Wrapping up the day", "Evening gut report",
    "After work drop", "The evening edition", "End of day business"
  ]);
  return pick([
    "Late night drop", "Night visit", "Late one",
    "Middle of the night", "Late night gut check",
    "The night shift", "Past bedtime drop", "Night owl visit"
  ]);
}

function getLocalHour(now, tz) {
  const timeStr = now.toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false });
  const hour = parseInt(timeStr.split(":")[0]);
  return isNaN(hour) ? 0 : hour;
}

async function getStreak(userId, tz) {
  try {
    const snap = await db.collection("logs")
      .where("user", "==", userId)
      .orderBy("timestamp", "desc")
      .limit(100)
      .get();
    if (snap.empty) return 0;
    const now = new Date();
    const logDays = new Set(snap.docs.map(d => {
      const ts = d.data().timestamp?.toDate();
      return ts ? formatLocalDate(ts, tz) : null;
    }).filter(Boolean));
    let streak = 0;
    const check = new Date(now);
    while (true) {
      const dateStr = formatLocalDate(check, tz);
      if (!logDays.has(dateStr)) break;
      streak++;
      check.setDate(check.getDate() - 1);
    }
    return streak;
  } catch (err) {
    return 0;
  }
}

async function getDaysSinceLastLog(userId, tz) {
  try {
    const snap = await db.collection("logs")
      .where("user", "==", userId)
      .orderBy("timestamp", "desc")
      .limit(50)
      .get();
    if (snap.empty) return 999;
    const now = new Date();
    const todayStr = getTodayStr(tz);
    const sorted = snap.docs
      .map(d => d.data().timestamp?.toDate())
      .filter(Boolean)
      .sort((a, b) => b - a);
    if (!sorted.length) return 999;
    const lastStr = formatLocalDate(sorted[0], tz);
    if (lastStr === todayStr) return 0;
    const diffMs = now - sorted[0];
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  } catch (err) {
    return 0;
  }
}

async function countLoggedToday(userId, tz) {
  try {
    const todayStr = getTodayStr(tz);
    const snap     = await db.collection("logs")
      .where("user", "==", userId)
      .orderBy("timestamp", "desc")
      .limit(50)
      .get();
    return snap.docs.filter(d => {
      const ts = d.data().timestamp?.toDate();
      if (!ts) return false;
      return formatLocalDate(ts, tz) === todayStr;
    }).length;
  } catch (err) {
    console.error("countLoggedToday error:", err);
    return 0;
  }
}

async function hasLoggedTodayKey(userId, tz) {
  return (await countLoggedToday(userId, tz)) > 0;
}

async function sendMsg(chatId, text, keyboard, opts = {}) {
  const body = {
    chat_id: chatId,
    text,
    ...opts
  };
  if (keyboard) {
    const kb = Array.isArray(keyboard) ? keyboard : keyboard.inline_keyboard;
    body.reply_markup = { inline_keyboard: kb };
  }
  const res = await fetch(`${API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const json = await res.json();
  if (!json.ok) console.error(`[sendMsg] Failed:`, JSON.stringify(json));
  return json;
}

async function editMsg(chatId, msgId, text, inlineKeyboard = null, extra = {}) {
  const body = { chat_id: chatId, message_id: msgId, text, ...extra };
  if (inlineKeyboard) {
    const kb = Array.isArray(inlineKeyboard) ? inlineKeyboard : inlineKeyboard.inline_keyboard;
    body.reply_markup = { inline_keyboard: kb };
  }
  const res = await fetch(`${API}/editMessageText`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return res.json();
}

async function replyMsg(chatId, msgId, text, keyboard = null, extra = {}) {
  if (msgId) return editMsg(chatId, msgId, text, keyboard, extra);
  return sendMsg(chatId, text, keyboard, extra);
}

async function sendReminderMsg(chatId, text) {
  return sendMsg(chatId, text, [[
    { text: "Quick log", callback_data: "log:quick:quick" },
    { text: "Full log",  callback_data: "log:full:full"   },
    { text: "Skip",      callback_data: "log:skip:skip"   }
  ]]);
}


// ── GET USER BY CHAT ID ──
async function getUserByChatId(chatId) {
  try {
    const snap = await db.collection("users").get();
    const doc  = snap.docs.find(d => d.data().chatId === chatId);
    if (!doc) return null;
    return { id: doc.id, ...doc.data() };
  } catch (err) {
    console.error("getUserByChatId error:", err);
    return null;
  }
}


// ── REGISTER USER ──
async function registerUser(chatId, userId, telegramUsername) {
  await db.collection("users").doc(userId).set({
    chatId,
    telegramUsername: telegramUsername || null,
    registeredAt: Timestamp.now()
  }, { merge: true });
}


// ── GET USER PRESET ──
async function getUserPreset(userId) {
  try {
    const snap = await db.collection("config").doc("settings").get();
    return snap.data()?.[userId]?.preset || { bristolType: 4, color: "brown", volume: "normal", symptoms: ["none"] };
  } catch (err) {
    return { bristolType: 4, color: "brown", volume: "normal", symptoms: ["none"] };
  }
}


// ── /help ──
async function handleHelp(chatId, user) {
  await sendMsg(chatId,
    `*mjpt — commands*\n\n` +
    `/quick — quick log using your preset\n` +
    `/log — full guided log\n` +
    `/history — last 5 logs\n` +
    `/check — today's summary\n` +
    `/preset — update quick log preset\n` +
    `/help — this message`,
    null, { parse_mode: "Markdown" }
  );
}


// ── /check ──
async function handleCheck(chatId, user) {
  try {
    const tz = user.id === "mike" ? "Australia/Melbourne" : "Asia/Makassar";
    const todayStr = getTodayStr(tz);
    const snap = await db.collection("logs")
      .where("user", "==", user.id)
      .orderBy("timestamp", "desc")
      .limit(50)
      .get();

    const todayLogs = snap.docs
      .filter(d => {
        const ts = d.data().timestamp?.toDate();
        if (!ts) return false;
        return formatLocalDate(ts, tz) === todayStr;
      })
      .map(d => d.data());

    if (todayLogs.length === 0) {
      await sendMsg(chatId,
        `No logs yet today. Want to log now?`, [[
          { text: "Quick log", callback_data: "log:quick:quick" },
          { text: "Full log",  callback_data: "log:full:full"   }
        ]]
      );
      return;
    }

    const lines = todayLogs.map(l => {
      const b   = BRISTOL[parseInt(l.bristolType)] || BRISTOL[4];
      const vol = formatVolume(l.volume);
      const t   = l.timestamp?.toDate().toLocaleTimeString("en-AU", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
      return `${b.label} · ${vol} · ${t}`;
    });

    await sendMsg(chatId,
      `*Today's logs (${todayLogs.length})*\n\n${lines.join("\n")}\n\nLog another?`, [[
        { text: "Quick log", callback_data: "log:quick:quick" },
        { text: "Full log",  callback_data: "log:full:full"   }
      ]], { parse_mode: "Markdown" }
    );
  } catch (err) {
    console.error("handleCheck error:", err);
    await sendMsg(chatId, "Failed to load today's logs. Try again.");
  }
}


// ── /history ──
async function handleHistory(chatId, user) {
  try {
    const snap = await db.collection("logs")
      .where("user", "==", user.id)
      .orderBy("timestamp", "desc")
      .limit(50)
      .get();

    if (snap.empty) {
      await sendMsg(chatId, "No logs yet. Use /quick or /log to get started!");
      return;
    }

    const tz   = user.id === "mike" ? "Australia/Melbourne" : "Asia/Makassar";
    const docs = snap.docs
      .map(d => ({ ...d.data() }))
      .sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0))
      .slice(0, 5);

    const lines = docs.map(l => {
      const b    = BRISTOL[parseInt(l.bristolType)] || BRISTOL[4];
      const date = l.timestamp.toDate().toLocaleString("en-AU", { timeZone: tz, hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" });
      const syms = l.symptoms?.includes("none") ? "" : ` · ${l.symptoms.join(", ")}`;
      const vol  = formatVolume(l.volume);
      return `*${b.label}* · ${vol} · ${l.color?.replace(/_/g, " ") || "brown"}${syms} — _${date}_`;
    });

    await sendMsg(chatId, `*Last 5 logs:*\n\n${lines.join("\n")}`, null, { parse_mode: "Markdown" });
  } catch (err) {
    console.error("History error:", err);
    await sendMsg(chatId, "Failed to load history. Try again.");
  }
}


// ── /preset ──
async function handlePreset(chatId, user) {
  const preset = await getUserPreset(user.id);
  const b      = BRISTOL[parseInt(preset.bristolType)] || BRISTOL[4];
  const vol    = formatVolume(preset.volume || "normal");

  await sendMsg(chatId,
    `*Your quick log preset*\n\n${b.label} · ${vol} · ${preset.color?.replace(/_/g," ")||"brown"}\n\nUpdate it in the web app under Settings.`,
    null, { parse_mode: "Markdown" }
  );
}


// ── PRESET CALLBACK ──
async function handlePresetCallback(chatId, msgId, user, field, value) {
  // Preset changes handled via web settings — just confirm
  await editMsg(chatId, msgId, "Update your preset in the web app under Settings.", null);
}


// ── CONVERSATION (text replies during session) ──
async function handleConversation(chatId, user, text, session, msg) {
  if (session.step === "time") {
    const timeRegex = /^([01]?\d|2[0-3]):([0-5]\d)$/;
    if (!timeRegex.test(text.trim())) {
      await sendMsg(chatId, "Please use HH:MM format (e.g. 08:30 or 21:00)");
      return;
    }
    await handleLogCallback(chatId, null, user, "time", text.trim());
    return;
  }

  if (session.step === "notes") {
    session.data.notes = text;
    await saveLog(chatId, session.data, null, msg?.message_id);
    return;
  }

  // Unrecognised text during session — prompt
  await sendMsg(chatId, "I didn't catch that. Use the buttons to continue logging, or /log to start over.");
}


// ── MAIN HANDLER ──
module.exports = async (req, res) => {
  // GET test route
  if (req.method === "GET") {
    try {
      await db.collection("config").doc("settings").get();
      return res.status(200).json({ ok: true, firebase: "connected" });
    } catch (err) {
      return res.status(200).json({ ok: false, firebase: "failed", error: err.message });
    }
  }

  if (req.method !== "POST") return res.status(200).json({ ok: true });

  // Verify the request actually came from Telegram (secret_token set via setWebhook)
  if (!safeEquals(req.headers["x-telegram-bot-api-secret-token"], process.env.TELEGRAM_WEBHOOK_SECRET)) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  try {
    const update = req.body;

    // Handle callback queries (inline button taps)
    if (update.callback_query) {
      await handleCallback(update.callback_query);
      return res.status(200).json({ ok: true });
    }

    // Handle messages
    if (update.message) {
      await handleMessage(update.message);
      return res.status(200).json({ ok: true });
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("WEBHOOK ERROR:", err);
    res.status(200).json({ ok: true }); // Always return 200 to Telegram
  }
};
