#!/usr/bin/env bash
# Run once in Terminal (outside restricted sandboxes): creates git repo and first commit.
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -d .git ]]; then
  echo "Already a git repo (.git exists). Remove .git first if you want a fresh init."
  exit 1
fi
git init -b main
git add .gitignore README.md index.html app.js styles.css pdf-export.js courses.json Master.pdf \
  tco/*.pdf package.json package-lock.json fill_arf_pdf.py scripts/
git commit -m "Initial commit: ARF scheduler for GitHub Pages"
echo "Done. Next: create a GitHub repo, then:"
echo "  git remote add origin https://github.com/<you>/<repo>.git"
echo "  git push -u origin main"
echo "Then enable Pages: Settings → Pages → Branch main, folder / (root)."
