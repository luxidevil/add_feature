const mongoose = require("mongoose");

const logSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  type: { type: String, required: true },
  email: { type: String, default: null },
  status: { type: String, required: true },
  result: { type: mongoose.Schema.Types.Mixed, default: {} },
  creditsUsed: { type: Number, required: true, default: 0 },
  balanceAfter: { type: Number, default: null },
}, { timestamps: true });

const Log = mongoose.model("Log", logSchema);
module.exports = { Log };
