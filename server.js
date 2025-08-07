// server.js
// MicStream Server with on‑the‑fly WAV containerization

const express   = require("express");
const http      = require("http");
const WebSocket = require("ws");
const path      = require("path");
const fs        = require("fs");
const wav       = require("wav");
const multer    = require("multer");

const app = express();
const PORT = 3000;

// Folders for .wav files
const STREAMS_DIR    = path.join(__dirname, "streams");
const RECORDINGS_DIR = path.join(__dirname, "recordings");
for (const dir of [STREAMS_DIR, RECORDINGS_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Configure Multer for raw file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, RECORDINGS_DIR);
  },
  filename: function (req, file, cb) {
    // Save as .raw first; we'll convert to .wav after
    cb(null, file.originalname);
  }
});
const upload = multer({ storage });

// REST endpoint for file uploads
app.post("/upload", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).send("No file uploaded.");
  }

  const rawPath = path.join(RECORDINGS_DIR, req.file.filename);
  const wavName = req.file.filename.replace(/\.raw$/, ".wav");
  const wavPath = path.join(RECORDINGS_DIR, wavName);

  // Convert raw PCM to WAV
  const input = fs.createReadStream(rawPath);
  const writer = new wav.FileWriter(wavPath, {
    sampleRate: 16000,
    channels:   1,
    bitDepth:   16
  });

  input.pipe(writer);

  writer.on("finish", () => {
    fs.unlinkSync(rawPath); // Remove original raw
    console.log(`→ Uploaded offline recording saved as ${wavName}`);
    res.json({ success: true, file: `/recordings/${wavName}` });
  });

  writer.on("error", (err) => {
    console.error("WAV conversion error:", err);
    res.status(500).send("WAV conversion failed.");
  });
});

// Serve dashboard UI & static assets
app.use(express.static(path.join(__dirname, "public")));

// Serve the .wav files
app.use("/streams",    express.static(STREAMS_DIR));
app.use("/recordings", express.static(RECORDINGS_DIR));

// REST endpoints for listing files
app.get("/api/past-streams", (req, res) => {
  const files = fs.readdirSync(STREAMS_DIR)
    .filter(f => f.endsWith(".wav"))
    .sort().reverse()
    .map(f => ({ name: f, url: `/streams/${f}` }));
  res.json(files);
});
app.get("/api/recordings", (req, res) => {
  const files = fs.readdirSync(RECORDINGS_DIR)
    .filter(f => f.endsWith(".wav"))
    .sort().reverse()
    .map(f => ({ name: f, url: `/recordings/${f}` }));
  res.json(files);
});

// Create HTTP + WebSocket server
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });

// Track dashboard clients for live‑forwarding & notifications
const dashClients = new Set();

// Format timestamp for filenames
function ts() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

// Handle each WebSocket connection
wss.on("connection", (ws) => {
  console.log("WS client connected");
  let mode        = "unknown";     // "dashboard" | "upload" | "live"
  let wavWriter   = null;          // wav.FileWriter instance

  ws.on("message", (msg) => {
    // Text control messages:
    if (typeof msg === "string") {
      if (msg === "BROWSER_CLIENT") {
        mode = "dashboard";
        dashClients.add(ws);
        console.log("→ Registered dashboard client");
      }
      return;
    }

    // Binary PCM frames:
    const buffer = Buffer.from(msg);

    if (mode !== "live") {
      // First chunk => start new live WAV file
      mode = "live";
      const name = `livestream_${ts()}.wav`;
      const outPath = path.join(STREAMS_DIR, name);
      wavWriter = new wav.FileWriter(outPath, {
        sampleRate: 16000,
        channels:   1,
        bitDepth:   16
      });
      console.log(`→ Started live WAV: ${name}`);
    }

    // Write to live WAV and forward to dashboards
    wavWriter.write(buffer);
    dashClients.forEach(c => {
      if (c.readyState === WebSocket.OPEN) {
        c.send(buffer);
      }
    });
  });

  ws.on("close", () => {
    console.log("WS client disconnected");
    dashClients.delete(ws);

    if (mode === "live" && wavWriter) {
      wavWriter.end();
      wavWriter = null;
      console.log("→ Finalized live WAV");
      const evt = JSON.stringify({ type: "new_stream" });
      dashClients.forEach(c => c.readyState === WebSocket.OPEN && c.send(evt));
    }
  });
});

// Start listening
server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
