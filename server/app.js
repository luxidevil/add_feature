const express = require("express");
const cors = require("cors");
const pinoHttp = require("pino-http");
const path = require("path");
const fs = require("fs");
const router = require("./routes");
const { logger } = require("./lib/logger");

const app = express();

// Reject malformed URIs (e.g. bot probes with overlong UTF-8 like %c0%a0)
// BEFORE Express's router tries to decodeURIComponent them and throws an
// uncaught URIError that crashes the process. Returns 400 cleanly.
app.use((req, res, next) => {
  try {
    decodeURIComponent(req.path);
    next();
  } catch {
    res.status(400).type("text/plain").send("Bad Request");
  }
});

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  })
);
app.use(cors());
// 10mb limit so customers can paste large bulk lists (200+ emails per request
// in TR / CP / Sign-in Code / IMAP) without hitting Express's default 100kb
// PayloadTooLargeError. Each email line is ~80 bytes so 10mb covers ~130k rows.
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.get("/api/public/concurrency", async (req, res) => {
  try {
    const { Setting } = require("./models");
    const trRow = await Setting.findOne({ key: "concurrency_trigger_reset" }).lean();
    const vmRow = await Setting.findOne({ key: "concurrency_check_email" }).lean();
    res.json({
      trigger_reset: parseInt(trRow?.value) || 5,
      check_email: parseInt(vmRow?.value) || 10,
    });
  } catch {
    res.json({ trigger_reset: 5, check_email: 10 });
  }
});

app.use("/api", router);

app.use(express.static(path.join(__dirname, "..", "public"), {
  setHeaders: (res, filePath) => {
    if (filePath.includes("/assets/")) {
      res.setHeader("Cache-Control", "no-cache, must-revalidate");
    }
  }
}));

app.get("/deepdevilmin", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "deepdevilmin.html"));
});

app.get("/{*wildcard}", (req, res) => {
  const htmlPath = path.join(__dirname, "..", "public", "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  const loader = `<script>try{var x=new XMLHttpRequest();x.open("GET","/api/public/concurrency",false);x.send();window._CC=JSON.parse(x.responseText)}catch(e){}</script>`;
  res.type("html").send(html.replace("</head>", loader + "</head>"));
});

module.exports = app;
