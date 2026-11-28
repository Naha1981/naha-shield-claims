#!/usr/bin/env bash
# Deploy the static RC preview to GitHub Pages (branch preview-pages).
# Usage: scripts/deploy-pages.sh "commit message"
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"
VITE_STATIC_PREVIEW=true npx vite build --base=/claim-trace/
cp dist/index.html dist/404.html
WT=/tmp/pages-deploy
git worktree remove "$WT" --force 2>/dev/null || true
rm -rf "$WT"
git fetch origin preview-pages
git worktree add "$WT" origin/preview-pages --detach >/dev/null
(cd "$WT" && git checkout -B preview-pages -q && find . -mindepth 1 -maxdepth 1 ! -name '.git' -exec rm -rf {} +)
cp -r dist/. "$WT/"
cp dist/.nojekyll "$WT/" 2>/dev/null || true
(cd "$WT" && git add -A && git commit -q -m "${1:-RC static preview rebuild}" && git push origin preview-pages)
git worktree remove "$WT" --force
echo "Deployed. Verify: https://naha1981.github.io/claim-trace/"
