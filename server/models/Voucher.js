const mongoose = require("mongoose");

const voucherSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true },
  credits: { type: Number, required: true },
  used: { type: Boolean, default: false },
  usedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  usedAt: { type: Date, default: null },
}, { timestamps: true });

const Voucher = mongoose.model("Voucher", voucherSchema);
module.exports = { Voucher };
