# 🌌 QuizForge AI

> An intelligent, asynchronous 3-Stage LLM pipeline that transforms study PDFs into interactive quizzes and professional, print-ready exam sheets.

---

## 🚀 Key Features

* **3-Stage Async Pipeline**:
  * **Stage 1 (Extraction)**: Powered by **Google Gemini** for context-aware question extraction.
  * **Stage 2 (Elaboration)**: Powered by **Cerebras (Llama 3.3)** with robust fallbacks to enrich explanation details.
  * **Stage 3 (Validation)**: Validates JSON schemas and parses model inputs automatically.
* **Custom Marking Schemes**: Customize numbers of Multiple Choice, 1-Mark (Very Short), 2-Mark (Short), and 5-Mark (Long) questions.
* **Double-PDF Export Options**:
  * **Question Paper**: A sleek, professional examination sheet containing Candidate details (Name, Date, Class, Score), MCQ checkbox grids, and optimized spacing. Ideal for printing directly for student examinations.
  * **Answer Key**: A dedicated grading reference document featuring correct keys, model answers, and detailed explanations.
* **Interactive UI**: Gorgeous dashboard with live loading steps, interactive quiz execution, self-grading options for open-ended questions, and instant visual results.

---

## 🛠️ Technology Stack

| Component | Technology |
| :--- | :--- |
| **Backend** | Python, FastAPI, Uvicorn, FPDF (PDF Compilation) |
| **Frontend** | React 19, Tailwind CSS v4, Vite |
| **AI Models** | Google Gemini (gemini-2.5-flash), Cerebras (llama3.3-70b), Groq (llama-3.3-70b-versatile) |

---

## ⚙️ Project Setup

### 1. Prerequisites
Make sure you have **Python 3.10+** and **Node.js** installed on your system.

### 2. Backend Installation & Setup
Navigate to the root directory and set up your environment:

1. **Install dependencies**:
   ```bash
   pip install fastapi uvicorn openai google-genai fpdf aiofiles requests pydantic
   ```

2. **Configure Environment Variables**:
   Create a `.env` file in the root folder with the following variables:
   ```env
   GEMINI_API_KEY=your_gemini_key
   CEREBRAS_API_KEY=your_cerebras_key
   GROQ_API_KEY=your_groq_key
   ```

3. **Start the backend server**:
   ```bash
   python main.py
   ```
   The FastAPI server will start at [http://localhost:8000](http://localhost:8000).

---

### 3. Frontend Installation & Setup
Navigate to the `frontend` folder:

1. **Install modules**:
   ```bash
   cd frontend
   npm install
   ```

2. **Start Vite development server**:
   ```bash
   npm run dev
   ```
   The app will run at [http://localhost:5173](http://localhost:5173).

---

## 🎨 PDF Generation Architecture

```
                       ┌──────────────────────┐
                       │      Upload PDF      │
                       └──────────┬───────────┘
                                  │
                       ┌──────────▼───────────┐
                       │  Stage 1 Extraction  │ (Gemini 2.5)
                       └──────────┬───────────┘
                                  │
                       ┌──────────▼───────────┐
                       │ Stage 2 Elaboration  │ (Cerebras / Groq)
                       └──────────┬───────────┘
                                  │
                       ┌──────────▼───────────┐
                       │  Stage 3 Validation  │ (Groq / Gemini)
                       └──────────┬───────────┘
                                  │
                   ┌──────────────┴──────────────┐
                   ▼                             ▼
     ┌──────────────────────────┐   ┌──────────────────────────┐
     │   Questions Paper PDF    │   │      Answer Key PDF      │
     │  (Candidate Fields,      │   │  (Correct Answers,       │
     │   MCQ Grids, No Answers) │   │   Option Explanations)   │
     └──────────────────────────┘   └──────────────────────────┘
```

---

## 📝 License
This project is open-source and licensed under the MIT License.
