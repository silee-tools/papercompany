#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STABLE_DIR="$(cd "$SCRIPT_DIR/../../papercompany-stable" && pwd)"

echo "📦 Updating stable instance at: $STABLE_DIR"

cd "$STABLE_DIR"
git checkout main
git pull origin main

echo "📥 Installing dependencies..."
pnpm install

echo "🔨 Building UI..."
pnpm --filter @paperclipai/ui build

echo "✅ 업데이트 완료. 서버를 재시작하세요: pnpm dev:once"
