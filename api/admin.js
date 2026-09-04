// ============================================================
// MJPT — Admin Panel
// Gated by ?key=ADMIN_KEY env variable.
// Serves admin UI and handles admin actions.
// Access: /api/admin?key=your_admin_key
// ============================================================

const { db, BOT, API } = require("./lib/firebase");
const { Timestamp }     = require("firebase-admin/firestore");
const { safeEquals }    = require("./lib/auth");


// ── HANDLER ──
module.exports = async (req, res) => {
  const key = req.query.key;

  // Gate
  if (!safeEquals(key, process.env.ADMIN_KEY)) {
    return res.status(404).send("Not found");
  }

  const action = req.query.action;

  // POST actions
  if (req.method === "POST" && action) {
    return handleAction(req, res, action);
  }

  // GET — serve admin UI
  res.setHeader("Content-Type", "text/html");
  res.send(adminHTML(key));
};


// ── ACTIONS ──
async function handleAction(req, res, action) {
  try {
    switch (action) {

      case "trigger_reminder": {
        const { user, message } = req.body || {};
        const users   = user ? [user] : ["mike", "jenna"];
        const results = [];

        for (const u of users) {
          const snap   = await db.collection("users").doc(u).get();
          const chatId = snap.data()?.chatId;
          if (chatId) {
            // Use custom message or fallback to default
            const settingsSnap = await db.collection("config").doc("settings").get();
            const customMsgs   = settingsSnap.data()?.[u]?.manualReminderMessages;
            const defaultMsg   = `Hey! Manual reminder from admin. Don't forget to log today! /quick`;
            const msgs         = message ? [message] : (customMsgs?.length > 0 ? customMsgs : [defaultMsg]);
            const text         = msgs[Math.floor(Math.random() * msgs.length)];

            await fetch(`${API}/sendMessage`, {
              method:  "POST",
              headers: { "Content-Type": "application/json" },
              body:    JSON.stringify({
                chat_id:      chatId,
                text,
                reply_markup: {
                  inline_keyboard: [[
                    { text: "Quick log", callback_data: "log:quick:quick" },
                    { text: "Full log",  callback_data: "log:full:full"   },
                    { text: "Skip",      callback_data: "log:skip:skip"   }
                  ]]
                }
              })
            });
            results.push({ user: u, sent: true, text });
          } else {
            results.push({ user: u, sent: false, reason: "No chat ID" });
          }
        }

        return res.json({ ok: true, results });
      }

      case "update_wording": {
        const { user, type, messages } = req.body || {};
        if (!user || !["mike", "jenna"].includes(user)) return res.status(400).json({ error: "Invalid user" });
        if (!type || !["auto", "manual"].includes(type))  return res.status(400).json({ error: "type must be auto or manual" });
        if (!Array.isArray(messages) || messages.length === 0) return res.status(400).json({ error: "messages must be non-empty array" });

        const field = type === "auto" ? "reminderMessages" : "manualReminderMessages";
        await db.collection("config").doc("settings").set(
          { [user]: { [field]: messages } },
          { merge: true }
        );
        return res.json({ ok: true, user, type, messages });
      }

      case "get_wording": {
        const snap = await db.collection("config").doc("settings").get();
        const data = snap.data() || {};
        return res.json({
          ok: true,
          mike:  { auto: data.mike?.reminderMessages || [], manual: data.mike?.manualReminderMessages || [] },
          jenna: { auto: data.jenna?.reminderMessages || [], manual: data.jenna?.manualReminderMessages || [] }
        });
      }

      case "raw_logs": {
        const limit = parseInt(req.query.limit) || 50;
        const snap  = await db.collection("logs")
          .orderBy("timestamp", "desc")
          .limit(limit)
          .get();
        const logs = snap.docs.map(d => ({ id: d.id, ...d.data(), timestamp: d.data().timestamp?.toDate()?.toISOString() }));
        return res.json({ ok: true, count: logs.length, logs });
      }

      case "delete_entry": {
        const { id } = req.body || {};
        if (!id) return res.status(400).json({ error: "Missing id" });
        await db.collection("logs").doc(id).delete();
        return res.json({ ok: true, deleted: id });
      }

      case "reset_data": {
        const { confirm } = req.body || {};
        if (confirm !== "RESET_ALL_DATA") {
          return res.status(400).json({ error: "Must confirm with RESET_ALL_DATA" });
        }
        const snap  = await db.collection("logs").get();
        const batch = db.batch();
        snap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
        return res.json({ ok: true, deleted: snap.size });
      }

      case "stats": {
        const logsSnap  = await db.collection("logs").get();
        const usersSnap = await db.collection("users").get();

        const logsByUser = {};
        logsSnap.docs.forEach(d => {
          const u = d.data().user;
          logsByUser[u] = (logsByUser[u] || 0) + 1;
        });

        const stats = {
          totalLogs:  logsSnap.size,
          totalUsers: usersSnap.size,
          users: usersSnap.docs.map(d => ({
            id:               d.id,
            telegramUsername: d.data().telegramUsername || null,
            chatId:           d.data().chatId ? "✓ linked" : "✗ not linked",
            logs:             logsByUser[d.id] || 0
          }))
        };
        return res.json({ ok: true, stats });
      }

      default:
        return res.status(400).json({ error: "Unknown action" });
    }
  } catch (err) {
    console.error("Admin action failed:", err);
    return res.status(500).json({ error: err.message });
  }
}


