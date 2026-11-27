TOTAL_STEPS=2
step 1 "Uninstalling Claude Code"
npm uninstall -g @anthropic-ai/claude-code 2>/dev/null || true
step 2 "Verifying removal"
if command -v claude >/dev/null 2>&1; then
  echo "Warning: claude is still in PATH (may be a symlink from another install). Manual cleanup may be needed."
else
  echo "Done: Claude Code has been removed."
fi
