#!/usr/bin/env python3
"""Push the working tree to GitHub via the REST Git Database API (no local git).

Usage: python3 scripts/push.py "commit message"
Token: Keychain internet password for github.com.
"""
import base64
import json
import os
import subprocess
import sys
import urllib.request

REPO = "codeico/organic-growth-analytics"
BRANCH = "main"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IGNORE_DIRS = {"node_modules", "dist", "coverage", ".vercel", ".hermes", ".playwright-mcp", ".git", ".temp"}
IGNORE_FILES = {".DS_Store"}


def token():
    return subprocess.run(
        ["security", "find-internet-password", "-s", "github.com", "-w"],
        capture_output=True, text=True, check=True,
    ).stdout.strip()


TOKEN = token()


def api(method, path, body=None):
    req = urllib.request.Request(
        f"https://api.github.com{path}",
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
        headers={"Authorization": f"Bearer {TOKEN}", "Accept": "application/vnd.github+json", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req) as r:
        return json.load(r)


def files():
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in IGNORE_DIRS]
        for f in filenames:
            if f in IGNORE_FILES or f.startswith(".env") and f != ".env.example" or f.endswith(".tsbuildinfo"):
                continue
            yield os.path.relpath(os.path.join(dirpath, f), ROOT)


def main():
    msg = sys.argv[1] if len(sys.argv) > 1 else "update"
    head = api("GET", f"/repos/{REPO}/git/ref/heads/{BRANCH}")["object"]["sha"]
    tree = []
    for rel in sorted(files()):
        with open(os.path.join(ROOT, rel), "rb") as fh:
            data = fh.read()
        blob = api("POST", f"/repos/{REPO}/git/blobs", {"content": base64.b64encode(data).decode(), "encoding": "base64"})
        mode = "100755" if os.access(os.path.join(ROOT, rel), os.X_OK) else "100644"
        tree.append({"path": rel, "mode": mode, "type": "blob", "sha": blob["sha"]})
    # Full tree (no base_tree) so deletions are reflected too.
    new_tree = api("POST", f"/repos/{REPO}/git/trees", {"tree": tree})
    commit = api("POST", f"/repos/{REPO}/git/commits", {"message": msg, "tree": new_tree["sha"], "parents": [head]})
    api("PATCH", f"/repos/{REPO}/git/refs/heads/{BRANCH}", {"sha": commit["sha"], "force": False})
    print(f"{len(tree)} files -> {commit['sha'][:12]}")


if __name__ == "__main__":
    main()
