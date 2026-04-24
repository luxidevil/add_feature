const express = require("express");
const https = require("https");
const router = express.Router();

function httpsRequest(options, postData) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error("Invalid JSON: " + data.substring(0, 200)));
        }
      });
    });
    req.on("error", reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function getAccessToken() {
  const postData = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: process.env.GMAIL_REFRESH_TOKEN,
    grant_type: "refresh_token",
  }).toString();

  const token = await httpsRequest(
    {
      hostname: "oauth2.googleapis.com",
      path: "/token",
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": postData.length,
      },
    },
    postData
  );

  if (token.error) throw new Error("Token error: " + token.error_description);
  return token.access_token;
}

function getBody(payload) {
  if (payload.body?.data)
    return Buffer.from(payload.body.data, "base64url").toString();
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return Buffer.from(part.body.data, "base64url").toString();
      }
    }
    for (const part of payload.parts) {
      const result = getBody(part);
      if (result) return result;
    }
  }
  return null;
}

function extractCode(body) {
  const patterns = [
    /(?:sign[- ]?in code|verification code|code is)[:\s]*(\d{4,8})/i,
    /\n(\d{4,8})\n/,
    /^(\d{4,8})$/m,
  ];
  for (const p of patterns) {
    const m = body.match(p);
    if (m) return m[1];
  }
  return null;
}

router.get("/fetch-code", async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: "email parameter required" });

  try {
    const accessToken = await getAccessToken();

    const query = encodeURIComponent(
      `from:info@account.netflix.com to:${email} (subject:"sign-in code" OR subject:"temporary access code") newer_than:1h`
    );
    const msgs = await httpsRequest({
      hostname: "gmail.googleapis.com",
      path: `/gmail/v1/users/me/messages?maxResults=5&q=${query}`,
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!msgs.messages || msgs.messages.length === 0) {
      return res.json({ found: false, email, message: "No Netflix code email found for this address in the last hour" });
    }

    for (const msg of msgs.messages) {
      const detail = await httpsRequest({
        hostname: "gmail.googleapis.com",
        path: `/gmail/v1/users/me/messages/${msg.id}?format=full`,
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      const headers = detail.payload?.headers || [];
      const toHeader = headers.find((h) => h.name.toLowerCase() === "to")?.value || "";
      const dateHeader = headers.find((h) => h.name.toLowerCase() === "date")?.value || "";
      const subject = headers.find((h) => h.name.toLowerCase() === "subject")?.value || "";

      if (!toHeader.toLowerCase().includes(email.toLowerCase())) continue;

      const body = getBody(detail.payload);
      if (!body) continue;

      const code = extractCode(body);
      if (code) {
        return res.json({
          found: true,
          email,
          code,
          subject,
          date: dateHeader,
          messageId: msg.id,
        });
      }
    }

    return res.json({ found: false, email, message: "Netflix emails found but could not extract code" });
  } catch (err) {
    console.error("Gmail fetch-code error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

router.get("/fetch-code-poll", async (req, res) => {
  const { email, timeout } = req.query;
  if (!email) return res.status(400).json({ error: "email parameter required" });

  const maxWait = Math.min(parseInt(timeout) || 120, 300) * 1000;
  const pollInterval = 5000;
  const startTime = Date.now();

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const sendEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  sendEvent({ status: "polling", email, message: "Waiting for Netflix code..." });

  const poll = async () => {
    try {
      const accessToken = await getAccessToken();
      const sinceTs = Math.floor(startTime / 1000);
      const query = encodeURIComponent(
        `from:info@account.netflix.com to:${email} (subject:"sign-in code" OR subject:"temporary access code") after:${sinceTs}`
      );

      const msgs = await httpsRequest({
        hostname: "gmail.googleapis.com",
        path: `/gmail/v1/users/me/messages?maxResults=3&q=${query}`,
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (msgs.messages && msgs.messages.length > 0) {
        for (const msg of msgs.messages) {
          const detail = await httpsRequest({
            hostname: "gmail.googleapis.com",
            path: `/gmail/v1/users/me/messages/${msg.id}?format=full`,
            method: "GET",
            headers: { Authorization: `Bearer ${accessToken}` },
          });

          const headers = detail.payload?.headers || [];
          const toHeader = headers.find((h) => h.name.toLowerCase() === "to")?.value || "";
          const dateHeader = headers.find((h) => h.name.toLowerCase() === "date")?.value || "";

          if (!toHeader.toLowerCase().includes(email.toLowerCase())) continue;

          const body = getBody(detail.payload);
          if (!body) continue;

          const code = extractCode(body);
          if (code) {
            sendEvent({ status: "found", email, code, date: dateHeader, messageId: msg.id });
            res.end();
            return;
          }
        }
      }

      const elapsed = Date.now() - startTime;
      if (elapsed >= maxWait) {
        sendEvent({ status: "timeout", email, message: `No code found after ${Math.round(elapsed / 1000)}s` });
        res.end();
        return;
      }

      sendEvent({ status: "polling", elapsed: Math.round(elapsed / 1000), message: "Still waiting..." });
      setTimeout(poll, pollInterval);
    } catch (err) {
      sendEvent({ status: "error", message: err.message });
      res.end();
    }
  };

  setTimeout(poll, 2000);

  req.on("close", () => {});
});

router.get("/inbox", async (req, res) => {
  const { email, limit } = req.query;

  try {
    const accessToken = await getAccessToken();
    let query = "from:info@account.netflix.com";
    if (email) query += ` to:${email}`;
    const encodedQuery = encodeURIComponent(query);
    const maxResults = Math.min(parseInt(limit) || 10, 50);

    const msgs = await httpsRequest({
      hostname: "gmail.googleapis.com",
      path: `/gmail/v1/users/me/messages?maxResults=${maxResults}&q=${encodedQuery}`,
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!msgs.messages) return res.json({ emails: [], total: 0 });

    const emails = [];
    for (const msg of msgs.messages) {
      const detail = await httpsRequest({
        hostname: "gmail.googleapis.com",
        path: `/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      const headers = detail.payload?.headers || [];
      emails.push({
        id: msg.id,
        from: headers.find((h) => h.name === "From")?.value,
        to: headers.find((h) => h.name === "To")?.value,
        subject: headers.find((h) => h.name === "Subject")?.value,
        date: headers.find((h) => h.name === "Date")?.value,
      });
    }

    return res.json({ emails, total: msgs.resultSizeEstimate });
  } catch (err) {
    console.error("Gmail inbox error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
