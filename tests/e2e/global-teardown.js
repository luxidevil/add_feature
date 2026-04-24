module.exports = async function globalTeardown() {
  const resp = await fetch("http://localhost:5000/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "LUXIdepil", password: "DeepAK@4180" }),
  });
  const { token } = await resp.json();

  await fetch("http://localhost:5000/api/admin/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      droplet_trigger_reset: "http://142.93.4.225:3000",
      droplet_change_password: "http://159.89.172.195:3000",
      droplet_check_email: "http://139.59.42.65:3000",
    }),
  });

  if (global.__MOCK_SERVERS__) {
    for (const s of global.__MOCK_SERVERS__) s.close();
  }

  console.log("Global teardown: restored original droplet URLs, stopped mocks");
};
