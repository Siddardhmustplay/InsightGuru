# Flask Backend Setup

This React application requires a Flask backend to handle file uploads and chat queries. Follow these steps to set up the backend:

## Prerequisites

- Python 3.7+
- pip

## Installation

1. Create a new directory for your Flask backend:
```bash
mkdir flask-backend
cd flask-backend
```

2. Create a virtual environment:
```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

3. Install required dependencies:
```bash
pip install flask openai pandas sqlite3 plotly flask-cors
```

## Flask Backend Code

Create a file named `app.py` with the provided Flask code, but make sure to add CORS support:

```python
from flask import Flask, request, jsonify
from flask_cors import CORS
import openai
import pandas as pd
import sqlite3
import plotly.express as px
import json
import base64
import os
import io
import tempfile
import traceback
from io import BytesIO

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

# Set OpenAI API key from environment variables
openai.api_key = "your-openai-api-key"  # Replace with your OpenAI API key

# ... rest of your Flask code
```

## Important Notes

1. **CORS Configuration**: Make sure to install and configure `flask-cors` to allow requests from your React frontend (running on port 3000 by default).

2. **OpenAI API Key**: Replace `"your-openai-api-key"` with your actual OpenAI API key.

3. **Port Configuration**: The React app expects the Flask backend to run on `http://localhost:5000`. If you need to change this, update the `API_BASE_URL` in `src/lib/api.ts`.

## Running the Backend

1. Make sure your virtual environment is activated
2. Set your OpenAI API key:
```bash
export OPENAI_API_KEY="your-actual-api-key"  # On Windows: set OPENAI_API_KEY=your-actual-api-key
```
3. Run the Flask app:
```bash
python app.py
```

The backend should now be running on `http://localhost:5000`.

## Testing the Integration

1. Start your Flask backend on port 5000
2. Start your React frontend (usually on port 3000)
3. Upload a CSV or Excel file through the React interface
4. Navigate to the chat interface and ask questions about your data

## Troubleshooting

- **CORS Errors**: Make sure `flask-cors` is installed and properly configured
- **Connection Refused**: Ensure the Flask backend is running on port 5000
- **OpenAI Errors**: Verify your OpenAI API key is correctly set and has sufficient credits
- **File Upload Issues**: Check that your uploaded file is in CSV or Excel format