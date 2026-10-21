TOTAL_STEPS=3
step 1 "Checking the system"; ensure_basics
step 2 "Installing Node.js 22"; install_node22
step 3 "Verifying"; node --version; npm --version; echo "Done: Node.js is ready."
