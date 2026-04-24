const Imap = require("imap");
const { simpleParser } = require("mailparser");

const BULK_CONCURRENCY = 5;

function getImapConfig(cred) {
  return {
    user: cred.email,
    password: cred.password,
    host: cred.imapHost || (cred.provider === "gmail" ? "imap.gmail.com" : null),
    port: cred.imapPort || 993,
    tls: true,
    tlsOptions: { rejectUnauthorized: false },
    connTimeout: 15000,
    authTimeout: 10000,
  };
}

function connectImap(cred) {
  return new Promise((resolve, reject) => {
    const imap = new Imap(getImapConfig(cred));
    imap.once("ready", () => resolve(imap));
    imap.once("error", (err) => reject(err));
    imap.connect();
  });
}

function disconnectImap(imap) {
  try { imap.end(); } catch {}
}

function openInbox(imap) {
  return new Promise((resolve, reject) => {
    imap.openBox("INBOX", true, (err, box) => (err ? reject(err) : resolve(box)));
  });
}

function searchMsgs(imap, criteria) {
  return new Promise((resolve, reject) => {
    imap.search(criteria, (err, results) => (err ? reject(err) : resolve(results || [])));
  });
}

// Fetch and parse a list of UIDs from an open IMAP connection.
// Returns an array of mailparser parsed objects.
function fetchAndParse(imap, uids) {
  if (!uids || !uids.length) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    var parsed_list = [];
    var pending = [];
    var f = imap.fetch(uids, { bodies: "" });

    f.on("message", function(msg) {
      var chunks = [];
      msg.on("body", function(stream) {
        stream.on("data", function(d) { chunks.push(d); });
        stream.on("end", function() {
          pending.push(
            simpleParser(Buffer.concat(chunks)).then(function(parsed) {
              parsed_list.push(parsed);
            }).catch(function() {})
          );
        });
      });
    });

    f.once("end", function() {
      Promise.all(pending).then(function() { resolve(parsed_list); }).catch(function() { resolve(parsed_list); });
    });
    f.once("error", reject);
  });
}

