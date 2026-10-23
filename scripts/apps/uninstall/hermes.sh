TOTAL_STEPS=2
step 1 "Removing Hermes Agent"
rm -f /root/.local/bin/hermes
if command -v hermes >/dev/null 2>&1; then
  rm -f "$(command -v hermes)" 2>/dev/null || true
fi
step 2 "Verifying removal"
if { [ -x /root/.local/bin/hermes ] || command -v hermes >/dev/null 2>&1; }; then
  echo "Warning: hermes binary still found. Manual cleanup may be needed."
else
  echo "Done: Hermes Agent has been removed."
fi
