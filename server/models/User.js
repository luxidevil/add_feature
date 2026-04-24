const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, required: true, default: "user" },
  credits: { type: Number, required: true, default: 0 },
  apiKey: { type: String, required: true, unique: true },
  promoCode: { type: String, default: null },
}, { timestamps: true });

const User = mongoose.model("User", userSchema);
module.exports = { User };
