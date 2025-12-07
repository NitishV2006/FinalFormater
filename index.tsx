
import React, { useState, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI } from "@google/genai";
import mammoth from 'mammoth';

// --- System Prompt ---
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

// --- Styles ---
const styles = {
  container: {
    fontFamily: '"SF Mono", "Roboto Mono", monospace',
    backgroundColor: '#000000',
    color: '#ffffff',
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column' as const,
    boxSizing: 'border-box' as const,
  },
  header: {
    borderBottom: '1px solid #ffffff',
    padding: '1.5rem 2rem',
    display: 'flex',
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    background: '#000000',
  },
  title: {
    fontSize: '1.5rem',
    fontWeight: '700',
    margin: 0,
    color: '#ffffff',
    letterSpacing: '-1px',
    textTransform: 'uppercase' as const,
  },
  subtitle: {
    color: '#aaaaaa',
    margin: 0,
    fontSize: '0.8rem',
    textTransform: 'uppercase' as const,
    letterSpacing: '1px',
  },
  main: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '0',
    flex: 1,
    minHeight: 0, 
  },
  column: {
    display: 'flex',
    flexDirection: 'column' as const,
    padding: '2rem',
    gap: '1.5rem',
    height: '100%',
    boxSizing: 'border-box' as const,
    position: 'relative' as const,
    borderRight: '1px solid #ffffff',
  },
  sectionTitle: {
    fontSize: '0.8rem',
    fontWeight: '600',
    color: '#ffffff',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.2em',
    marginBottom: '0.5rem',
    display: 'flex',
    alignItems: 'center' as const,
    gap: '0.5rem',
    borderBottom: '1px solid #333',
    paddingBottom: '0.5rem',
  },
  textarea: {
    width: '100%',
    flex: 1,
    padding: '1.5rem',
    borderRadius: '0px',
    border: '1px solid #333',
    fontSize: '0.95rem',
    lineHeight: '1.6',
    resize: 'none' as const,
    fontFamily: 'inherit',
    outline: 'none',
    transition: 'all 0.2s',
    backgroundColor: '#000000',
    color: '#ffffff',
  },
  inputGroup: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '1rem',
    flex: 1,
  },
  fileInputLabel: {
    display: 'flex',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    padding: '2rem',
    border: '1px dashed #ffffff',
    borderRadius: '0px',
    cursor: 'pointer',
    color: '#ffffff',
    transition: 'all 0.2s',
    backgroundColor: '#000000',
  },
  fileInputLabelActive: {
    borderColor: '#ffffff',
    backgroundColor: '#111',
  },
  hiddenInput: {
    display: 'none',
  },
  instructions: {
    width: '100%',
    padding: '1rem',
    borderRadius: '0px',
    border: '1px solid #ffffff',
    backgroundColor: '#000000',
    color: '#ffffff',
    fontSize: '0.9rem',
    fontFamily: 'inherit',
    minHeight: '100px',
    resize: 'none' as const,
  },
  button: {
    backgroundColor: '#000000',
    color: '#ffffff',
    border: '1px solid #ffffff',
    padding: '1rem',
    borderRadius: '0px',
    fontSize: '0.9rem',
    fontWeight: '700',
    cursor: 'pointer',
    transition: 'all 0.2s',
    textTransform: 'uppercase' as const,
    letterSpacing: '1px',
    marginTop: 'auto',
  },
  buttonHover: {
    backgroundColor: '#ffffff',
    color: '#000000',
  },
  buttonDisabled: {
    backgroundColor: '#000000',
    color: '#555',
    borderColor: '#333',
    cursor: 'not-allowed',
  },
  status: {
    color: '#888',
    fontSize: '0.8rem',
    marginTop: '1rem',
    textAlign: 'center' as const,
    fontFamily: 'monospace',
  },
  copyBtn: {
    position: 'absolute' as const,
    top: '2rem',
    right: '2rem',
    background: '#000',
    border: '1px solid #fff',
    color: '#fff',
    padding: '0.5rem 1rem',
    cursor: 'pointer',
    borderRadius: '0px',
    fontSize: '0.75rem',
    textTransform: 'uppercase' as const,
    letterSpacing: '1px',
    zIndex: 10,
  },
};

// --- Helper: File to Base64 ---
const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // remove data:mime/type;base64, prefix
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

