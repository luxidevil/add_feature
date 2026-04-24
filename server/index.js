require("dotenv").config();
const app = require("./app");
const { connectDB } = require("./lib/db");
const { logger } = require("./lib/logger");
const { seedDatabase } = require("./lib/seed");

// Last-resort safety net so a single bad request (e.g. bot probe with a
// malformed URI) cannot restart-loop the process to PM2's give-up threshold
// and take the whole site offline. We log and stay alive.
process.on("uncaughtException", (err) => {
  logger.error({ err: { message: err.message, stack: err.stack, name: err.name } }, "uncaughtException — staying alive");
});
process.on("unhandledRejection", (reason) => {
  logger.error({ reason: reason instanceof Error ? reason.message : String(reason) }, "unhandledRejection — staying alive");
});

const port = Number(process.env.PORT) || 5000;

connectDB()
  .then(() => {
    app.listen(port, "0.0.0.0", () => {
      logger.info({ port }, "DEALER-DXB Dashboard listening");
      seedDatabase().catch((e) => logger.error({ e }, "Seed failed"));
    });
  })
  .catch((err) => {
    logger.error({ err }, "Failed to start server");
    process.exit(1);
  });
