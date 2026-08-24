#!/bin/bash
# deploy-oracle.sh — deploy Freegate LLM proxy to a fresh Oracle Cloud Free Tier VM.
#
# Usage:
#   ./deploy-oracle.sh <VM_IP> [ssh_user]
#   ./deploy-oracle.sh 123.45.67.89 ubuntu
#
# Prereqs (done manually in Oracle console):
#   1. Create VM: Ubuntu 22.04, Ampere A1 (free tier), 4 OCPU / 24GB
#   2. Ingress rule: allow TCP 4000 (and 22) for 0.0.0.0/0
#   3. Have the VM's public IP
#
# What it does:
#   - Installs Node.js 20 LTS
#   - Copies the proxy (server.js + lib + config + .env) via rsync
#   - Installs as a systemd service (auto-start, auto-restart)
#   - Opens the firewall for port 4000
#   - Prints the public endpoint + how to point opencode at it

set -euo pipefail

VM_IP="${1:?Usage: deploy-oracle.sh <VM_IP> [ssh_user]}"
SSH_USER="${2:-ubuntu}"
PROXY_DIR="$HOME/.config/opencode/llm-proxy"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519}"
AUTH="${AUTH:-free-llm-proxy-2024}"

echo "=== Freegate deploy → $SSH_USER@$VM_IP ==="

# 1. Wait for SSH to come up
echo "[1/6] Ждём SSH на $VM_IP..."
for i in $(seq 1 30); do
  if ssh -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=5 "$SSH_USER@$VM_IP" "echo ok" >/dev/null 2>&1; then
    echo "      SSH доступен"
    break
  fi
  [ "$i" -eq 30 ] && { echo "      SSH не поднялся за 30 попыток"; exit 1; }
  sleep 10
done

# 2. Install Node.js 20
echo "[2/6] Устанавливаем Node.js 20..."
ssh -i "$SSH_KEY" "$SSH_USER@$VM_IP" '
  set -e
  export DEBIAN_FRONTEND=noninteractive
  sudo apt-get update -qq
  if ! command -v node >/dev/null 2>&1 || ! node -v | grep -q v20; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y -qq nodejs
  fi
  node -v && npm -v
'

# 3. Copy proxy files (exclude secrets from git but send .env explicitly)
echo "[3/6] Копируем прокси..."
ssh -i "$SSH_KEY" "$SSH_USER@$VM_IP" "mkdir -p ~/llm-proxy"
rsync -az --exclude='.git' --exclude='node_modules' --exclude='*.log*' \
  --exclude='state.json' --exclude='cache.json' --exclude='watchdog.log' \
  -e "ssh -i $SSH_KEY" \
  "$PROXY_DIR/" "$SSH_USER@$VM_IP:~/llm-proxy/"
# .env is gitignored so not in the copy above — send explicitly
if [ -f "$PROXY_DIR/.env" ]; then
  scp -i "$SSH_KEY" "$PROXY_DIR/.env" "$SSH_USER@$VM_IP:~/llm-proxy/.env"
else
  echo "      ВНИМАНИЕ: нет .env — прокси не найдёт ключи провайдеров"
fi

# 4. Create systemd service (auto-start + auto-restart)
echo "[4/6] Настраиваем systemd-службу..."
ssh -i "$SSH_KEY" "$SSH_USER@$VM_IP" "
  cat > /tmp/llm-proxy.service << 'UNIT'
[Unit]
Description=Freegate LLM proxy
After=network.target

[Service]
WorkingDirectory=/home/$SSH_USER/llm-proxy
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
Environment=PORT=4000
Environment=AUTH=$AUTH

[Install]
WantedBy=multi-user.target
UNIT
  sudo mv /tmp/llm-proxy.service /etc/systemd/system/llm-proxy.service
  sudo systemctl daemon-reload
  sudo systemctl enable llm-proxy
  sudo systemctl restart llm-proxy
  sleep 3
  sudo systemctl status llm-proxy --no-pager | head -8 || true
"

# 5. Open firewall
echo "[5/6] Открываем порт 4000..."
ssh -i "$SSH_KEY" "$SSH_USER@$VM_IP" "
  sudo ufw allow 4000/tcp >/dev/null 2>&1 || true
  sudo ufw allow OpenSSH >/dev/null 2>&1 || true
  echo y | sudo ufw enable >/dev/null 2>&1 || true
  sudo ufw status | grep -E '4000|22' || true
"

# 6. Verify + print config
echo "[6/6] Проверяем..."
PUBLIC_URL="http://$VM_IP:4000"
sleep 2
STATUS=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$PUBLIC_URL/health" || echo "down")
echo ""
echo "=== ГОТОВО ==="
echo "  Health:   $PUBLIC_URL/health  → HTTP $STATUS"
echo ""
if [ "$STATUS" = "200" ]; then
  echo "Прокси на сервере работает!"
  echo ""
  echo "Добавь в ~/.config/opencode/opencode.jsonc новый провайдер:"
  echo ""
  cat << CFG
    "free-proxy-oracle": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Freegate (Oracle)",
      "options": {
        "baseURL": "$PUBLIC_URL/v1",
        "apiKey": "$AUTH"
      },
      "models": {
        "tier-splus": {
          "name": "Freegate Remote (Best)",
          "attachment": true,
          "reasoning": false,
          "input": ["text"],
          "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
          "contextWindow": 1000000,
          "maxTokens": 16384
        },
        "tier-s": {
          "name": "Freegate Remote (Fast)",
          "attachment": true,
          "reasoning": false,
          "input": ["text"],
          "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
          "contextWindow": 1000000,
          "maxTokens": 8192
        }
      }
    },
CFG
  echo ""
  echo "После этого перезапусти opencode и выбери модель Freegate Remote."
else
  echo "Прокси НЕ отвечает — проверь:"
  echo "  - В Oracle консоли: Networking → Security Lists → добавь Ingress правило TCP 4000"
  echo "  - sudo systemctl status llm-proxy на сервере"
fi