function App() {
  const [textInput, setTextInput] = useState('');
  const [instructions, setInstructions] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [formattedContent, setFormattedContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isHovering, setIsHovering] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setTextInput(''); // Clear text if file is selected
    }
  };

  const clearFile = (e: React.MouseEvent) => {
    e.stopPropagation();
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFormat = async () => {
    if (!textInput.trim() && !file) {
      setError("Please provide content (paste text or upload file).");
      return;
    }
    if (!instructions.trim()) {
      setError("Please add formatting instructions.");
      return;
    }

    setLoading(true);
    setError(null);
    setFormattedContent('');

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const parts: any[] = [];

      // 1. Add Instructions
      parts.push({ text: `INSTRUCTIONS:\n${instructions}` });

      // 2. Add Content (File or Text)
      if (file) {
        if (file.type === 'application/pdf' || file.type.startsWith('image/')) {
          // Send PDF/Image directly to Gemini
          const base64Data = await fileToBase64(file);
          parts.push({
            inlineData: {
              mimeType: file.type,
              data: base64Data
            }
          });
        } 
        else if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
           // Parse DOCX in browser using Mammoth
           const arrayBuffer = await file.arrayBuffer();
           const result = await mammoth.extractRawText({ arrayBuffer });
           parts.push({ text: `DOCUMENT CONTENT:\n${result.value}` });
        }
        else if (file.type === 'text/plain') {
          // Plain Text File
          const text = await file.text();
          parts.push({ text: `DOCUMENT CONTENT:\n${text}` });
        } else {
           throw new Error("Unsupported file type. Use PDF, DOCX, Image, or Text.");
        }
      } else {
        // Raw Text Paste
        parts.push({ text: `DOCUMENT CONTENT:\n${textInput}` });
      }

      // 3. Call Gemini
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: { parts },
        config: {
          systemInstruction: SYSTEM_PROMPT,
        }
      });

      if (response.text) {
        setFormattedContent(response.text);
      } else {
        throw new Error("No response generated.");
      }

    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to format document.");
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(formattedContent);
  };

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <div>
          <h1 style={styles.title}>FINAL FORMATTER</h1>
          <p style={styles.subtitle}>AI Document Processor</p>
        </div>
        <div style={{fontSize: '0.8rem', color: '#fff'}}>v3.1</div>
      </header>

      <div style={styles.main}>
        {/* INPUT COLUMN */}
        <div style={styles.column}>
          <div style={styles.sectionTitle}>1. SOURCE</div>
          
          <div style={styles.inputGroup}>
            {/* File Upload Area */}
            <label 
              style={{
                ...styles.fileInputLabel,
                ...(file ? styles.fileInputLabelActive : {})
              }}
            >
              <input 
                type="file" 
                ref={fileInputRef}
                style={styles.hiddenInput}
                onChange={handleFileChange}
                accept=".txt,.md,.pdf,.docx,.doc,.jpg,.jpeg,.png"
              />
              {file ? (
                <div style={{display:'flex', justifyContent:'space-between', width:'100%', alignItems: 'center'}}>
                  <span style={{fontWeight: 500}}>📄 {file.name}</span>
                  <span onClick={clearFile} style={{color:'#fff', fontSize: '1.2rem', padding: '0 1rem', zIndex:10, cursor: 'pointer'}}>×</span>
                </div>
              ) : (
                <span>[ UPLOAD FILE ]</span>
              )}
            </label>

            <div style={{textAlign: 'center', fontSize: '0.7rem', color:'#666', letterSpacing: '2px'}}>- OR -</div>

            <textarea
              style={styles.textarea}
              placeholder={file ? "(File selected, text input disabled)" : "Paste raw text here..."}
              value={textInput}
              onChange={(e) => {
                setTextInput(e.target.value);
                setFile(null); // Clear file if text is typed
                if(fileInputRef.current) fileInputRef.current.value = '';
              }}
              disabled={!!file}
              spellCheck={false}
            />
          </div>

          <div style={styles.sectionTitle}>2. INSTRUCTIONS</div>
          <textarea
            style={styles.instructions}
            placeholder="Formatting rules (e.g. 'Fix grammar, make professional, use bullets')..."
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
          />

          {error && <div style={{color: '#ff0000', fontSize: '0.8rem', marginTop: '0.5rem', border: '1px solid red', padding: '0.5rem'}}>{error}</div>}

          <button 
            style={{
              ...styles.button, 
              ...(isHovering && !loading && (textInput || file) && instructions ? styles.buttonHover : {}),
              ...(loading || (!textInput && !file) || !instructions ? styles.buttonDisabled : {})
            }}
            onMouseEnter={() => setIsHovering(true)}
            onMouseLeave={() => setIsHovering(false)}
            onClick={handleFormat}
            disabled={loading || (!textInput && !file) || !instructions}
          >
            {loading ? 'PROCESSING...' : 'EXECUTE FORMATTING'}
          </button>
        </div>

        {/* OUTPUT COLUMN */}
        <div style={{...styles.column, borderRight: 'none'}}>
          <div style={styles.sectionTitle}>3. RESULT</div>
          {formattedContent && (
            <button style={styles.copyBtn} onClick={copyToClipboard}>
              COPY
            </button>
          )}
          <textarea
            style={{
              ...styles.textarea, 
              backgroundColor: '#000', 
              border: '1px solid #333', 
              color: '#fff',
              fontFamily: '"SF Mono", "Roboto Mono", monospace'
            }}
            placeholder="// Formatted output will appear here..."
            value={formattedContent}
            readOnly
          />
          <div style={styles.status}>
            {loading ? "Parsing document & applying styles..." : "System Ready"}
          </div>
        </div>
      </div>
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
