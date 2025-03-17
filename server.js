require("dotenv").config(); // Load environment variables at the top

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 5000;
const ASSEMBLYAI_API_KEY = process.env.ASSEMBLYAI_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

// Debug: Ensure API keys are loaded
if (!ASSEMBLYAI_API_KEY || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error(
    "⚠️ Error: Missing required API keys or Supabase credentials. Check your .env file."
  );
  process.exit(1);
}

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Middleware
app.use(cors());
app.use(express.json());

// Setup Multer for memory storage (no local storage)
const upload = multer({ storage: multer.memoryStorage() });

// AssemblyAI API Route for Transcription
app.post("/transcribe", upload.single("audio"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  try {
    console.log(`📂 Received audio file: ${req.file.originalname}`);

    // Upload file directly to AssemblyAI
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
    console.log(`🔼 File uploaded to AssemblyAI: ${audioUrl}`);

    // Request transcription
    const transcriptResponse = await axios.post(
      "https://api.assemblyai.com/v2/transcript",
      {
        audio_url: audioUrl,
      },
      {
        headers: { Authorization: ASSEMBLYAI_API_KEY },
      }
    );

    const transcriptId = transcriptResponse.data.id;
    console.log(`📜 Transcription started with ID: ${transcriptId}`);

    // Poll for transcription result
    let transcriptResult;
    while (true) {
      await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait 5 seconds
      const pollingResponse = await axios.get(
        `https://api.assemblyai.com/v2/transcript/${transcriptId}`,
        {
          headers: { Authorization: ASSEMBLYAI_API_KEY },
        }
      );

      if (pollingResponse.data.status === "completed") {
        transcriptResult = pollingResponse.data.text;
        break;
      } else if (pollingResponse.data.status === "failed") {
        throw new Error("Transcription failed");
      }
    }

    console.log("✅ Transcription completed:", transcriptResult);

    // Save transcription to Supabase
    const { error } = await supabase
      .from("transcriptions")
      .insert([{ transcription: transcriptResult, created_at: new Date() }]);

    if (error) {
      throw new Error(`Supabase Insert Error: ${error.message}`);
    }

    console.log("📥 Transcription saved to Supabase.");
    res.json({ transcription: transcriptResult });
  } catch (error) {
    console.error(
      "❌ Error transcribing audio:",
      error.response?.data || error.message
    );
    res
      .status(500)
      .json({ error: error.response?.data || "Failed to transcribe audio" });
  }
});

// API route endpoints
app.get("/", (req, res) => {
  res.send(
    "<h1>Speech-to-Text Transcription API</h1><p>Welcome to the Speech-to-Text Transcription Backend.</p>"
  );
});

// Fetch previous transcriptions
app.get("/transcriptions", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("transcriptions")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(`Supabase Fetch Error: ${error.message}`);
    }

    res.json(data);
  } catch (error) {
    console.error("❌ Error fetching transcriptions:", error);
    res.status(500).json({ error: "Failed to fetch transcriptions" });
  }
});

// Delete a Single Transcription
app.delete("/transcriptions/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const { error } = await supabase
      .from("transcriptions")
      .delete()
      .match({ id });

    if (error) {
      throw new Error(`Supabase Delete Error: ${error.message}`);
    }

    console.log(`🗑️ Deleted transcription with ID: ${id}`);
    res.json({ message: "Transcription deleted successfully" });
  } catch (error) {
    console.error("❌ Error deleting transcription:", error);
    res.status(500).json({ error: "Failed to delete transcription" });
  }
});

// Delete All Transcriptions
app.delete("/transcriptions", async (req, res) => {
  try {
    const { error } = await supabase
      .from("transcriptions")
      .delete()
      .neq("id", 0);

    if (error) {
      throw new Error(`Supabase Delete All Error: ${error.message}`);
    }

    console.log("🗑️ Cleared all transcriptions.");
    res.json({ message: "All transcriptions deleted successfully" });
  } catch (error) {
    console.error("❌ Error clearing transcriptions:", error);
    res.status(500).json({ error: "Failed to clear all transcriptions" });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
});
