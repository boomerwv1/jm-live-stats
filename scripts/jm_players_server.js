// Serves C:\Broadcast\Players over HTTP at http://localhost:8085/Players/<file>
// ✅ Still serves from C:\Broadcast\Players\web (for NewBlue Titler)

const express = require("express");
const path = require("path");

const PORT = 8085;
// ✅ Still serves from C:\Broadcast\Players\web (player images stay there)
const PLAYERS_DIR = "C:\\Broadcast\\Players\\web";

const app = express();

// Serve the folder at /Players
app.use("/Players", express.static(PLAYERS_DIR, {
  fallthrough: true,
  etag: true,
  maxAge: "1h",
}));

// Health check
app.get("/health", (req, res) => res.status(200).send("OK"));

app.listen(PORT, () => {
  console.log(`JM Players server running: http://localhost:${PORT}/Players/`);
  console.log(`Serving from: ${PLAYERS_DIR}`);
});