// ── ADMIN HTML ──
function adminHTML(key) {
  const css = `
    <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
    :root{
      --bg:#0f0c07;--surface:#1a1208;--surface2:#231908;
      --border:rgba(255,255,255,0.08);--border2:rgba(255,255,255,0.12);
      --accent:#c05a30;--accent-soft:rgba(192,90,48,0.12);
      --good-soft:rgba(61,122,82,0.15);--danger:#8B2010;
      --text:#e8d8c8;--text-soft:#7a6a58;--text-faint:#3a2a18;--radius:10px;
    }
    body{font-family:-apple-system,'Helvetica Neue',sans-serif;background:var(--bg);color:var(--text);min-height:100vh;}
    .layout{display:flex;min-height:100vh;}
    .sidebar{width:220px;background:var(--surface);border-right:1px solid var(--border);position:fixed;top:0;left:0;bottom:0;display:flex;flex-direction:column;overflow-y:auto;}
    .logo{padding:20px;border-bottom:1px solid var(--border);}
    .logo-title{font-size:20px;font-weight:700;letter-spacing:-0.5px;}
    .logo-env{display:inline-block;font-size:10px;font-weight:600;text-transform:uppercase;background:var(--accent-soft);color:var(--accent);padding:2px 8px;border-radius:100px;margin-top:4px;}
    .nav-group{padding:14px 0 6px;}
    .nav-label{font-size:9px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--text-faint);padding:0 16px 6px;}
    .nav-btn{display:flex;align-items:center;gap:10px;padding:9px 16px;cursor:pointer;font-size:13px;color:var(--text-soft);background:none;border:none;width:100%;text-align:left;transition:all 0.15s;font-family:inherit;}
    .nav-btn:hover{color:var(--text);background:rgba(255,255,255,0.04);}
    .nav-btn.active{color:var(--accent);background:var(--accent-soft);font-weight:500;}
    .main{margin-left:220px;padding:32px;max-width:720px;}
    .page{display:none;}.page.active{display:block;}
    .page-title{font-size:22px;font-weight:700;margin-bottom:4px;}
    .page-sub{font-size:13px;color:var(--text-soft);margin-bottom:24px;}
    .card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:18px;margin-bottom:12px;}
    .card-label{font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--text-soft);margin-bottom:12px;}
    .stat-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px;}
    .stat-box{background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius);padding:14px;}
    .stat-num{font-size:28px;font-weight:700;line-height:1;margin-bottom:4px;}
    .stat-lbl{font-size:11px;color:var(--text-soft);}
    .user-row{display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border);}
    .user-row:last-child{border-bottom:none;}
    .user-name{font-size:14px;font-weight:500;}
    .user-sub{font-size:12px;color:var(--text-soft);margin-top:1px;}
    .pill{display:inline-flex;font-size:11px;font-weight:600;padding:3px 10px;border-radius:100px;}
    .pill-good{background:var(--good-soft);color:#5daa82;}
    .pill-mute{background:rgba(255,255,255,0.06);color:var(--text-soft);}
    .btn{display:inline-flex;align-items:center;gap:6px;padding:9px 16px;border-radius:8px;font-size:13px;font-weight:500;cursor:pointer;border:none;transition:all 0.15s;font-family:inherit;}
    .btn:active{transform:scale(0.97);}
    .btn:disabled{opacity:0.45;cursor:not-allowed;transform:none;}
    .btn-primary{background:var(--accent);color:white;}
    .btn-primary:hover:not(:disabled){opacity:0.88;}
    .btn-ghost{background:rgba(255,255,255,0.06);color:var(--text);border:1px solid var(--border2);}
    .btn-ghost:hover:not(:disabled){background:rgba(255,255,255,0.1);}
    .btn-danger{background:var(--danger);color:white;}
    .btn-danger:hover:not(:disabled){opacity:0.88;}
    .btn-sm{padding:6px 12px;font-size:12px;}
    .btn-row{display:flex;gap:8px;flex-wrap:wrap;}
    label{display:block;font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:var(--text-soft);margin-bottom:5px;}
    input,textarea,select{width:100%;background:var(--surface2);border:1px solid var(--border);border-radius:8px;color:var(--text);padding:9px 12px;font-family:inherit;font-size:13px;outline:none;transition:border 0.15s;margin-bottom:12px;}
    input:focus,textarea:focus,select:focus{border-color:var(--accent);}
    textarea{resize:vertical;}
    .result{background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius);padding:14px;font-size:12px;font-family:monospace;line-height:1.7;white-space:pre-wrap;word-break:break-all;color:#b8a888;margin-top:14px;min-height:48px;}
    .result.ok{border-color:rgba(61,122,82,0.35);color:#5daa82;}
    .result.err{border-color:rgba(139,32,16,0.35);color:#e05040;}
    .log-row{padding:10px 0;border-bottom:1px solid var(--border);}
    .log-row:last-child{border-bottom:none;}
    .log-main{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;}
    .log-detail{font-size:13px;font-weight:500;}
    .log-meta{font-size:11px;color:var(--text-soft);margin-top:2px;}
    .log-id{font-family:monospace;font-size:10px;color:var(--text-faint);margin-top:2px;}
    .danger-zone{border:1px solid rgba(139,32,16,0.3);border-radius:var(--radius);padding:18px;background:rgba(139,32,16,0.06);}
    .danger-title{font-size:13px;font-weight:600;color:#e05040;margin-bottom:6px;}
    .danger-desc{font-size:12px;color:var(--text-soft);margin-bottom:14px;line-height:1.5;}
    .toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(10px);background:var(--surface);border:1px solid var(--border2);border-radius:10px;padding:10px 20px;font-size:13px;opacity:0;pointer-events:none;transition:all 0.22s;z-index:999;box-shadow:0 8px 32px rgba(0,0,0,0.5);}
    .toast.show{opacity:1;transform:translateX(-50%) translateY(0);}
    .toast.ok{border-color:rgba(61,122,82,0.5);color:#5daa82;}
    .toast.err{border-color:rgba(139,32,16,0.5);color:#e05040;}
    #errBanner{display:none;background:#8B2010;color:white;padding:10px 16px;font-size:12px;font-family:monospace;position:fixed;top:0;left:0;right:0;z-index:9999;white-space:pre-wrap;}
    </style>`;

  const nav = `
    <nav class="sidebar">
      <div class="logo"><div class="logo-title">mjpt</div><div class="logo-env">Admin</div></div>
      <div class="nav-group">
        <div class="nav-label">Overview</div>
        <button class="nav-btn active" onclick="navTo('stats',this)">Stats</button>
      </div>
      <div class="nav-group">
        <div class="nav-label">Reminders</div>
        <button class="nav-btn" onclick="navTo('reminders',this)">Send reminder</button>
        <button class="nav-btn" onclick="navTo('cron',this)">Test cron</button>
        <button class="nav-btn" onclick="navTo('wording',this)">Wording</button>
      </div>
      <div class="nav-group">
        <div class="nav-label">Data</div>
        <button class="nav-btn" onclick="navTo('logs',this)">Raw logs</button>
        <button class="nav-btn" onclick="navTo('danger',this)">Danger zone</button>
      </div>
    </nav>`;

  const pages = `
    <div class="page active" id="page-stats">
      <div class="page-title">Stats</div>
      <div class="page-sub">Overview of logs and users</div>
      <div class="stat-grid">
        <div class="stat-box"><div class="stat-num" id="sTotal">--</div><div class="stat-lbl">Total logs</div></div>
        <div class="stat-box"><div class="stat-num" id="sMike">--</div><div class="stat-lbl">Mike logs</div></div>
        <div class="stat-box"><div class="stat-num" id="sJenna">--</div><div class="stat-lbl">Jenna logs</div></div>
      </div>
      <div class="card"><div class="card-label">Telegram</div><div id="usersList">Loading...</div></div>
      <button class="btn btn-ghost btn-sm" onclick="loadStats()">Refresh</button>
    </div>
    <div class="page" id="page-reminders">
      <div class="page-title">Send Reminder</div>
      <div class="page-sub">Manually trigger a Telegram reminder</div>
      <div class="card">
        <div class="card-label">Quick trigger</div>
        <div class="btn-row">
          <button class="btn btn-primary" onclick="triggerReminder('mike')">Send to Mike</button>
          <button class="btn btn-primary" onclick="triggerReminder('jenna')">Send to Jenna</button>
          <button class="btn btn-ghost" onclick="triggerReminder('both')">Both</button>
        </div>
      </div>
      <div class="card">
        <div class="card-label">Custom message</div>
        <label>Message</label>
        <input id="customMsg" placeholder="Hey! Don't forget to log..." />
        <div class="btn-row">
          <button class="btn btn-ghost btn-sm" onclick="triggerCustom('mike')">Mike</button>
          <button class="btn btn-ghost btn-sm" onclick="triggerCustom('jenna')">Jenna</button>
        </div>
      </div>
      <div class="result" id="reminderResult">Results here.</div>
    </div>
    <div class="page" id="page-cron">
      <div class="page-title">Test Cron</div>
      <div class="page-sub">Run the cron manually to debug</div>
      <div class="card">
        <div class="card-label">Run cron now</div>
        <button class="btn btn-primary" id="cronBtn" onclick="testCron()">Run cron (normal)</button>
        <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-ghost btn-sm" onclick="testCron('reminder')">Force reminder</button>
          <button class="btn btn-ghost btn-sm" onclick="testCron('recap')">Force recap</button>
          <button class="btn btn-ghost btn-sm" onclick="testCron('alert')">Force alert</button>
          <button class="btn btn-ghost btn-sm" onclick="testCron('all')">Force all</button>
        </div>
      </div>
      <div class="result" id="cronResult">Click run to see output.</div>
    </div>
    <div class="page" id="page-wording">
      <div class="page-title">Reminder Wording</div>
      <div class="page-sub">One message per line — picked randomly.</div>
      <div class="card">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
          <div><label>User</label><select id="wordingUser"><option value="mike">Mike</option><option value="jenna">Jenna</option></select></div>
          <div><label>Type</label><select id="wordingType"><option value="auto">Scheduled</option><option value="manual">Manual</option></select></div>
        </div>
        <label>Messages</label>
        <textarea id="wordingMessages" rows="7" placeholder="One message per line..."></textarea>
        <div class="btn-row">
          <button class="btn btn-ghost btn-sm" onclick="loadWording()">Load</button>
          <button class="btn btn-primary btn-sm" onclick="saveWording()">Save</button>
        </div>
      </div>
      <div class="result" id="wordingResult" style="display:none"></div>
    </div>
    <div class="page" id="page-logs">
      <div class="page-title">Raw Logs</div>
      <div class="page-sub">Last 50 entries</div>
      <div class="btn-row" style="margin-bottom:16px">
        <button class="btn btn-ghost" onclick="loadLogs()">Load logs</button>
      </div>
      <div id="logsList">Click load.</div>
    </div>
    <div class="page" id="page-danger">
      <div class="page-title">Danger Zone</div>
      <div class="page-sub">Destructive actions</div>
      <div class="card" style="margin-bottom:16px">
        <div class="card-label">Delete entry</div>
        <label>Document ID</label>
        <input id="deleteId" placeholder="Get from Raw Logs" />
        <button class="btn btn-danger btn-sm" onclick="deleteSingle()">Delete</button>
        <div class="result" id="deleteResult" style="display:none"></div>
      </div>
      <div class="danger-zone">
        <div class="danger-title">Reset all data</div>
        <div class="danger-desc">Permanently deletes every log. No undo.</div>
        <button class="btn btn-danger" onclick="resetAll()">Reset all logs</button>
        <div class="result" id="resetResult" style="display:none"></div>
      </div>
    </div>`;

  // JS is built as a plain string — no template literals, no backticks
  const js = buildAdminJS(key);

  return '<!DOCTYPE html><html><head><meta charset="UTF-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1.0">'
    + '<title>mjpt admin</title>'
    + css
    + '</head><body>'
    + '<div id="errBanner"></div>'
    + '<div class="layout">'
    + nav
    + '<main class="main">' + pages + '</main>'
    + '</div>'
    + '<div class="toast" id="toast"></div>'
    + '<script>' + js + '</scr' + 'ipt>'
    + '</body></html>';
}


