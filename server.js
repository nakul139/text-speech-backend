require("dotenv").config(); // Load environment variables at the top

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");
const rateLimit = require("express-rate-limit");

const app = express();
const PORT = process.env.PORT || 5000;
const ASSEMBLYAI_API_KEY = process.env.ASSEMBLYAI_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

// 🚨 Check for missing API keys
if (!ASSEMBLYAI_API_KEY || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("⚠️ Error: Missing API keys or Supabase credentials. Check .env");
  process.exit(1);
}

// Initialize Supabase
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Middleware setup
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 🔐 Rate Limiting (100 requests per 15 minutes)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 100, // Limit each IP
  message: "Too many requests, please try again later.",
});
app.use(limiter);

// Multer setup for handling file uploads in memory
const upload = multer({ storage: multer.memoryStorage() });

// ✅ Debugging log
console.log("✅ Registering API routes...");

// 🏠 **Root Route (Health Check)**
app.get("/", (req, res) => {
  res.send("<h1>Speech-to-Text API</h1><p>Welcome to the Transcription Backend.</p>");
});

// 🎤 **POST /transcribe - Upload & Transcribe Audio**
app.post("/transcribe", upload.single("audio"), async (req, res, next) => {
  try {
    console.log("🎤 Received a request to /transcribe");

    if (!req.file) {
      throw new Error("No file uploaded");
    }

    console.log(`📂 Processing file: ${req.file.originalname}`);

    // 1️⃣ Upload audio file to AssemblyAI
    const uploadResponse = await axios.post(
      "https://api.assemblyai.com/v2/upload",
      req.file.buffer,
      {
        headers: {
          Authorization: ASSEMBLYAI_API_KEY,
          "Content-Type": "application/octet-stream",
        },
      }
    );

    const audioUrl = uploadResponse.data.upload_url;
    console.log(`🔼 Uploaded to AssemblyAI: ${audioUrl}`);

    // 2️⃣ Request transcription
    const transcriptResponse = await axios.post(
      "https://api.assemblyai.com/v2/transcript",
      { audio_url: audioUrl },
      { headers: { Authorization: ASSEMBLYAI_API_KEY } }
    );

    const transcriptId = transcriptResponse.data.id;
    console.log(`📜 Transcription started with ID: ${transcriptId}`);

    // 3️⃣ Polling AssemblyAI for result
    const MAX_RETRIES = 20;
    let attempts = 0;
    let transcriptResult = null;

    while (attempts < MAX_RETRIES) {
      await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait 5 seconds
      const pollingResponse = await axios.get(
        `https://api.assemblyai.com/v2/transcript/${transcriptId}`,
        { headers: { Authorization: ASSEMBLYAI_API_KEY } }
      );

      if (pollingResponse.data.status === "completed") {
        transcriptResult = pollingResponse.data.text;
        break;
      } else if (pollingResponse.data.status === "failed") {
        throw new Error("Transcription failed");
      }

      attempts++;
    }

    if (!transcriptResult) {
      throw new Error("Transcription polling timed out.");
    }

    console.log("✅ Transcription completed:", transcriptResult);

    // 4️⃣ Save transcription to Supabase
    const { error } = await supabase
      .from("transcriptions")
      .insert([{ transcription: transcriptResult, created_at: new Date() }]);

    if (error) throw new Error(`Supabase Insert Error: ${error.message}`);

    console.log("📥 Transcription saved to Supabase.");
    res.json({ transcription: transcriptResult });
  } catch (error) {
    next(error);
  }
});

// 📝 **GET /transcriptions - Fetch All Transcriptions**
app.get("/transcriptions", async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("transcriptions")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw new Error(`Supabase Fetch Error: ${error.message}`);

    res.json(data);
  } catch (error) {
    next(error);
  }
});

// ❌ **DELETE /transcriptions/:id - Delete One Transcription**
app.delete("/transcriptions/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const { error } = await supabase.from("transcriptions").delete().match({ id });

    if (error) throw new Error(`Supabase Delete Error: ${error.message}`);

    console.log(`🗑️ Deleted transcription with ID: ${id}`);
    res.json({ message: "Transcription deleted successfully" });
  } catch (error) {
    next(error);
  }
});

// ❌ **DELETE /transcriptions - Delete All Transcriptions**
app.delete("/transcriptions", async (req, res, next) => {
  try {
    const { error } = await supabase.from("transcriptions").delete().not("id", "is", null);

    if (error) throw new Error(`Supabase Delete Error: ${error.message}`);

    console.log("🗑️ Cleared all transcriptions.");
    res.json({ message: "All transcriptions deleted successfully" });
  } catch (error) {
    next(error);
  }
});

// ⚠️ **Global Error Handler Middleware**
app.use((err, req, res, next) => {
  console.error("❌ Error:", err.message);
  res.status(500).json({ error: err.message || "Internal Server Error" });
});

// ✅ **Start the server**
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
