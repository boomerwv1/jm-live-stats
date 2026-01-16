// Runs the Players image server AND the CSV bridge together
// Ctrl+C stops both
// ✅ Updated to use scripts from repo location (but still writes to C:\Broadcast)

const { spawn } = require("child_process");
const path = require("path");

// Get the directory where this script lives (repo scripts folder)
const SCRIPT_DIR = __dirname;

function start(name, cmd, args) {
  console.log(`[${name}] starting: ${cmd} ${args.join(" ")}`);
  const p = spawn(cmd, args, { stdio: "inherit", shell: true, cwd: SCRIPT_DIR });
  p.on("exit", code => console.log(`[${name}] exited (${code})`));
  return p;
}

// ✅ Use scripts from repo location
const playersServer = start(
  "PLAYERS_SERVER",
  "node",
  [path.join(SCRIPT_DIR, "jm_players_server.js")]
);

const bridge = start(
  "BRIDGE",
  "node",
  [path.join(SCRIPT_DIR, "jm_titler_bridge.js")]
);

function shutdown() {
  console.log("Shutting down...");
  playersServer.kill();
  bridge.kill();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
