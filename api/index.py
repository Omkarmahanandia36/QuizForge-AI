import sys
import os

# Add parent directory (repository root) to sys.path so we can import main.py
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from main import app
