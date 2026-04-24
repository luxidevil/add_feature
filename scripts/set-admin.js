require('dotenv').config();
const mongoose = require('mongoose');
const { connectDB } = require('../server/lib/db');
const { User } = require('../server/models/User');

const username = process.argv[2];
if (!username) {
  console.error('Usage: node scripts/set-admin.js <username>');
  process.exit(1);
}

connectDB().then(async () => {
  const user = await User.findOneAndUpdate(
    { username },
    { role: 'admin' },
    { new: true }
  );
  if (!user) {
    console.error(`User "${username}" not found.`);
    process.exit(1);
  }
  console.log(`Done — ${user.username} is now role: ${user.role}`);
  process.exit(0);
}).catch(err => {
  console.error('DB error:', err.message);
  process.exit(1);
});
