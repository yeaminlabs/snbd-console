TOTAL_STEPS=3
step 1 "Removing global npm packages"
if command -v npm >/dev/null 2>&1; then
  npm ls -g --depth=0 --parseable 2>/dev/null | tail -n +2 | xargs -r npm uninstall -g 2>/dev/null || true
fi
step 2 "Removing Node.js"
detect_pm
case "$PM" in
  apt)
    apt-get purge -y nodejs 2>/dev/null || true
    apt-get autoremove -y 2>/dev/null || true
    rm -f /etc/apt/sources.list.d/nodesource.list
    ;;
  dnf|yum)
    "$PM" remove -y nodejs 2>/dev/null || true
    rm -f /etc/yum.repos.d/nodesource*.repo
    ;;
esac
rm -rf /root/.npm
step 3 "Verifying removal"
if command -v node >/dev/null 2>&1; then
  echo "Warning: node binary still present. Reboot may be required."
else
  echo "Done: Node.js has been removed."
fi
