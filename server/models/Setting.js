const mongoose = require("mongoose");

const settingSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: String, default: "" },
});

const Setting = mongoose.model("Setting", settingSchema);
module.exports = { Setting };
