TOTAL_STEPS=2
step 1 "Uninstalling OpenClaw"
npm uninstall -g openclaw 2>/dev/null || true
step 2 "Verifying removal"
if command -v openclaw >/dev/null 2>&1; then
  echo "Warning: openclaw is still in PATH. Manual cleanup may be needed."
else
  echo "Done: OpenClaw has been removed."
fi
