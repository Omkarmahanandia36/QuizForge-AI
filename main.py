import os
import io
import json
import logging
import tempfile
import aiofiles
from typing import List, Optional
from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from openai import AsyncOpenAI
from google import genai
from google.genai import types
from fpdf import FPDF

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger("QuizGenerator")

app = FastAPI(
    title="PDF-to-Interactive-Quiz Generator API",
    description="Asynchronous 3-Stage LLM Pipeline supporting Custom Marking Schemes and PDF Generation",
    version="1.2.0"
)

# Enable CORS for all origins (required for frontend local development)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Pydantic Schemas
class QuizOption(BaseModel):
    A: str = Field(..., description="Option A text")
    B: str = Field(..., description="Option B text")
    C: str = Field(..., description="Option C text")
    D: str = Field(..., description="Option D text")

class QuizExplanation(BaseModel):
    A: str = Field(..., description="Explanation for option A")
    B: str = Field(..., description="Explanation for option B")
    C: str = Field(..., description="Explanation for option C")
    D: str = Field(..., description="Explanation for option D")

class QuizQuestion(BaseModel):
    question_type: str = Field(..., description="Type of question: MCQ, 1_mark, 2_mark, 5_mark")
    question: str = Field(..., description="The question text")
    options: Optional[QuizOption] = Field(None, description="The four choices A, B, C, and D (MCQ only)")
    correct_answer: str = Field(..., description="The correct answer key (A/B/C/D for MCQ) or the suggested answer (for 1/2/5 mark questions)")
    explanations: Optional[QuizExplanation] = Field(None, description="Option-specific explanations (MCQ only)")
    explanation: Optional[str] = Field(None, description="General explanation or marking rubric (non-MCQ only)")

class QuizResponse(BaseModel):
    questions: List[QuizQuestion] = Field(..., description="List of generated quiz questions")

class DownloadPDFRequest(BaseModel):
    questions: List[QuizQuestion] = Field(..., description="List of questions for the PDF")
    include_answers: bool = Field(True, description="Whether to include answers and explanations")


def load_env_file():
    """Manually parse .env file to ensure runtime key reloading without external dependencies."""
    env_path = os.path.join(os.path.dirname(__file__), ".env")
    if os.path.exists(env_path):
        logger.info("Loading environment variables from local .env file")
        with open(env_path, "r") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, val = line.split("=", 1)
                    os.environ[key.strip()] = val.strip()

def safe_pdf_str(text: str) -> str:
    """Sanitize strings to prevent UnicodeEncodeError in FPDF Latin-1 default fonts."""
    if not text:
        return ""
    replacements = {
        "\u201c": '"', "\u201d": '"', # Double curly quotes
        "\u2018": "'", "\u2019": "'", # Single curly quotes
        "\u2013": "-", "\u2014": "-", # En/em dashes
        "\u2212": "-", # Unicode minus symbol
        "\u00a0": " ", # Non-breaking space
    }
    for uni_char, ascii_char in replacements.items():
        text = text.replace(uni_char, ascii_char)
    return text.encode("latin-1", errors="replace").decode("latin-1")

