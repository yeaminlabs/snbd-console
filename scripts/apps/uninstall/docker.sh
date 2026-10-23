TOTAL_STEPS=3
step 1 "Stopping all containers"
if command -v docker >/dev/null 2>&1; then
  docker ps -q | xargs -r docker stop 2>/dev/null || true
  docker ps -aq | xargs -r docker rm -f 2>/dev/null || true
fi
step 2 "Removing Docker Engine"
detect_pm
case "$PM" in
  apt)
    apt-get purge -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin 2>/dev/null || true
    apt-get autoremove -y 2>/dev/null || true
    ;;
  dnf|yum)
    "$PM" remove -y docker-ce docker-ce-cli containerd.io docker-compose-plugin 2>/dev/null || true
    ;;
esac
rm -rf /var/lib/docker /var/lib/containerd
step 3 "Verifying removal"
if command -v docker >/dev/null 2>&1; then
  echo "Warning: docker binary still present. Reboot may be required."
else
  echo "Done: Docker Engine has been removed."
fi
