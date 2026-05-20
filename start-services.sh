#!/bin/bash
# =============================================================
# AI Zona — Скрипт запуска сайта https://ai.zona.pp.ua
# Запускает Flask-сервер и Cloudflared Quick Tunnel
# Использование: bash /home/ubuntu/start-services.sh
# =============================================================

SITE_DIR="/var/www/ai.zona.pp.ua"
LOG_DIR="/var/log/ai-zona"
FLASK_PORT=5000
FLASK_HOST="127.0.0.1"

# Создаём папку логов
mkdir -p "$LOG_DIR" 2>/dev/null || sudo mkdir -p "$LOG_DIR" && sudo chown $(whoami):$(whoami) "$LOG_DIR"

echo "========================================"
echo "  AI Zona — Запуск сервисов"
echo "========================================"

# 1. Остановить старые процессы
echo "[1/3] Останавливаю старые процессы..."
pkill -f "python.*app.py" 2>/dev/null
pkill -f "cloudflared.*tunnel" 2>/dev/null
sleep 1

# 2. Запустить Flask-сервер
echo "[2/3] Запускаю Flask-сервер на ${FLASK_HOST}:${FLASK_PORT}..."
cd "$SITE_DIR"
nohup python app.py > "$LOG_DIR/flask.log" 2>&1 &
FLASK_PID=$!
echo "  Flask PID: $FLASK_PID"

# Ждём пока сервер поднимется
sleep 3
if curl -s -o /dev/null -w "%{http_code}" "http://${FLASK_HOST}:${FLASK_PORT}/login" | grep -q "200"; then
    echo "  Flask сервер запущен успешно!"
else
    echo "  ОШИБКА: Flask сервер не отвечает!"
    cat "$LOG_DIR/flask.log"
    exit 1
fi

# 3. Запустить Cloudflared Quick Tunnel
echo "[3/3] Запускаю Cloudflared tunnel..."
# ------ ВАРИАНТЫ ЗАПУСКА ТУННЕЛЯ ------
#
# Вариант A: Quick Tunnel (временный URL *.trycloudflare.com)
#   Используется по умолчанию. Не требует авторизации.
#
# Вариант B: Named Tunnel с токеном (для постоянного домена ai.zona.pp.ua)
#   Раскомментируйте строку ниже и замените YOUR_TUNNEL_TOKEN:
#   nohup cloudflared tunnel run --token YOUR_TUNNEL_TOKEN > "$LOG_DIR/cloudflared.log" 2>&1 &
#
# Вариант C: Named Tunnel с конфигом
#   nohup cloudflared tunnel --config /home/ubuntu/.cloudflared/config.yml run > "$LOG_DIR/cloudflared.log" 2>&1 &
# --------------------------------------

nohup cloudflared tunnel --url "http://${FLASK_HOST}:${FLASK_PORT}" --protocol http2 > "$LOG_DIR/cloudflared.log" 2>&1 &
TUNNEL_PID=$!
echo "  Cloudflared PID: $TUNNEL_PID"

# Ждём URL туннеля
sleep 10
TUNNEL_URL=$(grep -oP 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' "$LOG_DIR/cloudflared.log" 2>/dev/null | head -1)

echo ""
echo "========================================"
echo "  ГОТОВО! Сервисы запущены:"
echo "========================================"
echo "  Flask:       http://${FLASK_HOST}:${FLASK_PORT}"
if [ -n "$TUNNEL_URL" ]; then
    echo "  Tunnel URL:  $TUNNEL_URL"
else
    echo "  Tunnel URL:  (загружается... см. $LOG_DIR/cloudflared.log)"
fi
echo ""
echo "  Логи Flask:       $LOG_DIR/flask.log"
echo "  Логи Cloudflared: $LOG_DIR/cloudflared.log"
echo ""
echo "  Для остановки:  pkill -f 'python.*app.py'; pkill -f cloudflared"
echo "========================================"