function extractNetflixResetLink(text) {
  if (!text) return null;
  const re = /https:\/\/www\.netflix\.com\/password[^\s"'<>\]]*/gi;
  const m = re.exec(text);
  if (m) return m[0].replace(/[)\].,;:'"]*$/, "");
  return null;
}

function extractCountryFromSrc(text) {
  if (!text) return null;
  const m = text.match(/SRC:\s*[A-Za-z0-9]+_[a-f0-9-]+_[a-z]{2}_([A-Z]{2})_[A-Za-z]+/);
  return m ? m[1] : null;
}

// Get all email addresses from a mailparser address field
function getAddresses(field) {
  if (!field) return [];
  var addrs = [];
  var walk = function(node) {
    if (!node) return;
    if (node.address) addrs.push(node.address.toLowerCase());
    if (node.value && Array.isArray(node.value)) node.value.forEach(walk);
  };
  if (Array.isArray(field.value)) field.value.forEach(walk);
  else walk(field);
  return addrs;
}

var RESET_KEYWORDS = [
  "password reset", "reset password", "complete your password",
  "contraseña", "mot de passe", "passwort", "senha", "kata sandi",
  "รีเซ็ต", "パスワード", "密码", "비밀번호", "пароль", "şifre",
  "mật khẩu", "wachtwoord", "hasła",
];

var EXCLUSION_KEYWORDS = [
  "sign-in", "temporary access", "household", "sementara", "masukmu",
  "new device", "new sign-in", "new sign in", "nuevo dispositivo",
  "novo dispositivo", "nouvel appareil", "neues gerät", "perangkat baru",
  "yeni cihaz", "อุปกรณ์ใหม่", "新しいデバイス", "새 기기",
  "新设备", "新裝置", "новое устройство", "جهاز جديد",
];

var NEW_DEVICE_SUBJECT_KEYWORDS = [
  "new device", "new sign-in", "new sign in", "nuevo dispositivo",
  "novo dispositivo", "nouvel appareil", "neues gerät", "perangkat baru",
  "yeni cihaz", "yeni bir cihaz", "อุปกรณ์ใหม่", "新しいデバイス",
  "새 기기", "新设备", "新裝置", "новое устройство", "جهاز جديد",
];

function isNewDeviceEmail(subject, bodyText, bodyHtml) {
  var subj = (subject || "").replace(/^(fw|fwd)\s*:\s*/i, "").trim();
  var body = (bodyText || "") + " " + (bodyHtml || "");
  if (!/netflix/i.test(subj + " " + body)) return false;
  var subjLower = subj.toLowerCase();
  if (/(password\s*reset|reset\s*password|complete\s*your\s*password)/i.test(subjLower)) return false;
  for (var i = 0; i < NEW_DEVICE_SUBJECT_KEYWORDS.length; i++) {
    if (subjLower.includes(NEW_DEVICE_SUBJECT_KEYWORDS[i].toLowerCase())) return true;
  }
  if (/new device signed in/i.test(body)) return true;
  if (/nftoken/i.test(body) && /(new device|signed in to your|sign[- ]?in alert)/i.test(body)) return true;
  return false;
}

function isPasswordResetEmail(subject, bodyText, bodyHtml) {
  var subj = (subject || "").replace(/^(fw|fwd)\s*:\s*/i, "").trim();
  var body = (bodyText || "") + " " + (bodyHtml || "");
  if (!/netflix/i.test(subj + " " + body)) return false;
  var subjLower = subj.toLowerCase();
  for (var i = 0; i < EXCLUSION_KEYWORDS.length; i++) {
    if (subjLower.includes(EXCLUSION_KEYWORDS[i])) return false;
  }
  for (var i = 0; i < RESET_KEYWORDS.length; i++) {
    if (subjLower.includes(RESET_KEYWORDS[i])) return true;
  }
  if (/nftoken/i.test(body)) return true;
  if (/netflix\.com\/password(?!-reset-success)/i.test(body)) return true;
  return false;
}

// ─── Single-account helpers ───────────────────────────────────────────────────

// Given an open IMAP connection already on INBOX, fetch the best reset link for one email.
// Returns { found, resetLink? } or { found: false, message }
async function searchResetLinkOnConnection(imap, accountEmail, sinceHours) {
  var accountEmailLower = accountEmail.toLowerCase();
  var since = new Date();
  since.setHours(since.getHours() - sinceHours);

  // Targeted TO search first
  var uids = await searchMsgs(imap, [["TO", accountEmail], ["SINCE", since]]);
  var narrowSearch = uids.length > 0;

  // Fallback: all recent emails (we'll filter by recipient after parsing)
  if (!uids.length) {
    uids = await searchMsgs(imap, [["SINCE", since]]);
  }
  if (!uids.length) return { found: false, message: "No emails in the last " + sinceHours + "h" };

  var toFetch = uids.slice(-200);
  var parsed_list = await fetchAndParse(imap, toFetch);

  var candidates = [];
  for (var i = 0; i < parsed_list.length; i++) {
    var parsed = parsed_list[i];
    var bodyText = parsed.text || "";
    var bodyHtml = parsed.html || "";

    // When using the broad fallback, only consider emails actually addressed to this account
    if (!narrowSearch) {
      var toAddrs = getAddresses(parsed.to).concat(getAddresses(parsed.cc));
      var inHeader = toAddrs.some(function(a) { return a === accountEmailLower; });
      if (!inHeader) {
        // Body fallback with word boundary
        var escaped = accountEmailLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        var re = new RegExp("(?:^|[^a-zA-Z0-9._%+\\-])" + escaped + "(?:[^a-zA-Z0-9._%+\\-]|$)", "i");
        if (!re.test(bodyText + " " + bodyHtml)) continue;
      }
    }

    if (!isPasswordResetEmail(parsed.subject, bodyText, bodyHtml)) continue;
    var link = extractNetflixResetLink(bodyText + " " + bodyHtml);
    if (link) candidates.push({ date: parsed.date || new Date(0), resetLink: link });
  }

  if (!candidates.length) return { found: false, message: "No Netflix reset link found for " + accountEmail };
  candidates.sort(function(a, b) { return new Date(b.date) - new Date(a.date); });
  return { found: true, resetLink: candidates[0].resetLink };
}

// Same but for new-device / sign-in emails
async function searchSignInLinkOnConnection(imap, accountEmail, sinceHours) {
  var accountEmailLower = accountEmail.toLowerCase();
  var since = new Date();
  since.setHours(since.getHours() - sinceHours);

  var uids = await searchMsgs(imap, [["TO", accountEmail], ["SINCE", since]]);
  var narrowSearch = uids.length > 0;

  if (!uids.length) {
    uids = await searchMsgs(imap, [["SINCE", since]]);
  }
  if (!uids.length) return { found: false, message: "No emails in the last " + sinceHours + "h" };

  var toFetch = uids.slice(-200);
  var parsed_list = await fetchAndParse(imap, toFetch);

  var candidates = [];
  for (var i = 0; i < parsed_list.length; i++) {
    var parsed = parsed_list[i];
    var bodyText = parsed.text || "";
    var bodyHtml = parsed.html || "";

    if (!narrowSearch) {
      var toAddrs = getAddresses(parsed.to).concat(getAddresses(parsed.cc));
      var inHeader = toAddrs.some(function(a) { return a === accountEmailLower; });
      if (!inHeader) {
        var escaped = accountEmailLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        var re = new RegExp("(?:^|[^a-zA-Z0-9._%+\\-])" + escaped + "(?:[^a-zA-Z0-9._%+\\-]|$)", "i");
        if (!re.test(bodyText + " " + bodyHtml)) continue;
      }
    }

    if (!isNewDeviceEmail(parsed.subject, bodyText, bodyHtml)) continue;
    var text = bodyText + " " + bodyHtml;
    var link = extractNetflixResetLink(text);
    if (link) candidates.push({ date: parsed.date || new Date(0), link: link, country: extractCountryFromSrc(text) });
  }

  if (!candidates.length) return { found: false, message: "No Netflix sign-in email found for " + accountEmail };
  candidates.sort(function(a, b) { return new Date(b.date) - new Date(a.date); });
  return { found: true, resetLink: candidates[0].link, country: candidates[0].country || null };
}

// ─── Public API ───────────────────────────────────────────────────────────────

async function fetchNetflixEmails(cred, sinceHours) {
  sinceHours = sinceHours || 24;
  let imap;
  try {
    imap = await connectImap(cred);
    await openInbox(imap);

    const since = new Date();
    since.setHours(since.getHours() - sinceHours);
    const uids = await searchMsgs(imap, [["SINCE", since]]);
    if (!uids.length) return { found: false, emails: [], message: "No emails in the last " + sinceHours + "h" };

    const toFetch = uids.slice(-500);
    var parsed_list = await fetchAndParse(imap, toFetch);

    var emails = [];
    for (var i = 0; i < parsed_list.length; i++) {
      var parsed = parsed_list[i];
      var bodyText = parsed.text || "";
      var bodyHtml = parsed.html || "";
      if (!isPasswordResetEmail(parsed.subject, bodyText, bodyHtml)) continue;
      var link = extractNetflixResetLink(bodyText + " " + bodyHtml);
      if (link) {
        emails.push({
          subject: (parsed.subject || "").replace(/^(fw|fwd)\s*:\s*/i, "").trim(),
          date: parsed.date || null,
          from: parsed.from ? parsed.from.text : "",
          resetLink: link,
        });
      }
    }

    emails.sort(function(a, b) { return new Date(b.date) - new Date(a.date); });
    var allReset = emails.map(function(e) { return e.resetLink; });
    return { found: allReset.length > 0, total: emails.length, emails: emails, resetLinks: allReset, message: allReset.length ? null : "No Netflix password reset emails in the last " + sinceHours + "h" };
  } finally {
    if (imap) disconnectImap(imap);
  }
}

async function testConnection(cred) {
  let imap;
  try {
    imap = await connectImap(cred);
    await openInbox(imap);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    if (imap) disconnectImap(imap);
  }
}

async function fetchResetLinkForAccount(cred, accountEmail, sinceHours) {
  sinceHours = sinceHours || 24;
  let imap;
  try {
    imap = await connectImap(cred);
    await openInbox(imap);
    return await searchResetLinkOnConnection(imap, accountEmail, sinceHours);
  } finally {
    if (imap) disconnectImap(imap);
  }
}

async function fetchSignInLinkForAccount(cred, accountEmail, sinceHours) {
  sinceHours = sinceHours || 24;
  let imap;
  try {
    imap = await connectImap(cred);
    await openInbox(imap);
    return await searchSignInLinkOnConnection(imap, accountEmail, sinceHours);
  } finally {
    if (imap) disconnectImap(imap);
  }
}

// ─── Bulk fetches using a concurrency pool ────────────────────────────────────
//
// Each worker opens its own IMAP connection, then processes accounts from the
// shared queue one by one — doing a targeted TO:email search for each one.
// This gives us accurate, per-account results without any text-matching guesswork.
// BULK_CONCURRENCY connections are held open simultaneously (default 5).

async function fetchResetLinksForAccounts(cred, accountEmails, sinceHours) {
  sinceHours = sinceHours || 2;
  var results = {};
  var queue = accountEmails.slice();

  async function worker() {
    let imap;
    try {
      imap = await connectImap(cred);
      await openInbox(imap);

      while (true) {
        var email = queue.shift();
        if (!email) break;
        try {
          var r = await searchResetLinkOnConnection(imap, email, sinceHours);
          if (r.found) results[email] = r.resetLink;
        } catch (err) {
          // Skip this account but keep the connection alive for the next one
        }
      }
    } catch (connErr) {
      // Connection failed — put remaining emails back so another worker can retry
      // (only if this worker died before processing anything)
    } finally {
      if (imap) disconnectImap(imap);
    }
  }

  var workers = [];
  var numWorkers = Math.min(BULK_CONCURRENCY, accountEmails.length);
  for (var i = 0; i < numWorkers; i++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  return {
    found: Object.keys(results).length > 0,
    matched: Object.keys(results).length,
    total: accountEmails.length,
    results: results,
    missing: accountEmails.filter(function(e) { return !results[e]; }),
  };
}

async function fetchSignInLinksForAccounts(cred, accountEmails, sinceHours) {
  sinceHours = sinceHours || 24;
  var results = {};
  var countries = {};
  var queue = accountEmails.slice();

  async function worker() {
    let imap;
    try {
      imap = await connectImap(cred);
      await openInbox(imap);

      while (true) {
        var email = queue.shift();
        if (!email) break;
        try {
          var r = await searchSignInLinkOnConnection(imap, email, sinceHours);
          if (r.found) {
            results[email] = r.resetLink;
            if (r.country) countries[email] = r.country;
          }
        } catch (err) {
          // Skip this account but keep the connection alive for the next one
        }
      }
    } catch (connErr) {
      // Connection failed
    } finally {
      if (imap) disconnectImap(imap);
    }
  }

  var workers = [];
  var numWorkers = Math.min(BULK_CONCURRENCY, accountEmails.length);
  for (var i = 0; i < numWorkers; i++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  return {
    found: Object.keys(results).length > 0,
    matched: Object.keys(results).length,
    total: accountEmails.length,
    results: results,
    countries: countries,
    missing: accountEmails.filter(function(e) { return !results[e]; }),
  };
}

module.exports = {
  fetchNetflixEmails,
  testConnection,
  fetchResetLinkForAccount,
  fetchResetLinksForAccounts,
  fetchSignInLinkForAccount,
  fetchSignInLinksForAccounts,
};
