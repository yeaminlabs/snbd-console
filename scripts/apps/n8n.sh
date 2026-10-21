TOTAL_STEPS=4
step 1 "Checking the system"; ensure_basics
step 2 "Installing Docker if needed"; install_docker
step 3 "Starting n8n"
docker rm -f n8n >/dev/null 2>&1 || true
docker run -d --name n8n --restart unless-stopped -p 127.0.0.1:5678:5678 -v n8n_data:/home/node/.n8n docker.n8n.io/n8nio/n8n
step 4 "Waiting for n8n to answer"
for i in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:5678/healthz >/dev/null 2>&1; then echo "n8n is up."; ok=1; break; fi
  sleep 2
done
[ "${ok:-0}" = 1 ] || { docker logs --tail 30 n8n; die "n8n did not become ready"; }
echo "Done. n8n listens on 127.0.0.1:5678 of this server. Open it with:  ssh -L 5678:127.0.0.1:5678 root@<server-ip>"
