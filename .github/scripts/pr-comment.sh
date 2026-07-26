#!/usr/bin/env bash
# Sticky PR comment via the GitHub REST API — no `gh` needed (the self-hosted
# runner has curl + python3 but not gh). Finds a prior comment carrying the
# marker and updates it; otherwise creates one. Best-effort: callers should
# invoke with `|| true` so a comment hiccup never fails the deploy.
#
# Usage: pr-comment.sh "<markdown body>"
# Requires env: GH_TOKEN, GITHUB_REPOSITORY, PR
set -uo pipefail

BODY_IN="${1:-}"
MARKER="<!-- pr-preview-bot -->"
API="https://api.github.com/repos/${GITHUB_REPOSITORY}"
FULL="${MARKER}"$'\n'"${BODY_IN}"

# JSON-encode {"body": ...}
JSON=$(FULL="$FULL" python3 -c 'import json,os; print(json.dumps({"body": os.environ["FULL"]}))')

# Find an existing sticky comment id (marker match).
CID=$(curl -sS -H "Authorization: Bearer ${GH_TOKEN}" -H "Accept: application/vnd.github+json" \
  "${API}/issues/${PR}/comments?per_page=100" 2>/dev/null \
  | MARKER="$MARKER" python3 -c 'import sys,json,os
m=os.environ["MARKER"]
try:
    data=json.load(sys.stdin)
except Exception:
    data=[]
ids=[str(c["id"]) for c in data if m in (c.get("body") or "")]
print(ids[0] if ids else "")')

if [ -n "$CID" ]; then
  curl -sS -X PATCH -H "Authorization: Bearer ${GH_TOKEN}" -H "Accept: application/vnd.github+json" \
    "${API}/issues/comments/${CID}" -d "$JSON" >/dev/null
else
  curl -sS -X POST -H "Authorization: Bearer ${GH_TOKEN}" -H "Accept: application/vnd.github+json" \
    "${API}/issues/${PR}/comments" -d "$JSON" >/dev/null
fi
