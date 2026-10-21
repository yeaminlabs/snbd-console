TOTAL_STEPS=4
step 1 "Checking the system"; ensure_basics
step 2 "Installing Node.js 22"; install_node22
step 3 "Installing Claude Code"; npm install -g @anthropic-ai/claude-code
step 4 "Verifying"; claude --version; echo "Done. Open the terminal tab, run: claude   (it will ask you to sign in)"
