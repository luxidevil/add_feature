const mongoose = require("mongoose");

const imapCredentialSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  provider: { type: String, required: true, default: "gmail" },
  email: { type: String, required: true },
  password: { type: String, required: true },
  imapHost: { type: String, default: null },
  imapPort: { type: Number, default: null },
}, { timestamps: true });

const ImapCredential = mongoose.model("ImapCredential", imapCredentialSchema);
module.exports = { ImapCredential };
