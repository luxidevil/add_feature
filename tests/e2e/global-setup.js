const { startAll } = require("../mock-droplets");

let servers = [];

module.exports = async function globalSetup() {
  servers = await startAll();
  global.__MOCK_SERVERS__ = servers;

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
      droplet_trigger_reset: "http://localhost:4001",
      droplet_change_password: "http://localhost:4002",
      droplet_check_email: "http://localhost:4003",
    }),
  });

  console.log("Global setup complete: mock droplets started, URLs pointed to mocks");
};
