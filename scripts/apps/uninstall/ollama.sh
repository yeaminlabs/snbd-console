TOTAL_STEPS=3
step 1 "Stopping the Ollama service"
systemctl stop ollama 2>/dev/null || true
systemctl disable ollama 2>/dev/null || true
step 2 "Removing Ollama binary and service"
rm -f /usr/local/bin/ollama
rm -f /etc/systemd/system/ollama.service
systemctl daemon-reload 2>/dev/null || true
step 3 "Verifying removal"
if command -v ollama >/dev/null 2>&1; then
  echo "Warning: ollama binary still present. Manual cleanup may be needed."
else
  echo "Done: Ollama has been removed."
  echo "Note: downloaded models in /usr/share/ollama or ~/.ollama were not deleted. Remove them manually if you want to free disk space."
fi
