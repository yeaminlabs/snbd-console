TOTAL_STEPS=3
step 1 "Checking the system"; ensure_basics
step 2 "Running the official Ollama installer"; curl -fsSL https://ollama.com/install.sh | sh
step 3 "Verifying"; ollama --version; echo "Done. Open the terminal tab and run: ollama run llama3.2"
