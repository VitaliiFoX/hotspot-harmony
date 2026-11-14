"""Fail when Cyrillic text reaches the repo: tracked files, new commit messages, the PR title or body.

The project language is English (see CLAUDE.md). The team writes Ukrainian day to day, so Cyrillic
letters are the realistic way for another language to slip in; other scripts are not checked.

Usage:  python3 scripts/check_english.py [<commit range>]      (default range: origin/main..HEAD)
In CI the range comes from COMMIT_RANGE and the PR text from PR_TITLE / PR_BODY.
"""

import os
import re
import subprocess
import sys

# Unicode blocks "Cyrillic" and "Cyrillic Supplement", written as code points so this file passes its own check
CYRILLIC = re.compile(f"[{chr(0x0400)}-{chr(0x052F)}]")


def git(*args: str) -> str:
    return subprocess.run(["git", *args], capture_output=True, text=True, check=True).stdout


def cyrillic_lines(label: str, text: str) -> list[str]:
    return [f"{label}:{n}: {line.strip()}" for n, line in enumerate(text.splitlines(), 1) if CYRILLIC.search(line)]


def commit_messages(commit_range: str) -> str:
    try:
        return git("log", "--format=%h %s%n%b", commit_range)
    except subprocess.CalledProcessError:  # range not available in this clone: check the last commit only
        return git("log", "-1", "--format=%h %s%n%b")


def main() -> int:
    commit_range = (sys.argv[1:] or [os.environ.get("COMMIT_RANGE") or "origin/main..HEAD"])[0]
    found: list[str] = []
    for path in git("ls-files", "-z").split("\0"):
        if not path or not os.path.isfile(path):
            continue
        with open(path, encoding="utf-8", errors="ignore") as f:
            found += cyrillic_lines(path, f.read())
    found += cyrillic_lines(f"commit message ({commit_range})", commit_messages(commit_range))
    found += cyrillic_lines("PR title", os.environ.get("PR_TITLE", ""))
    found += cyrillic_lines("PR body", os.environ.get("PR_BODY", ""))
    if found:
        print("Non-English (Cyrillic) text found. Everything in this repo is written in English:\n")
        print("\n".join(found))
        return 1
    print("check_english: ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
