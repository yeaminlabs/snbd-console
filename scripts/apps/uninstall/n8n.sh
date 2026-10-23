TOTAL_STEPS=2
step 1 "Removing n8n container and data volume"
if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed; nothing to remove."
else
  docker stop n8n 2>/dev/null || true
  docker rm -f n8n 2>/dev/null || true
  docker volume rm n8n_data 2>/dev/null || true
  echo "n8n container and data volume removed."
fi
step 2 "Done"
echo "n8n has been removed. Docker Engine is still installed."