async def run_pipeline(temp_file_path: str, num_mcq: int, num_1_mark: int, num_2_mark: int, num_5_mark: int) -> QuizResponse:
    # Always load environment variables first to capture any updates
    load_env_file()
    
    gemini_key = os.environ.get("GEMINI_API_KEY")
    cerebras_key = os.environ.get("CEREBRAS_API_KEY")
    openrouter_key = os.environ.get("OPENROUTER_API_KEY")
    groq_key = os.environ.get("GROQ_API_KEY")

    if not gemini_key:
        raise ValueError("GEMINI_API_KEY environment variable is missing.")

    # Calculate scheme and total count
    requirements = []
    if num_mcq > 0:
        requirements.append(f"- {num_mcq} Multiple Choice Questions (MCQ)")
    if num_1_mark > 0:
        requirements.append(f"- {num_1_mark} 1-Mark Questions (concise short answer)")
    if num_2_mark > 0:
        requirements.append(f"- {num_2_mark} 2-Mark Questions (medium explanation)")
    if num_5_mark > 0:
        requirements.append(f"- {num_5_mark} 5-Mark Questions (detailed long answer)")
        
    requirements_str = "\n".join(requirements)
    total_questions = num_mcq + num_1_mark + num_2_mark + num_5_mark

    # ==========================================
    # STAGE 1: EXTRACTION (Google Gemini)
    # ==========================================
    logger.info(f"Starting Stage 1: Extraction with Gemini (Marking Scheme: {total_questions} total questions)...")
    client_gemini = genai.Client(api_key=gemini_key)
    
    # Upload the PDF binary to Google's Files API
    logger.info(f"Uploading local temp file {temp_file_path} to Google Files API...")
    uploaded_file = await client_gemini.aio.files.upload(file=temp_file_path)
    logger.info(f"Uploaded successfully. File name ID: {uploaded_file.name}")
    
    stage1_json_str = ""
    try:
        # Construct dynamic prompt detailing the custom marking scheme
        prompt_stage1 = f"""You are an expert academic examiner. Read the attached document and generate a quiz with exactly the following marking scheme:
{requirements_str}

Total questions to generate: {total_questions}

You must return the output in a strict, raw JSON array format with no markdown code blocks, no backticks, and no extra text.
Each question object in the JSON array must contain exactly these fields:
- "question_type": string, must be one of: "MCQ", "1_mark", "2_mark", or "5_mark".
- "question": string, the question text.
- "options": object with keys "A", "B", "C", and "D" mapping to their option strings. For "1_mark", "2_mark", and "5_mark" questions, set "options" to null or omit it.
- "correct_answer": string. For "MCQ", it must be "A", "B", "C", or "D". For "1_mark", "2_mark", and "5_mark" questions, it must be the suggested answer or model answer.
- "explanations": object with keys "A", "B", "C", and "D" mapping to explanations. For "1_mark", "2_mark", and "5_mark" questions, set "explanations" to null or omit it.
- "explanation": string. For "MCQ" questions, set to null or omit it. For "1_mark", "2_mark", and "5_mark" questions, provide a clear explanation, marking key points, or assessment rubric.

Format the output strictly as a JSON array like this:
[
  {{
    "question_type": "MCQ",
    "question": "What is the primary topic of the document?",
    "options": {{
      "A": "First Choice",
      "B": "Second Choice",
      "C": "Third Choice",
      "D": "Fourth Choice"
    }},
    "correct_answer": "A"
  }}
]
"""
        logger.info("Calling gemini-2.5-flash for question generation...")
        response_gemini = await client_gemini.aio.models.generate_content(
            model="gemini-2.5-flash",
            contents=[uploaded_file, prompt_stage1],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.2
            )
        )
        stage1_json_str = response_gemini.text
        logger.info(f"Stage 1 complete. Received {len(stage1_json_str)} characters of JSON text.")
        
    finally:
        # Clean up the file asset immediately from Google Files API to prevent storage accumulation
        logger.info(f"Immediately deleting file asset {uploaded_file.name} from Google Files API...")
        try:
            await client_gemini.aio.files.delete(name=uploaded_file.name)
            logger.info("Google Files API cleanup successful.")
        except Exception as cleanup_err:
            logger.error(f"Failed to delete Google Files API asset {uploaded_file.name}: {str(cleanup_err)}")
            
    if not stage1_json_str or not stage1_json_str.strip():
        raise ValueError("Stage 1 returned an empty response.")

    # ==========================================
    # STAGE 2: ELABORATION (Cerebras with fallbacks)
    # ==========================================
    logger.info("Starting Stage 2: Elaboration...")
    stage2_json_str = ""
    
    prompt_stage2 = f"""You are an educational assistant. You will receive a JSON array containing questions.
Your task is to iterate over every question object in the array and enrich it with explanations:
1. For any object where "question_type" is "MCQ", append or fill the "explanations" field. The "explanations" field must be a nested object containing exactly four keys: "A", "B", "C", and "D", each mapping to a detailed 1-to-2 sentence explanation of why that specific option is correct or incorrect.
2. For any object where "question_type" is "1_mark", "2_mark", or "5_mark", append or fill the "explanation" field (string) with a detailed explanation of the answer, including the key points that are required to score full marks.
3. You MUST preserve all other original fields ("question_type", "question", "options", and "correct_answer") exactly as they are.
Return ONLY the final JSON array. Do not wrap it in markdown code blocks, do not include triple backticks, and do not add any surrounding conversational text.

Input JSON:
{stage1_json_str}
"""

    # 1. Try Cerebras
    if cerebras_key:
        try:
            logger.info("Attempting elaboration with Cerebras (llama3.3-70b)...")
            client_cerebras = AsyncOpenAI(
                base_url="https://api.cerebras.ai/v1",
                api_key=cerebras_key
            )
            response_cerebras = await client_cerebras.chat.completions.create(
                model="llama3.3-70b",
                messages=[
                    {"role": "system", "content": "You are a precise JSON formatting assistant that outputs raw JSON arrays and preserves input fields."},
                    {"role": "user", "content": prompt_stage2}
                ],
                temperature=0.2
            )
            stage2_json_str = response_cerebras.choices[0].message.content
            logger.info("Stage 2 elaboration with Cerebras successful.")
        except Exception as cerebras_err:
            logger.warning(f"Cerebras elaboration failed: {str(cerebras_err)}. Trying fallback...")

    # 2. Try Groq
    if not stage2_json_str and groq_key:
        try:
            logger.info("Attempting elaboration with Groq (llama-3.3-70b-versatile)...")
            client_groq = AsyncOpenAI(
                base_url="https://api.groq.com/openai/v1",
                api_key=groq_key
            )
            response_groq = await client_groq.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=[
                    {"role": "system", "content": "You are a precise JSON formatting assistant that outputs raw JSON arrays and preserves input fields."},
                    {"role": "user", "content": prompt_stage2}
                ],
                temperature=0.2
            )
            stage2_json_str = response_groq.choices[0].message.content
            logger.info("Stage 2 elaboration with Groq successful.")
        except Exception as groq_err:
            logger.warning(f"Groq elaboration failed: {str(groq_err)}. Trying fallback...")

    # 3. Try Gemini
    if not stage2_json_str:
        try:
            logger.info("Attempting elaboration with Gemini (gemini-2.5-flash) fallback...")
            client_gemini_s2 = genai.Client(api_key=gemini_key)
            response_gemini_s2 = await client_gemini_s2.aio.models.generate_content(
                model="gemini-2.5-flash",
                contents=prompt_stage2,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    temperature=0.2
                )
            )
            stage2_json_str = response_gemini_s2.text
            logger.info("Stage 2 elaboration with Gemini successful.")
        except Exception as gemini_err:
            logger.error(f"Gemini elaboration fallback failed: {str(gemini_err)}")
            raise ValueError(f"Stage 2 Elaboration failed across all providers: {str(gemini_err)}")

    if not stage2_json_str or not stage2_json_str.strip():
        raise ValueError("Stage 2 returned an empty response.")

    # ==========================================
    # STAGE 3: VALIDATION (OpenRouter with fallbacks)
    # ==========================================
    logger.info("Starting Stage 3: Validation and QA check...")
    stage3_json_str = ""

    prompt_stage3 = f"""You are a strict JSON validation agent. Your job is to format, validate, and clean the provided JSON text to ensure it conforms exactly to the required schema.
Instructions:
1. Validate that the input is a valid JSON array of question objects.
2. Repair any missing fields, trailing commas, or syntax errors.
3. Ensure each question object contains exactly the fields: "question_type", "question", "correct_answer".
4. If "question_type" is "MCQ", it must contain "options" (keys A, B, C, D) and "explanations" (keys A, B, C, D).
5. If "question_type" is "1_mark", "2_mark", or "5_mark", "options" and "explanations" should be null, and it must contain a string "explanation" field.
6. Remove any markdown styling, triple backticks (```json), code blocks, language tags, or explanations outside the JSON array.
7. Return ONLY the raw, parseable JSON array. No extra sentences, no intro, no outro.

Input JSON to validate:
{stage2_json_str}
"""

    # 1. Try OpenRouter
    if openrouter_key:
        try:
            logger.info("Attempting validation with OpenRouter (meta-llama/llama-3.3-70b-instruct:free)...")
            client_validator = AsyncOpenAI(
                base_url="https://openrouter.ai/api/v1",
                api_key=openrouter_key
            )
            response_validator = await client_validator.chat.completions.create(
                model="meta-llama/llama-3.3-70b-instruct:free",
                messages=[
                    {"role": "system", "content": "You are a JSON formatting assistant. You output raw JSON arrays only, with zero markdown wrapper code blocks."},
                    {"role": "user", "content": prompt_stage3}
                ],
                temperature=0.1
            )
            stage3_json_str = response_validator.choices[0].message.content
            logger.info("Stage 3 validation with OpenRouter successful.")
        except Exception as or_err:
            logger.warning(f"OpenRouter validation failed: {str(or_err)}. Trying fallback...")

    # 2. Try Groq
    if not stage3_json_str and groq_key:
        try:
            logger.info("Attempting validation with Groq (llama-3.3-70b-versatile)...")
            client_validator = AsyncOpenAI(
                base_url="https://api.groq.com/openai/v1",
                api_key=groq_key
            )
            response_validator = await client_validator.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=[
                    {"role": "system", "content": "You are a JSON formatting assistant. You output raw JSON arrays only, with zero markdown wrapper code blocks."},
                    {"role": "user", "content": prompt_stage3}
                ],
                temperature=0.1
            )
            stage3_json_str = response_validator.choices[0].message.content
            logger.info("Stage 3 validation with Groq successful.")
        except Exception as groq_err:
            logger.warning(f"Groq validation failed: {str(groq_err)}. Trying fallback...")

    # 3. Try Gemini
    if not stage3_json_str:
        try:
            logger.info("Attempting validation with Gemini (gemini-2.5-flash)...")
            client_gemini_s3 = genai.Client(api_key=gemini_key)
            response_gemini_s3 = await client_gemini_s3.aio.models.generate_content(
                model="gemini-2.5-flash",
                contents=prompt_stage3,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    temperature=0.1
                )
            )
            stage3_json_str = response_gemini_s3.text
            logger.info("Stage 3 validation with Gemini successful.")
        except Exception as gemini_err:
            logger.warning(f"Gemini validation fallback failed: {str(gemini_err)}. Using Stage 2 raw output as final.")
            stage3_json_str = stage2_json_str

    # Post-process to remove potential markdown wrapping (just in case)
    cleaned_json = stage3_json_str.strip()
    if cleaned_json.startswith("```"):
        lines = cleaned_json.split("\n")
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        cleaned_json = "\n".join(lines).strip()

    # Parse JSON and enforce Pydantic validation
    try:
        data = json.loads(cleaned_json)
        # Normalize structure
        if isinstance(data, dict):
            if "questions" in data:
                questions_list = data["questions"]
            else:
                questions_list = list(data.values())[0] if data else []
        elif isinstance(data, list):
            questions_list = data
        else:
            raise ValueError("Parsed data is not a list or dictionary wrapper.")
            
        validated_quiz = QuizResponse(questions=questions_list)
        logger.info("Successfully validated and parsed quiz data.")
        return validated_quiz
        
    except Exception as parse_err:
        logger.error(f"Failed to parse validated JSON. Error: {str(parse_err)}")
        logger.warning("Attempting recovery by direct parsing of Stage 2 data...")
        
        try:
            s2_cleaned = stage2_json_str.strip()
            if s2_cleaned.startswith("```"):
                lines = s2_cleaned.split("\n")
                if lines[0].startswith("```"):
                    lines = lines[1:]
                if lines and lines[-1].strip() == "```":
                    lines = lines[:-1]
                s2_cleaned = "\n".join(lines).strip()
            data_s2 = json.loads(s2_cleaned)
            questions_list = data_s2 if isinstance(data_s2, list) else data_s2.get("questions", [])
            validated_quiz = QuizResponse(questions=questions_list)
            logger.info("Recovered successfully using Stage 2 parsed data.")
            return validated_quiz
        except Exception as recovery_err:
            logger.critical("Stage 2 recovery failed. Output was completely unparseable.")
            raise HTTPException(
                status_code=500,
                detail=f"Schema parsing failed. S3 error: {str(parse_err)}. S2 recovery error: {str(recovery_err)}"
            )

