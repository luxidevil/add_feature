const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { User, Setting } = require("../models");
const { logger } = require("./logger");

const DEFAULT_SETTINGS = [
  { key: "credit_cost_trigger_reset", value: "1" },
  { key: "credit_cost_change_password", value: "1.5" },
  { key: "credit_cost_check_email", value: "0.25" },
  { key: "credit_cost_signup_code", value: "4" },
  { key: "credits_per_dollar", value: "100" },
  { key: "min_credit_load", value: "500" },
  { key: "crypto_wallet", value: "0xf6276d548ad04e317bc5c67d18d34ddba36d1907" },
  { key: "testing_mode", value: "false" },
  { key: "concurrency_trigger_reset", value: "5" },
  { key: "concurrency_change_password", value: "5" },
  { key: "concurrency_check_email", value: "10" },
];

const SEED_USERS = [
  { username: "LUXIdepil", password: "DeepAK@4180", role: "admin", credits: 9999999 },
];

async function seedDatabase() {
  try {
    for (const u of SEED_USERS) {
      const existing = await User.findOne({ username: u.username });
      if (!existing) {
        const hash = await bcrypt.hash(u.password, 10);
        const apiKey = "dxb_" + crypto.randomBytes(16).toString("hex");
        await User.create({
          username: u.username,
          password: hash,
          role: u.role,
          credits: u.credits,
          apiKey,
        });
        logger.info(`User created: ${u.username} (${u.role})`);
      }
    }

    for (const setting of DEFAULT_SETTINGS) {
      const existing = await Setting.findOne({ key: setting.key });
      if (!existing) {
        await Setting.create(setting);
      } else if (setting.key === "crypto_wallet" && !existing.value) {
        await Setting.findOneAndUpdate({ key: setting.key }, { value: setting.value });
      }
    }

    const existingTestKey = await Setting.findOne({ key: "test_api_key" });
    if (!existingTestKey) {
      const testApiKey = "test_" + crypto.randomBytes(24).toString("hex");
      await Setting.create({ key: "test_api_key", value: testApiKey });
      logger.info(`Test API key generated: ${testApiKey}`);
    }

    const deadKeys = ['service_url_trigger_reset','service_url_change_password','service_url_check_email','service_allowed_ips'];
    await Setting.deleteMany({ key: { $in: deadKeys } });

    logger.info("Database seeded successfully");
  } catch (err) {
    logger.error({ err }, "Failed to seed database");
  }
}

module.exports = { seedDatabase };