// ── BUILD ADMIN JS ──
// Written as plain string concatenation — no template literals,
// no escaping issues regardless of content.
function buildAdminJS(key) {
  const K = JSON.stringify(key);
  return [
    "window.onerror=function(m,s,l){var b=document.getElementById('errBanner');b.style.display='block';b.textContent='JS ERROR: '+m+' (line '+l+')';};",
    "var KEY=" + K + ";",
    "var toastTimer;",

    "function navTo(page,btn){",
    "  var ps=document.querySelectorAll('.page');",
    "  for(var i=0;i<ps.length;i++)ps[i].classList.remove('active');",
    "  var bs=document.querySelectorAll('.nav-btn');",
    "  for(var i=0;i<bs.length;i++)bs[i].classList.remove('active');",
    "  document.getElementById('page-'+page).classList.add('active');",
    "  btn.classList.add('active');",
    "  if(page==='stats')loadStats();",
    "  if(page==='wording')loadWording();",
    "}",

    "function showToast(msg,type){",
    "  var el=document.getElementById('toast');",
    "  el.textContent=msg;el.className='toast show '+(type||'ok');",
    "  clearTimeout(toastTimer);",
    "  toastTimer=setTimeout(function(){el.className='toast';},2800);",
    "}",

    "function callApi(action,body){",
    "  return fetch('/api/admin?key='+KEY+'&action='+action,{",
    "    method:'POST',headers:{'Content-Type':'application/json'},",
    "    body:JSON.stringify(body||{})",
    "  }).then(function(r){return r.json();});",
    "}",

    "function showResult(id,data,msg){",
    "  var el=document.getElementById(id);if(!el)return;",
    "  el.style.display='block';",
    "  el.textContent=typeof data==='string'?data:JSON.stringify(data,null,2);",
    "  var ok=data&&data.ok!==false;",
    "  el.className='result '+(ok?'ok':'err');",
    "  showToast(msg||(ok?'Done':'Failed'),ok?'ok':'err');",
    "}",

    "function loadStats(){",
    "  callApi('stats').then(function(data){",
    "    if(!data||!data.ok){showToast('Failed to load stats','err');return;}",
    "    var s=data.stats;",
    "    document.getElementById('sTotal').textContent=s.totalLogs;",
    "    var users=s.users||[];",
    "    var mk=users.filter(function(u){return u.id==='mike';})[0];",
    "    var jn=users.filter(function(u){return u.id==='jenna';})[0];",
    "    document.getElementById('sMike').textContent=mk?mk.logs:'--';",
    "    document.getElementById('sJenna').textContent=jn?jn.logs:'--';",
    "    var html='';",
    "    users.forEach(function(u){",
    "      var linked=u.chatId==='\\u2713 linked';",
    "      html+='<div class=\"user-row\"><div><div class=\"user-name\">'+(u.id==='mike'?'Mike':'Jenna')+'</div>'",
    "        +'<div class=\"user-sub\">'+(u.telegramUsername?'@'+u.telegramUsername:'No username')+'&middot;'+u.logs+' logs</div></div>'",
    "        +'<span class=\"pill '+(linked?'pill-good':'pill-mute')+'\">'+(linked?'Linked':'Not linked')+'</span></div>';",
    "    });",
    "    document.getElementById('usersList').innerHTML=html;",
    "    showToast('Stats loaded');",
    "  }).catch(function(e){showToast('Error: '+e.message,'err');});",
    "}",

    "function triggerReminder(user){",
    "  var users=user==='both'?['mike','jenna']:[user];",
    "  var sent=[];var pending=users.length;",
    "  users.forEach(function(u){",
    "    callApi('trigger_reminder',{user:u}).then(function(d){",
    "      if(d&&d.ok)sent.push(u.charAt(0).toUpperCase()+u.slice(1));",
    "      pending--;",
    "      if(pending===0)showResult('reminderResult',{ok:sent.length>0},sent.length?'Sent to '+sent.join(' & '):'Failed');",
    "    });",
    "  });",
    "}",

    "function triggerCustom(user){",
    "  var msg=document.getElementById('customMsg').value.trim();",
    "  callApi('trigger_reminder',{user:user,message:msg||undefined}).then(function(d){",
    "    showResult('reminderResult',d,d&&d.ok?'Sent to '+user:'Failed');",
    "  });",
    "}",

    "function testCron(force){",
    "  var btn=document.getElementById('cronBtn');",
    "  btn.disabled=true;btn.textContent='Running...';",
    "  var url='/api/cron?key='+KEY+(force?'&force='+force:'');",
    "  fetch(url).then(function(r){return r.json();}).then(function(data){",
    "    var el=document.getElementById('cronResult');",
    "    if(data&&data.results){",
    "      el.className='result ok';",
    "      var out='';",
    "      data.results.forEach(function(r){",
    "        out+=r.user.toUpperCase()+'\\n';",
    "        if(r.error){out+='  error: '+r.error+'\\n';}",
    "        else if(r.actions){r.actions.forEach(function(a){",
    "          out+='  ['+a.type+'] sent:'+a.sent+(a.reason?' -- '+a.reason:'')+'\\n';",
    "          if(a.msg)out+='    msg: '+a.msg+'\\n';",
    "        });}",
    "        out+='\\n';",
    "      });",
    "      el.textContent=out;",
    "      showToast('Cron ran');",
    "    }else{el.className='result err';el.textContent=JSON.stringify(data,null,2);showToast('Unexpected','err');}",
    "  }).catch(function(e){showResult('cronResult',{ok:false},'Failed: '+e.message);})",
    "  .finally(function(){btn.disabled=false;btn.textContent='Run cron now';});",
    "}",

    "function loadWording(){",
    "  var user=document.getElementById('wordingUser').value;",
    "  var type=document.getElementById('wordingType').value;",
    "  callApi('get_wording').then(function(data){",
    "    if(!data||!data.ok){showToast('Failed','err');return;}",
    "    var msgs=type==='auto'?(data[user]&&data[user].auto):(data[user]&&data[user].manual);",
    "    document.getElementById('wordingMessages').value=(msgs||[]).join('\\n');",
    "    showToast((msgs&&msgs.length||0)+' messages loaded');",
    "  });",
    "}",

    "function saveWording(){",
    "  var user=document.getElementById('wordingUser').value;",
    "  var type=document.getElementById('wordingType').value;",
    "  var msgs=document.getElementById('wordingMessages').value.split('\\n').map(function(m){return m.trim();}).filter(Boolean);",
    "  if(!msgs.length){showToast('Enter at least one message','err');return;}",
    "  callApi('update_wording',{user:user,type:type,messages:msgs}).then(function(data){",
    "    showResult('wordingResult',data,data&&data.ok?'Saved '+msgs.length+' messages':'Failed');",
    "  });",
    "}",

    "function loadLogs(){",
    "  callApi('raw_logs').then(function(data){",
    "    if(!data||!data.ok){showToast('Failed','err');return;}",
    "    var c=document.getElementById('logsList');",
    "    if(!data.logs||!data.logs.length){c.innerHTML='No logs.';return;}",
    "    var html='';",
    "    data.logs.forEach(function(l){",
    "      var syms=l.symptoms&&!l.symptoms.includes('none')?' &middot; '+l.symptoms.join(', '):'';",
    "      html+='<div class=\"log-row\"><div class=\"log-main\"><div>'",
    "        +'<div class=\"log-detail\">'+(l.user==='mike'?'Mike':'Jenna')+'&middot;T'+l.bristolType+'&middot;'+(l.volume||'normal')+'&middot;'+(l.color||'brown')+syms+'</div>'",
    "        +'<div class=\"log-meta\">'+(l.timestamp||'--')+(l.notes?' &middot;'+l.notes:'')+'</div>'",
    "        +'<div class=\"log-id\">'+l.id+'</div>'",
    "        +'</div><button class=\"btn btn-danger btn-sm\" onclick=\"doDelete(this.dataset.id)\" data-id=\"'+l.id+'\">Del</button>'",
    "        +'</div></div>';",
    "    });",
    "    c.innerHTML=html;",
    "    showToast(data.count+' logs loaded');",
    "  });",
    "}",

    "function doDelete(id){",
    "  if(!confirm('Delete '+id+'?'))return;",
    "  callApi('delete_entry',{id:id}).then(function(d){",
    "    if(d&&d.ok){showToast('Deleted');loadLogs();}",
    "    else showToast('Failed','err');",
    "  });",
    "}",

    "function deleteSingle(){",
    "  var id=document.getElementById('deleteId').value.trim();",
    "  if(!id){showToast('Enter an ID','err');return;}",
    "  if(!confirm('Delete '+id+'?'))return;",
    "  callApi('delete_entry',{id:id}).then(function(d){",
    "    showResult('deleteResult',d,d&&d.ok?'Deleted':'Failed');",
    "  });",
    "}",

    "function resetAll(){",
    "  var c=prompt('Type RESET_ALL_DATA to confirm:');",
    "  if(!c)return;",
    "  callApi('reset_data',{confirm:c}).then(function(d){",
    "    showResult('resetResult',d,d&&d.ok?d.deleted+' logs deleted':'Failed or wrong confirmation');",
    "  });",
    "}",

    "loadStats();"
  ].join('\n');
}
