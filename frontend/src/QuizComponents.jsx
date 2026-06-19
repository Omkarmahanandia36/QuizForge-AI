import React, { useState, useEffect, useRef } from "react";

const API_BASE = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
  ? "http://localhost:8000"
  : "";

export default function QuizApp() {
  // Application states: 'upload' | 'loading' | 'quiz' | 'results'
  const [view, setView] = useState("upload");
  const [file, setFile] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  
  // Custom marking scheme counts
  const [mcqCount, setMcqCount] = useState(5);
  const [oneMarkCount, setOneMarkCount] = useState(0);
  const [twoMarkCount, setTwoMarkCount] = useState(0);
  const [fiveMarkCount, setFiveMarkCount] = useState(0);

  const [error, setError] = useState("");
  
  // Loading progress states
  const [loadingStep, setLoadingStep] = useState(1);
  const [loadingError, setLoadingError] = useState("");

  // Quiz execution states
  const [quizQuestions, setQuizQuestions] = useState([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  
  // MCQ answers: { questionIndex: optionKey }
  // Non-MCQ answers: { questionIndex: { typedText: string, selfGrade: 'correct' | 'incorrect' } }
  const [answers, setAnswers] = useState({});
  const [typedAnswer, setTypedAnswer] = useState("");
  const [isAnswerRevealed, setIsAnswerRevealed] = useState(false);
  const [selfGradeSelection, setSelfGradeSelection] = useState(null);
  const [showExplanation, setShowExplanation] = useState(false);

  // References
  const fileInputRef = useRef(null);

  // Calculate dynamic total question count
  const totalQuestions = mcqCount + oneMarkCount + twoMarkCount + fiveMarkCount;

  // Handle simulated progress steps during loading
  useEffect(() => {
    if (view !== "loading") {
      setLoadingStep(1);
      return;
    }

    const timer1 = setTimeout(() => setLoadingStep(2), 7000);
    const timer2 = setTimeout(() => setLoadingStep(3), 14000);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
    };
  }, [view]);

  // Drag and Drop handlers
  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const droppedFile = e.dataTransfer.files[0];
      validateAndSetFile(droppedFile);
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      validateAndSetFile(e.target.files[0]);
    }
  };

  const validateAndSetFile = (selectedFile) => {
    setError("");
    if (selectedFile.type !== "application/pdf" && !selectedFile.name.toLowerCase().endsWith(".pdf")) {
      setError("Please upload a valid PDF document only.");
      setFile(null);
      return;
    }
    setFile(selectedFile);
  };

  const triggerFileSelect = () => {
    fileInputRef.current.click();
  };

  const removeFile = (e) => {
    e.stopPropagation();
    setFile(null);
    setError("");
  };

  // Submit file to backend API
  const generateQuiz = async () => {
    if (!file) {
      setError("Please upload a PDF file first.");
      return;
    }
    if (totalQuestions === 0) {
      setError("Please configure at least 1 question in your marking scheme.");
      return;
    }
    if (totalQuestions > 50) {
      setError("Total requested questions cannot exceed the limit of 50.");
      return;
    }

    setView("loading");
    setLoadingError("");
    setError("");

    const formData = new FormData();
    formData.append("file", file);
    formData.append("num_mcq", mcqCount);
    formData.append("num_1_mark", oneMarkCount);
    formData.append("num_2_mark", twoMarkCount);
    formData.append("num_5_mark", fiveMarkCount);

    try {
      const response = await fetch(`${API_BASE}/api/generate-quiz`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        let errorMsg = "Server failed to process the PDF.";
        try {
          const clonedResponse = response.clone();
          try {
            const errorData = await response.json();
            errorMsg = errorData.detail || errorMsg;
          } catch (e) {
            const text = await clonedResponse.text();
            errorMsg = text || errorMsg;
          }
        } catch (cloneErr) {
          try {
            const text = await response.text();
            errorMsg = text || errorMsg;
          } catch (textErr) {
            errorMsg = "Server returned an error that could not be read.";
          }
        }
        throw new Error(errorMsg);
      }

      const data = await response.json();
      if (!data.questions || data.questions.length === 0) {
        throw new Error("No questions returned from backend.");
      }

      setQuizQuestions(data.questions);
      setCurrentQuestionIndex(0);
      setAnswers({});
      setTypedAnswer("");
      setIsAnswerRevealed(false);
      setSelfGradeSelection(null);
      setShowExplanation(false);
      setView("quiz");
    } catch (err) {
      console.error(err);
      setLoadingError(err.message || "An unexpected error occurred during generation.");
    }
  };

  // Answer selection handler for MCQs
  const handleSelectMCQOption = (option) => {
    if (answers[currentQuestionIndex] !== undefined) return;
    setAnswers({
      ...answers,
      [currentQuestionIndex]: option,
    });
    setShowExplanation(true);
  };

  // Non-MCQ handlers
  const handleRevealAnswer = () => {
    setIsAnswerRevealed(true);
  };

  const handleSelfGrade = (grade) => {
    setSelfGradeSelection(grade);
    setAnswers({
      ...answers,
      [currentQuestionIndex]: {
        typedText: typedAnswer,
        selfGrade: grade
      }
    });
  };

  const handleNextQuestion = () => {
    setShowExplanation(false);
    setTypedAnswer("");
    setIsAnswerRevealed(false);
    setSelfGradeSelection(null);

    if (currentQuestionIndex < quizQuestions.length - 1) {
      setCurrentQuestionIndex(currentQuestionIndex + 1);
    } else {
      setView("results");
    }
  };

  const calculateScore = () => {
    let score = 0;
    quizQuestions.forEach((q, idx) => {
      const ans = answers[idx];
      if (q.question_type === "MCQ") {
        if (ans === q.correct_answer) {
          score += 1;
        }
      } else {
        if (ans && ans.selfGrade === "correct") {
          score += 1;
        }
      }
    });
    return score;
  };

  // Call backend to download generated PDF
  const downloadPdf = async (includeAnswers = true) => {
    try {
      const response = await fetch(`${API_BASE}/api/download-pdf`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ 
          questions: quizQuestions,
          include_answers: includeAnswers
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to compile PDF document on server.");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      
      const baseName = file ? file.name.replace(".pdf", "") : "quiz";
      const suffix = includeAnswers ? "_answer_key.pdf" : "_questions.pdf";
      link.setAttribute("download", `${baseName}${suffix}`);
      
      document.body.appendChild(link);
      link.click();
      link.parentNode.removeChild(link);
    } catch (err) {
      console.error(err);
      alert(err.message || "Could not generate PDF. Please try again.");
    }
  };


  const resetQuiz = () => {
    setView("upload");
    setFile(null);
    setQuizQuestions([]);
    setCurrentQuestionIndex(0);
    setAnswers({});
    setTypedAnswer("");
    setIsAnswerRevealed(false);
    setSelfGradeSelection(null);
    setShowExplanation(false);
    setError("");
    setLoadingError("");
  };

  // Icons
  const FileIcon = () => (
    <svg className="w-12 h-12 text-indigo-400 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );

  const CloudUploadIcon = () => (
    <svg className="w-16 h-16 text-indigo-400 mb-4 animate-bounce" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
    </svg>
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-4 font-sans selection:bg-indigo-500 selection:text-white">
      {/* Header */}
      <header className="mb-6 text-center max-w-md">
        <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
          QuizForge AI
        </h1>
        <p className="text-slate-400 mt-2 text-sm md:text-base">
          Transform any PDF document into custom marking schemes and study guides.
        </p>
      </header>

      {/* Main Container */}
      <main className="w-full max-w-2xl bg-slate-900/60 border border-slate-800 rounded-3xl p-6 md:p-8 shadow-2xl backdrop-blur-md transition-all duration-500">
        
        {/* VIEW 1: UPLOAD & CONFIGURATION */}
        {view === "upload" && (
          <div className="space-y-5">
            <h2 className="text-xl font-semibold text-slate-200">Upload PDF & Configure Quiz</h2>
            
            {/* Drag & Drop File Zone */}
            <div
              className={`relative border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all duration-300 ${
                dragActive
                  ? "border-indigo-400 bg-indigo-950/20 text-indigo-200"
                  : file
                  ? "border-emerald-500/50 bg-emerald-950/5 text-slate-300"
                  : "border-slate-800 bg-slate-900/30 hover:border-indigo-500/50 hover:bg-slate-900/60"
              }`}
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={handleDrop}
              onClick={triggerFileSelect}
            >
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept="application/pdf"
                onChange={handleFileChange}
              />
              
              {!file ? (
                <div className="flex flex-col items-center justify-center py-2">
                  <CloudUploadIcon />
                  <p className="font-medium text-slate-300 text-sm md:text-base">
                    Drag and drop your PDF here, or <span className="text-indigo-400 hover:text-indigo-300 underline">browse</span>
                  </p>
                  <p className="text-xs text-slate-500 mt-2">Only PDF files are supported</p>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-2">
                  <FileIcon />
                  <p className="font-semibold text-slate-200 text-sm md:text-base truncate max-w-xs md:max-w-md">
                    {file.name}
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    {(file.size / (1024 * 1024)).toFixed(2)} MB
                  </p>
                  <button
                    onClick={removeFile}
                    className="mt-4 px-3 py-1 bg-red-950/60 hover:bg-red-900/80 text-red-300 border border-red-800/40 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-all duration-200"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    Remove File
                  </button>
                </div>
              )}
            </div>

            {error && (
              <div className="p-3 bg-red-950/40 border border-red-800/30 text-red-300 text-sm rounded-xl flex items-center gap-2">
                <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                {error}
              </div>
            )}

            {/* Custom Marking Scheme Config Grid */}
            <div className="space-y-4">
              <label className="text-sm font-semibold text-slate-300 uppercase tracking-wider block">
                Marking Scheme Blueprint (Choose quantities):
              </label>
              
              <div className="grid grid-cols-2 gap-3.5">
                {/* MCQ */}
                <div className="bg-slate-900/40 border border-slate-800 p-3.5 rounded-2xl flex flex-col gap-2">
                  <label className="text-xs font-semibold text-slate-400">MCQs (Options A-D)</label>
                  <input
                    type="number"
                    min="0"
                    max="50"
                    value={mcqCount}
                    onChange={(e) => setMcqCount(Math.max(0, parseInt(e.target.value) || 0))}
                    className="bg-slate-850 border border-slate-750 text-indigo-300 font-bold rounded-xl py-2 px-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm"
                  />
                </div>
                {/* 1 Mark */}
                <div className="bg-slate-900/40 border border-slate-800 p-3.5 rounded-2xl flex flex-col gap-2">
                  <label className="text-xs font-semibold text-slate-400">1 Mark Questions</label>
                  <input
                    type="number"
                    min="0"
                    max="50"
                    value={oneMarkCount}
                    onChange={(e) => setOneMarkCount(Math.max(0, parseInt(e.target.value) || 0))}
                    className="bg-slate-850 border border-slate-750 text-indigo-300 font-bold rounded-xl py-2 px-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm"
                  />
                </div>
                {/* 2 Mark */}
                <div className="bg-slate-900/40 border border-slate-800 p-3.5 rounded-2xl flex flex-col gap-2">
                  <label className="text-xs font-semibold text-slate-400">2 Mark Questions</label>
                  <input
                    type="number"
                    min="0"
                    max="50"
                    value={twoMarkCount}
                    onChange={(e) => setTwoMarkCount(Math.max(0, parseInt(e.target.value) || 0))}
                    className="bg-slate-850 border border-slate-750 text-indigo-300 font-bold rounded-xl py-2 px-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm"
                  />
                </div>
                {/* 5 Mark */}
                <div className="bg-slate-900/40 border border-slate-800 p-3.5 rounded-2xl flex flex-col gap-2">
                  <label className="text-xs font-semibold text-slate-400">5 Mark Questions</label>
                  <input
                    type="number"
                    min="0"
                    max="50"
                    value={fiveMarkCount}
                    onChange={(e) => setFiveMarkCount(Math.max(0, parseInt(e.target.value) || 0))}
                    className="bg-slate-850 border border-slate-750 text-indigo-300 font-bold rounded-xl py-2 px-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm"
                  />
                </div>
              </div>

              {/* Running Tally */}
              <div className="flex justify-between items-center bg-slate-900/20 border border-slate-850 p-4 rounded-2xl">
                <span className="text-sm font-semibold text-slate-400">Total Questions:</span>
                <span className={`text-sm md:text-base font-extrabold px-3 py-1 rounded-xl border transition-all duration-300 ${
                  totalQuestions > 50
                    ? "bg-red-950/60 border-red-800 text-red-400 animate-pulse"
                    : totalQuestions === 0
                    ? "bg-slate-800 border-slate-700 text-slate-500"
                    : "bg-indigo-950 text-indigo-400 border-indigo-800/30"
                }`}>
                  {totalQuestions} / 50 {totalQuestions > 50 && "(Limit Exceeded)"}
                </span>
              </div>
            </div>

            {/* Action button */}
            <button
              onClick={generateQuiz}
              disabled={!file || totalQuestions === 0 || totalQuestions > 50}
              className={`w-full py-4 rounded-2xl font-semibold text-white transition-all duration-300 flex items-center justify-center gap-2 shadow-lg ${
                file && totalQuestions > 0 && totalQuestions <= 50
                  ? "bg-indigo-600 hover:bg-indigo-500 hover:shadow-indigo-500/10 active:bg-indigo-700"
                  : "bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700/50"
              }`}
            >
              Generate Quiz & PDF
            </button>
          </div>
        )}

        {/* VIEW 2: LOADING OVERLAY */}
        {view === "loading" && (
          <div className="flex flex-col items-center justify-center py-12 text-center space-y-8">
            <div className="relative flex items-center justify-center w-24 h-24">
              <div className="absolute w-24 h-24 border-4 border-slate-800 rounded-full"></div>
              <div className="absolute w-24 h-24 border-4 border-t-indigo-500 border-r-indigo-500 rounded-full animate-spin"></div>
              <div className="absolute w-12 h-12 bg-indigo-500/10 rounded-full blur-xl"></div>
            </div>

            {!loadingError ? (
              <div className="space-y-4 max-w-sm w-full">
                <h3 className="text-xl font-semibold text-slate-100">Analyzing & Forging Quiz...</h3>
                <p className="text-slate-400 text-sm">This may take up to 25 seconds as models process the PDF sequentially.</p>
                
                <div className="mt-6 space-y-3 text-left">
                  {/* Step 1 */}
                  <div className="flex items-center gap-3">
                    <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                      loadingStep === 1
                        ? "bg-indigo-500 text-white animate-pulse"
                        : loadingStep > 1
                        ? "bg-emerald-500 text-slate-950"
                        : "bg-slate-800 text-slate-500"
                    }`}>
                      {loadingStep > 1 ? "✓" : "1"}
                    </div>
                    <span className={`text-sm ${loadingStep === 1 ? "text-indigo-400 font-semibold" : loadingStep > 1 ? "text-slate-400" : "text-slate-600"}`}>
                      Stage 1: Extracting questions with Gemini…
                    </span>
                  </div>

                  {/* Step 2 */}
                  <div className="flex items-center gap-3">
                    <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                      loadingStep === 2
                        ? "bg-indigo-500 text-white animate-pulse"
                        : loadingStep > 2
                        ? "bg-emerald-500 text-slate-950"
                        : "bg-slate-800 text-slate-500"
                    }`}>
                      {loadingStep > 2 ? "✓" : "2"}
                    </div>
                    <span className={`text-sm ${loadingStep === 2 ? "text-indigo-400 font-semibold" : loadingStep > 2 ? "text-slate-400" : "text-slate-600"}`}>
                      Stage 2: Elaborating explanations with Groq / Gemini…
                    </span>
                  </div>

                  {/* Step 3 */}
                  <div className="flex items-center gap-3">
                    <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                      loadingStep === 3
                        ? "bg-indigo-500 text-white animate-pulse"
                        : "bg-slate-800 text-slate-500"
                    }`}>
                      3
                    </div>
                    <span className={`text-sm ${loadingStep === 3 ? "text-indigo-400 font-semibold" : "text-slate-600"}`}>
                      Stage 3: Validating schema with Groq / Gemini…
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-6 w-full">
                <div className="p-4 bg-red-950/40 border border-red-800/30 text-red-300 rounded-2xl flex flex-col items-center gap-3 text-sm">
                  <svg className="w-10 h-10 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="font-semibold text-base">Generation Pipeline Failed</p>
                  <p className="text-slate-400 text-xs max-w-md break-words">{loadingError}</p>
                </div>
                
                <button
                  onClick={resetQuiz}
                  className="px-6 py-3 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-medium rounded-xl transition-all duration-200"
                >
                  Return to Upload
                </button>
              </div>
            )}
          </div>
        )}

        {/* VIEW 3: QUIZ INTERACTION */}
        {view === "quiz" && quizQuestions.length > 0 && (
          <div className="space-y-6">
            
            {/* Quiz Progress Header with Immediate Download PDF option */}
            <div className="flex justify-between items-center text-sm border-b border-slate-800/60 pb-4">
              <div className="flex flex-col gap-1 text-left">
                <span className="text-slate-400 font-medium">
                  Question <strong className="text-slate-200">{currentQuestionIndex + 1}</strong> of <strong className="text-slate-200">{quizQuestions.length}</strong>
                </span>
                <span className="text-[10px] font-extrabold uppercase bg-indigo-950 text-indigo-400 border border-indigo-900/30 px-1.5 py-0.5 rounded-md w-max">
                  {quizQuestions[currentQuestionIndex].question_type.replace('_', ' ')}
                </span>
              </div>

              {/* Direct Download option immediately after uploading / generating */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => downloadPdf(false)}
                  title="Download questions paper without answers"
                  className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold rounded-xl transition-all duration-200 shadow-md cursor-pointer"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Questions PDF
                </button>
                <button
                  onClick={() => downloadPdf(true)}
                  title="Download answer key and explanations"
                  className="flex items-center gap-1.5 px-3 py-2 bg-emerald-950 hover:bg-emerald-900 text-emerald-400 border border-emerald-800/40 text-xs font-bold rounded-xl transition-all duration-200 shadow-md cursor-pointer"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Answers PDF
                </button>
                
                <div className="w-16 bg-slate-800 h-2 rounded-full overflow-hidden ml-2">
                  <div
                    className="bg-indigo-500 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${((currentQuestionIndex + 1) / quizQuestions.length) * 100}%` }}
                  ></div>
                </div>
              </div>
            </div>

            {/* Question Text */}
            <div className="space-y-2">
              <h3 className="text-lg md:text-xl font-bold leading-relaxed text-slate-100">
                {quizQuestions[currentQuestionIndex].question}
              </h3>
            </div>

            {/* MCQ INTERACTION SCHEME */}
            {quizQuestions[currentQuestionIndex].question_type === "MCQ" ? (
              <div className="grid grid-cols-1 gap-3 mt-4">
                {Object.entries(quizQuestions[currentQuestionIndex].options || {}).map(([key, value]) => {
                  const isAnswered = answers[currentQuestionIndex] !== undefined;
                  const isSelected = answers[currentQuestionIndex] === key;
                  const isCorrect = quizQuestions[currentQuestionIndex].correct_answer === key;

                  let buttonClass = "border-slate-850 bg-slate-800/30 hover:border-slate-600 hover:bg-slate-800/60 text-slate-300";
                  
                  if (isAnswered) {
                    if (isCorrect) {
                      buttonClass = "border-emerald-500/80 bg-emerald-950/20 text-emerald-300 shadow-emerald-500/5";
                    } else if (isSelected) {
                      buttonClass = "border-rose-500/80 bg-rose-950/20 text-rose-300 shadow-rose-500/5";
                    } else {
                      buttonClass = "border-slate-850 bg-slate-900/10 text-slate-500 cursor-not-allowed opacity-50";
                    }
                  }

                  return (
                    <button
                      key={key}
                      onClick={() => handleSelectMCQOption(key)}
                      disabled={isAnswered}
                      className={`border rounded-2xl py-4 px-5 text-left flex items-start gap-4 transition-all duration-300 ${buttonClass}`}
                    >
                      <span className={`w-7 h-7 rounded-xl flex items-center justify-center font-bold text-xs flex-shrink-0 ${
                        isAnswered && isCorrect
                          ? "bg-emerald-500 text-slate-950"
                          : isAnswered && isSelected
                          ? "bg-rose-500 text-slate-950"
                          : isSelected
                          ? "bg-indigo-500 text-white"
                          : "bg-slate-800 text-slate-400 group-hover:bg-slate-700"
                      }`}>
                        {key}
                      </span>
                      <span className="text-sm md:text-base pt-0.5 leading-relaxed">{value}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              /* NON-MCQ INTERACTION SCHEME */
              <div className="space-y-4 mt-4 animate-fadeIn">
                <div className="space-y-2">
                  <label htmlFor="typed-answer" className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    Draft your answer:
                  </label>
                  <textarea
                    id="typed-answer"
                    rows="3"
                    value={typedAnswer}
                    onChange={(e) => setTypedAnswer(e.target.value)}
                    disabled={isAnswerRevealed}
                    placeholder="Type or recall your answer here before revealing the scoring key..."
                    className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm text-slate-200 placeholder-slate-650 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 resize-none transition-all duration-200"
                  />
                </div>

                {!isAnswerRevealed ? (
                  <button
                    onClick={handleRevealAnswer}
                    className="w-full py-3.5 bg-indigo-600/90 hover:bg-indigo-600 text-white font-semibold rounded-2xl shadow-md transition-all duration-300 flex items-center justify-center gap-2 cursor-pointer"
                  >
                    Reveal Suggested Answer
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  </button>
                ) : (
                  /* SELF-GRADE PANELS */
                  <div className="space-y-4 animate-fadeIn">
                    <div className="border border-slate-800 bg-slate-900/40 rounded-2xl p-5 space-y-4">
                      <div>
                        <span className="text-xs font-bold bg-indigo-950 text-indigo-400 border border-indigo-800/30 px-2 py-0.5 rounded">
                          Model Answer
                        </span>
                        <p className="text-sm text-slate-200 mt-2 leading-relaxed font-medium">
                          {quizQuestions[currentQuestionIndex].correct_answer}
                        </p>
                      </div>

                      {quizQuestions[currentQuestionIndex].explanation && (
                        <div className="pt-3 border-t border-slate-800/60">
                          <span className="text-xs font-bold bg-emerald-950/60 text-emerald-400 border border-emerald-800/20 px-2 py-0.5 rounded">
                            Marking Rubric
                          </span>
                          <p className="text-xs md:text-sm text-slate-400 mt-2 leading-relaxed">
                            {quizQuestions[currentQuestionIndex].explanation}
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="space-y-2">
                      <p className="text-xs text-slate-400 font-semibold text-center uppercase tracking-wider">
                        Assess your response:
                      </p>
                      <div className="grid grid-cols-2 gap-3">
                        <button
                          onClick={() => handleSelfGrade("correct")}
                          className={`py-3.5 rounded-2xl border text-sm font-semibold transition-all duration-300 flex items-center justify-center gap-2 cursor-pointer ${
                            selfGradeSelection === "correct"
                              ? "bg-emerald-950 border-emerald-500 text-emerald-300 shadow-emerald-500/5"
                              : selfGradeSelection !== null
                              ? "border-slate-850 bg-slate-900/10 text-slate-650 cursor-not-allowed"
                              : "border-slate-800 bg-slate-900/30 hover:border-emerald-500 hover:bg-emerald-950/20 text-slate-300"
                          }`}
                        >
                          ✓ Correct
                        </button>
                        <button
                          onClick={() => handleSelfGrade("incorrect")}
                          className={`py-3.5 rounded-2xl border text-sm font-semibold transition-all duration-300 flex items-center justify-center gap-2 cursor-pointer ${
                            selfGradeSelection === "incorrect"
                              ? "bg-rose-950 border-rose-500 text-rose-300 shadow-rose-500/5"
                              : selfGradeSelection !== null
                              ? "border-slate-850 bg-slate-900/10 text-slate-650 cursor-not-allowed"
                              : "border-slate-800 bg-slate-900/30 hover:border-rose-500 hover:bg-rose-950/20 text-slate-300"
                          }`}
                        >
                          ✗ Incorrect / Partial
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* MCQ Explanations Reveal */}
            {showExplanation && quizQuestions[currentQuestionIndex].question_type === "MCQ" && answers[currentQuestionIndex] !== undefined && (
              <div className="mt-6 border border-slate-800 bg-slate-900/40 rounded-2xl p-5 space-y-4 animate-fadeIn">
                <div className="flex items-center justify-between border-b border-slate-800/60 pb-3">
                  <h4 className="font-semibold text-slate-200 flex items-center gap-2 text-sm">
                    <svg className="w-5 h-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Option Explanations
                  </h4>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                    answers[currentQuestionIndex] === quizQuestions[currentQuestionIndex].correct_answer
                      ? "bg-emerald-950 text-emerald-400 border border-emerald-800/30"
                      : "bg-rose-950 text-rose-400 border border-rose-800/30"
                  }`}>
                    {answers[currentQuestionIndex] === quizQuestions[currentQuestionIndex].correct_answer ? "Correct" : "Incorrect"}
                  </span>
                </div>
                
                <div className="space-y-3">
                  {Object.entries(quizQuestions[currentQuestionIndex].explanations || {}).map(([key, expl]) => {
                    const isOptionCorrect = quizQuestions[currentQuestionIndex].correct_answer === key;
                    const isOptionSelected = answers[currentQuestionIndex] === key;

                    return (
                      <div key={key} className="text-xs md:text-sm">
                        <div className="flex items-center gap-1.5 font-semibold">
                          <span className={isOptionCorrect ? "text-emerald-400" : isOptionSelected ? "text-rose-400" : "text-slate-400"}>
                            Option {key}:
                          </span>
                          {isOptionCorrect && <span className="text-[10px] bg-emerald-950 text-emerald-400 border border-emerald-800/30 px-1 rounded">Correct Answer</span>}
                        </div>
                        <p className="text-slate-400 mt-0.5 leading-relaxed">{expl}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Next Question button */}
            {answers[currentQuestionIndex] !== undefined && (
              <button
                onClick={handleNextQuestion}
                className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white font-semibold rounded-2xl shadow-lg hover:shadow-indigo-600/10 transition-all duration-300 mt-6 flex items-center justify-center gap-2 cursor-pointer"
              >
                {currentQuestionIndex < quizQuestions.length - 1 ? "Next Question" : "View Results"}
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </button>
            )}
          </div>
        )}

        {/* VIEW 4: SCORE REVIEW BOARD */}
        {view === "results" && (
          <div className="space-y-6">
            
            {/* Score circle & details */}
            <div className="text-center py-6 bg-slate-900/30 rounded-3xl border border-slate-800/85">
              <h2 className="text-xl font-bold text-slate-200">Quiz Completed!</h2>
              
              <div className="relative w-36 h-36 mx-auto mt-6 flex flex-col items-center justify-center">
                <svg className="w-full h-full transform -rotate-90">
                  <circle cx="72" cy="72" r="62" className="stroke-slate-800" strokeWidth="8" fill="transparent" />
                  <circle
                    cx="72"
                    cy="72"
                    r="62"
                    className="stroke-indigo-500"
                    strokeWidth="8"
                    fill="transparent"
                    strokeDasharray={2 * Math.PI * 62}
                    strokeDashoffset={2 * Math.PI * 62 * (1 - calculateScore() / quizQuestions.length)}
                    strokeLinecap="round"
                  />
                </svg>
                <div className="absolute text-center">
                  <span className="text-4xl font-extrabold text-slate-100">
                    {calculateScore()}
                  </span>
                  <span className="text-slate-500 font-semibold text-lg">
                    /{quizQuestions.length}
                  </span>
                  <p className="text-xs font-bold text-indigo-400 mt-0.5">
                    {Math.round((calculateScore() / quizQuestions.length) * 100)}%
                  </p>
                </div>
              </div>
            </div>

            {/* Action buttons (Download PDF Options & Restart) */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <button
                onClick={() => downloadPdf(false)}
                className="py-4 bg-slate-800 hover:bg-slate-700 active:bg-slate-900 border border-slate-700 text-slate-200 font-semibold rounded-2xl shadow-lg transition-all duration-300 flex items-center justify-center gap-2 cursor-pointer"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Questions Only
              </button>

              <button
                onClick={() => downloadPdf(true)}
                className="py-4 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white font-semibold rounded-2xl shadow-lg hover:shadow-emerald-600/10 transition-all duration-300 flex items-center justify-center gap-2 cursor-pointer"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Answer Key
              </button>

              <button
                onClick={resetQuiz}
                className="py-4 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white font-semibold rounded-2xl shadow-lg hover:shadow-indigo-600/10 transition-all duration-300 flex items-center justify-center gap-2 cursor-pointer"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 7.89M9 11l3-3m0 0l3 3m-3-3v12" />
                </svg>
                Restart Quiz
              </button>
            </div>

            {/* Performance analysis review list */}
            <div className="space-y-4">
              <h3 className="text-lg font-bold text-slate-200">Question Review</h3>
              
              <div className="space-y-4 max-h-96 overflow-y-auto pr-2">
                {quizQuestions.map((q, idx) => {
                  const ans = answers[idx];
                  
                  let isCorrect = false;
                  if (q.question_type === "MCQ") {
                    isCorrect = ans === q.correct_answer;
                  } else {
                    isCorrect = ans && ans.selfGrade === "correct";
                  }

                  return (
                    <details
                      key={idx}
                      className="group border border-slate-800 bg-slate-900/20 rounded-2xl overflow-hidden transition-all duration-300"
                    >
                      <summary className="flex items-center justify-between p-4 cursor-pointer hover:bg-slate-900/60 list-none select-none">
                        <div className="flex items-center gap-3">
                          <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                            isCorrect
                              ? "bg-emerald-950 text-emerald-400 border border-emerald-800/40"
                              : "bg-rose-950 text-rose-400 border border-rose-800/40"
                          }`}>
                            {isCorrect ? "✓" : "✗"}
                          </span>
                          <span className="text-sm font-semibold text-slate-200 truncate max-w-xs md:max-w-md">
                            {idx + 1}. {q.question}
                          </span>
                        </div>
                        <span className="text-slate-500 group-open:rotate-180 transition-transform duration-300">
                          ▼
                        </span>
                      </summary>

                      <div className="p-4 border-t border-slate-800/60 bg-slate-900/40 space-y-4 text-xs md:text-sm">
                        <p className="font-semibold text-slate-200">
                          {q.question}
                          <span className="ml-2 px-2 py-0.5 text-[10px] font-bold bg-indigo-950 text-indigo-400 border border-indigo-800/20 rounded">
                            {q.question_type.replace('_', ' ').toUpperCase()}
                          </span>
                        </p>
                        
                        {q.question_type === "MCQ" ? (
                          /* MCQ Options list in review */
                          <div className="space-y-1.5 pl-2">
                            {Object.entries(q.options || {}).map(([optKey, optText]) => {
                              const isUserSelection = ans === optKey;
                              const isCorrectOpt = q.correct_answer === optKey;
                              
                              let optClass = "text-slate-400";
                              if (isCorrectOpt) {
                                optClass = "text-emerald-400 font-semibold";
                              } else if (isUserSelection) {
                                optClass = "text-rose-400 font-semibold";
                              }

                              return (
                                <div key={optKey} className={`flex items-start gap-2 ${optClass}`}>
                                  <span className="font-bold flex-shrink-0">{optKey}:</span>
                                  <span>{optText}</span>
                                  {isCorrectOpt && <span className="text-[9px] bg-emerald-950 text-emerald-400 px-1 border border-emerald-800/30 rounded ml-1.5">Correct</span>}
                                  {isUserSelection && !isCorrectOpt && <span className="text-[9px] bg-rose-950 text-rose-400 px-1 border border-rose-800/30 rounded ml-1.5">Your Choice</span>}
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          /* Written answer list in review */
                          <div className="space-y-3 pl-2">
                            <div>
                              <p className="text-xs text-slate-500 font-semibold">Your Draft Answer:</p>
                              <p className="text-slate-350 italic mt-0.5 leading-relaxed bg-slate-900/60 p-2 rounded-lg border border-slate-800/30">
                                {ans && ans.typedText ? ans.typedText : "(No draft text written)"}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs text-emerald-500 font-semibold">Suggested Answer:</p>
                              <p className="text-slate-200 font-medium mt-0.5 leading-relaxed">
                                {q.correct_answer}
                              </p>
                            </div>
                          </div>
                        )}

                        {/* Explanation block */}
                        <div className="mt-3 pt-3 border-t border-slate-800/60 space-y-2">
                          <p className="font-bold text-slate-300 text-xs">Explanations & Criteria:</p>
                          {q.question_type === "MCQ" ? (
                            Object.entries(q.explanations || {}).map(([optKey, expl]) => (
                              <div key={optKey} className="text-xs">
                                <span className="text-slate-400 font-semibold">Option {optKey}:</span>{" "}
                                <span className="text-slate-500">{expl}</span>
                              </div>
                            ))
                          ) : (
                            <p className="text-xs text-slate-500 leading-relaxed">
                              {q.explanation}
                            </p>
                          )}
                        </div>
                      </div>
                    </details>
                  );
                })}
              </div>
            </div>
            
          </div>
        )}

      </main>
    </div>
  );
}