@app.post("/api/generate-quiz", response_model=QuizResponse)
async def generate_quiz(
    file: UploadFile = File(...),
    num_mcq: int = Form(0),
    num_1_mark: int = Form(0),
    num_2_mark: int = Form(0),
    num_5_mark: int = Form(0)
):
    logger.info(f"Received quiz blueprints. MCQ: {num_mcq}, 1M: {num_1_mark}, 2M: {num_2_mark}, 5M: {num_5_mark}, File: {file.filename}")
    
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(
            status_code=400,
            detail="Invalid file type. Only PDF documents are supported."
        )
        
    total_questions = num_mcq + num_1_mark + num_2_mark + num_5_mark
    
    # Fallback to default 5 MCQs if nothing was configured
    if total_questions == 0:
        logger.info("No marking scheme counts provided. Defaulting to 5 MCQs.")
        num_mcq = 5
        total_questions = 5
        
    if total_questions < 1 or total_questions > 50:
        raise HTTPException(
            status_code=400,
            detail="Total requested questions must be between 1 and 50."
        )
        
    # Create local temporary file path
    temp_dir = tempfile.gettempdir()
    temp_file_path = os.path.join(temp_dir, f"quiz_upload_{os.urandom(8).hex()}.pdf")
    
    try:
        # Save uploaded PDF locally using aiofiles
        async with aiofiles.open(temp_file_path, "wb") as out_file:
            content = await file.read()
            await out_file.write(content)
        logger.info(f"Saved PDF to temporary path: {temp_file_path}")
        
        # Execute the 3-stage sequential async pipeline
        response_quiz = await run_pipeline(temp_file_path, num_mcq, num_1_mark, num_2_mark, num_5_mark)
        return response_quiz
        
    except ValueError as val_err:
        logger.error(f"Value Error in pipeline: {str(val_err)}")
        raise HTTPException(status_code=400, detail=str(val_err))
    except Exception as exc:
        logger.error(f"Unhandled Exception in endpoint: {str(exc)}")
        raise HTTPException(status_code=500, detail=f"Generation failed: {str(exc)}")
        
    finally:
        # Perform safe cleanup of local temp file under all circumstances
        if os.path.exists(temp_file_path):
            logger.info(f"Cleaning up local temp file: {temp_file_path}")
            try:
                os.remove(temp_file_path)
            except Exception as cleanup_err:
                logger.error(f"Failed to remove temp file {temp_file_path}: {str(cleanup_err)}")

