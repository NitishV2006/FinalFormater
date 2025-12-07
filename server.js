import express from 'express';
import cors from 'cors';
import multer from 'multer';
import mammoth from 'mammoth';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

// Initialize App
const app = express();
const PORT = process.env.PORT || 4000;

// ---------- STATIC FRONTEND SETUP ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve built Vite frontend from /dist
app.use(express.static(path.join(__dirname, 'dist')));
// -------------------------------------------

// Setup Multer for memory storage (files stored in RAM as buffers)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Initialize Gemini Client
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' }); // or gemini-1.5-flash

// System Prompt
const SYSTEM_PROMPT = `
You are "FinalFormatter", an AI that does 3 things in sequence:

1) If I upload a file (PDF, DOCX, image), first EXTRACT ALL TEXT from the document.
   - Do NOT summarize.
   - Do NOT correct anything.
   - Just extract the raw text as it appears.

2) Then, based on my instructions, CLEAN and FORMAT that text:
   - Fix grammar and readability only if I ask for it.
   - Apply headings, sections, bullets, spacing, and tone according to my instructions.
   - Preserve the original meaning.
   - Do NOT add new ideas unless I clearly ask.

3) Finally, give me the result as plain text that I can directly paste into MS Word or Google Docs:
   - NO markdown symbols (#, ##, *, -) unless I explicitly ask for markdown.
   - Use simple headings like: INTRODUCTION:, CONTEXT:, SUMMARY:, etc.
   - Use simple bullets like: • item

VERY IMPORTANT:
- Do NOT explain what you did.
- Do NOT add any commentary like “Here is your formatted text”.
- OUTPUT MUST BE ONLY THE FINAL DOCUMENT CONTENT, ready to export.
`;

// --------- API: /api/format ----------
app.post('/api/format', upload.single('file'), async (req, res) => {
  try {
    let { content, instructions } = req.body;
    const file = req.file;

    if (!instructions) {
      return res.status(400).json({ error: 'Missing formatting instructions.' });
    }

    const parts = [];
    parts.push({ text: `INSTRUCTIONS:\n${instructions}` });

    if (file) {
      const mimeType = file.mimetype;

      if (mimeType === 'application/pdf' || mimeType.startsWith('image/')) {
        parts.push({
          inlineData: {
            mimeType,
            data: file.buffer.toString('base64'),
          },
        });
      } else if (
        mimeType ===
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ) {
        const result = await mammoth.extractRawText({ buffer: file.buffer });
        parts.push({ text: `DOCUMENT CONTENT:\n${result.value}` });
      } else if (mimeType === 'text/plain') {
        parts.push({ text: `DOCUMENT CONTENT:\n${file.buffer.toString('utf-8')}` });
      } else {
        return res
          .status(400)
          .json({ error: 'Unsupported file type. Please upload PDF, DOCX, Image, or Text.' });
      }
    } else if (content) {
      parts.push({ text: `DOCUMENT CONTENT:\n${content}` });
    } else {
      return res
        .status(400)
        .json({ error: 'Please provide either a file or document text.' });
    }

    const result = await model.generateContent({
      contents: [
        {
          role: 'user',
          parts,
        },
      ],
      systemInstruction: SYSTEM_PROMPT,
    });

    const formattedText = result.response.text();

    if (!formattedText) {
      throw new Error('AI returned empty response.');
    }

    res.json({ formattedContent: formattedText });
  } catch (error) {
    console.error('Processing Error:', error);
    res.status(500).json({
      error: 'Internal Processing Error',
      details: error.message,
    });
  }
});

// ---------- CATCH-ALL: SERVE FRONTEND ----------
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// ---------- START SERVER ----------
app.listen(PORT, () => {
  console.log(`FinalFormatter Backend running on http://localhost:${PORT}`);
});
