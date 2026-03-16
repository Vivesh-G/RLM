## Prerequisites

- Python 3.10+
- [Deno](https://deno.land/) installed (required for RLM's sandboxed Python REPL)

  ```bash
  # Install Deno
  curl -fsSL https://deno.land/install.sh | sh
  ```

## Installation

1. Clone the repository and navigate to the project directory:

   ```bash
   cd Dspy
   ```

2. Install dependencies:

   ```bash
   uv sync .
   ```

3. Set your Groq API key:

   ```bash
   export GROQ_API_KEY=your_api_key_here
   ```

## Running the Application

Start the FastAPI server:

```bash
uvicorn main:app --reload --port 8000
```

Open your browser to `http://localhost:8000`