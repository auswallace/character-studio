#!/usr/bin/env bash
# Start the scorer on 127.0.0.1:8765 (local only). Usage: scripts/scorer/run.sh
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -d .venv ]; then
  python3 -m venv .venv
  .venv/bin/pip install -q -r requirements.txt
fi
exec .venv/bin/uvicorn app:app --host 127.0.0.1 --port "${SCORER_PORT:-8765}" --workers 1
