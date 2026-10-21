TOTAL_STEPS=3
step 1 "Checking the system"; ensure_basics
step 2 "Running the official Hermes Agent installer"; curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash -s -- --skip-setup
step 3 "Verifying"; { /root/.local/bin/hermes --version || hermes --version; }; echo "Done. Open the terminal tab and run: hermes setup"
