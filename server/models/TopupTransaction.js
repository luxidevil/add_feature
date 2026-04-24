const mongoose = require("mongoose");

const schema = new mongoose.Schema({
  txHash: { type: String, required: true, unique: true, lowercase: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  usdtAmount: { type: Number, required: true },
  creditsAdded: { type: Number, required: true },
  fromAddress: { type: String },
  createdAt: { type: Date, default: Date.now },
});

module.exports = { TopupTransaction: mongoose.model("TopupTransaction", schema) };
