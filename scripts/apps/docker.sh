TOTAL_STEPS=3
step 1 "Checking the system"; ensure_basics
step 2 "Installing Docker Engine"; install_docker
step 3 "Verifying"; docker --version; docker compose version || true; echo "Done: Docker is ready."
