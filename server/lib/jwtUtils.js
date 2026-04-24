const jwt = require("jsonwebtoken");

const SECRET = process.env.SESSION_SECRET || "dealer-dxb-secret-key";

function signToken(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: "7d" });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, SECRET);
  } catch {
    return null;
  }
}

module.exports = { signToken, verifyToken };
