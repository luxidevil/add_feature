const mongoose = require("mongoose");
const { logger } = require("./logger");

async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI environment variable is required");
  }
  try {
    await mongoose.connect(uri);
    logger.info("Connected to MongoDB");
  } catch (err) {
    logger.error({ err }, "Failed to connect to MongoDB");
    throw err;
  }
}

module.exports = { connectDB };
