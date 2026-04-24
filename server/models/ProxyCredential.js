const mongoose = require("mongoose");

const proxyCredentialSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
  host: { type: String, required: true },
  port: { type: String, required: true },
  username: { type: String, required: true },
  password: { type: String, required: true },
}, { timestamps: true });

const ProxyCredential = mongoose.model("ProxyCredential", proxyCredentialSchema);
module.exports = { ProxyCredential };
