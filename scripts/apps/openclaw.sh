TOTAL_STEPS=4
step 1 "Checking the system"; ensure_basics
step 2 "Installing Node.js 22"; install_node22
step 3 "Installing OpenClaw"; SHARP_IGNORE_GLOBAL_LIBVIPS=1 npm install -g openclaw@latest
step 4 "Verifying"; openclaw --version; echo "Done. Open the terminal tab and run: openclaw onboard --install-daemon"