@app.post("/api/download-pdf")
async def download_pdf(req: DownloadPDFRequest):
    logger.info(f"Received PDF download request. Include answers: {req.include_answers}")
    try:
        pdf = FPDF()
        pdf.set_auto_page_break(auto=True, margin=15)
        pdf.add_page()
        
        # Title & Subtitle based on option
        if not req.include_answers:
            pdf.set_font("Helvetica", "B", 18)
            pdf.cell(0, 10, safe_pdf_str("QUIZ / EXAMINATION"), align="C", ln=True)
            pdf.ln(3)
            
            # Candidate Details Form
            pdf.set_font("Helvetica", "", 10)
            pdf.set_text_color(80, 80, 80)
            
            # Row 1
            pdf.cell(100, 6, safe_pdf_str("Candidate Name: ___________________________________"), ln=False)
            pdf.cell(0, 6, safe_pdf_str("Date: ________________________"), ln=True)
            
            # Row 2
            pdf.cell(100, 6, safe_pdf_str("Class/Section:  ___________________________________"), ln=False)
            pdf.cell(0, 6, safe_pdf_str("Score:  _______ / _______"), ln=True)
            pdf.ln(5)
            
            # Divider
            pdf.set_draw_color(180, 180, 180)
            pdf.line(pdf.l_margin, pdf.get_y(), pdf.w - pdf.r_margin, pdf.get_y())
            pdf.ln(8)
        else:
            pdf.set_font("Helvetica", "B", 18)
            pdf.cell(0, 10, safe_pdf_str("QUIZ ANSWER KEY & EXPLANATIONS"), align="C", ln=True)
            pdf.ln(3)
            
            pdf.set_font("Helvetica", "I", 10)
            pdf.set_text_color(100, 100, 100)
            pdf.cell(0, 5, safe_pdf_str("Reference guide generated by QuizForge AI"), align="C", ln=True)
            pdf.ln(5)
            
            # Divider
            pdf.set_draw_color(180, 180, 180)
            pdf.line(pdf.l_margin, pdf.get_y(), pdf.w - pdf.r_margin, pdf.get_y())
            pdf.ln(8)

        # Reset text color for questions
        pdf.set_text_color(0, 0, 0)
        
        # Group questions by type to form sections
        mcqs = [q for q in req.questions if q.question_type == "MCQ"]
        one_mark = [q for q in req.questions if q.question_type == "1_mark"]
        two_mark = [q for q in req.questions if q.question_type == "2_mark"]
        five_mark = [q for q in req.questions if q.question_type == "5_mark"]
        
        # We will build a list of sections to render
        # Each section has: (name, list_of_questions, marks_per_question)
        sections = []
        if mcqs:
            sections.append(("Multiple Choice Questions", mcqs, 1))
        if one_mark:
            sections.append(("Very Short Answer Questions", one_mark, 1))
        if two_mark:
            sections.append(("Short Answer Questions", two_mark, 2))
        if five_mark:
            sections.append(("Long Answer Questions", five_mark, 5))
            
        roman_numerals = ["I", "II", "III", "IV"]
        w_total = pdf.w - pdf.l_margin - pdf.r_margin
        section_idx = 0
        
        for sec_name, sec_questions, sec_marks in sections:
            # Section Header (Roman numeral + Name, with right-aligned marks summary)
            rom = roman_numerals[section_idx] if section_idx < len(roman_numerals) else str(section_idx + 1)
            title_text = f"{rom}. {sec_name}"
            marks_text = f"({sec_marks} x {len(sec_questions)} = {sec_marks * len(sec_questions)} Marks)"
            
            # Print section title and marks right-aligned
            pdf.set_font("Helvetica", "B", 12)
            w_marks = pdf.get_string_width(marks_text)
            
            pdf.cell(w_total - w_marks, 8, safe_pdf_str(title_text), ln=False)
            pdf.cell(w_marks, 8, safe_pdf_str(marks_text), align="R", ln=True)
            pdf.ln(3)
            section_idx += 1
            
            # Print questions
            for q_idx, q in enumerate(sec_questions):
                pdf.set_font("Helvetica", "", 11)
                q_text = f"{q_idx + 1}. {q.question}"
                
                # Check for MCQ
                if q.question_type == "MCQ" and q.options:
                    # Multi-cell for question text
                    pdf.multi_cell(0, 5, safe_pdf_str(q_text))
                    pdf.ln(1.5)
                    
                    # Clean options text
                    opt_a = f"A. {q.options.A}"
                    opt_b = f"B. {q.options.B}"
                    opt_c = f"C. {q.options.C}"
                    opt_d = f"D. {q.options.D}"
                    
                    max_len = max(len(opt_a), len(opt_b), len(opt_c), len(opt_d))
                    
                    # Render options based on max length
                    if max_len <= 18:
                        # 4 columns in one row
                        col_w = w_total / 4
                        pdf.set_x(pdf.l_margin)
                        pdf.cell(col_w, 5, safe_pdf_str(opt_a))
                        pdf.cell(col_w, 5, safe_pdf_str(opt_b))
                        pdf.cell(col_w, 5, safe_pdf_str(opt_c))
                        pdf.cell(col_w, 5, safe_pdf_str(opt_d), ln=True)
                    elif max_len <= 42:
                        # 2 columns, 2 rows
                        col_w = w_total / 2
                        pdf.set_x(pdf.l_margin)
                        pdf.cell(col_w, 5, safe_pdf_str(opt_a))
                        pdf.cell(col_w, 5, safe_pdf_str(opt_b), ln=True)
                        pdf.set_x(pdf.l_margin)
                        pdf.cell(col_w, 5, safe_pdf_str(opt_c))
                        pdf.cell(col_w, 5, safe_pdf_str(opt_d), ln=True)
                    else:
                        # 1 column (vertical block)
                        pdf.set_x(pdf.l_margin + 5)
                        pdf.multi_cell(0, 5, safe_pdf_str(opt_a))
                        pdf.set_x(pdf.l_margin + 5)
                        pdf.multi_cell(0, 5, safe_pdf_str(opt_b))
                        pdf.set_x(pdf.l_margin + 5)
                        pdf.multi_cell(0, 5, safe_pdf_str(opt_c))
                        pdf.set_x(pdf.l_margin + 5)
                        pdf.multi_cell(0, 5, safe_pdf_str(opt_d))
                        
                    pdf.ln(2.5)
                    
                    if req.include_answers:
                        # Print correct answer & explanations right below options in answer key mode
                        pdf.set_font("Helvetica", "B", 10)
                        pdf.set_x(pdf.l_margin)
                        pdf.cell(0, 5, safe_pdf_str(f"Correct Answer: {q.correct_answer}"), ln=True)
                        
                        if q.explanations:
                            pdf.set_font("Helvetica", "I", 9)
                            pdf.set_text_color(100, 100, 100)
                            pdf.multi_cell(0, 4.5, safe_pdf_str(
                                f"Option Explanations:\n"
                                f"  A: {q.explanations.A}\n"
                                f"  B: {q.explanations.B}\n"
                                f"  C: {q.explanations.C}\n"
                                f"  D: {q.explanations.D}"
                            ))
                            pdf.set_text_color(0, 0, 0)
                        pdf.ln(2)
                else:
                    # Non-MCQ question
                    pdf.multi_cell(0, 5, safe_pdf_str(q_text))
                    pdf.ln(2)
                    
                    if req.include_answers:
                        # Answer details
                        pdf.set_font("Helvetica", "B", 10)
                        pdf.cell(0, 5, safe_pdf_str("Suggested Answer / Model Answer:"), ln=True)
                        pdf.set_font("Helvetica", "", 10)
                        pdf.multi_cell(0, 5, safe_pdf_str(q.correct_answer))
                        pdf.ln(1.5)
                        
                        if q.explanation:
                            pdf.set_font("Helvetica", "I", 9)
                            pdf.set_text_color(100, 100, 100)
                            pdf.multi_cell(0, 4.5, safe_pdf_str(f"Marking Criteria & Explanation:\n{q.explanation}"))
                            pdf.set_text_color(0, 0, 0)
                        pdf.ln(2)
            
            pdf.ln(5)
            
        # Output PDF in-memory bytes
        pdf_bytes = pdf.output()
        
        filename = "quiz_questions.pdf" if not req.include_answers else "quiz_answers.pdf"
        return StreamingResponse(
            io.BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
    except Exception as e:
        logger.error(f"Failed to generate PDF: {str(e)}")
        raise HTTPException(status_code=500, detail=f"PDF generation failed: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
