"""程式規模檢查：列出超過門檻的檔案與函式，作為提出重構建議的依據（只提醒，不會失敗）。
執行：python3 tools/code_size.py
門檻與 CLAUDE.md「程式規模與重構」一致：單一檔案超過 FILE_MAX 行、單一函式超過 FUNC_MAX 行。"""
import ast
import os
import re
import sys

FILE_MAX = 1000
FUNC_MAX = 120
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKIP_DIRS = {".git", "node_modules", "__pycache__", "games", "wall"}   # games、wall 是獨立的小專案／第三方程式
SKIP_FILES = {"returns.html"}   # 排程產生的頁面（內含資料）


def code_files():
    for dp, dns, fns in os.walk(ROOT):
        dns[:] = [d for d in dns if d not in SKIP_DIRS and not d.startswith(".")]
        for fn in fns:
            if fn.endswith((".py", ".js", ".html", ".css")) and fn not in SKIP_FILES:
                yield os.path.join(dp, fn)


def py_funcs(src):
    for n in ast.walk(ast.parse(src)):
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
            yield n.name, n.lineno, n.end_lineno - n.lineno + 1


def js_funcs(src):
    """頂層函式（function x / async function x / const x = (...) =>）到對應的右大括號為止"""
    lines = src.split("\n")
    for i, line in enumerate(lines):
        m = re.match(r"^(?:async\s+)?function\s+(\w+)|^const\s+(\w+)\s*=\s*(?:async\s*)?\(.*\)\s*=>\s*\{\s*$", line)
        if not m or re.search(r"=\s*\(\s*(?:async\s*)?\(", line):   # 略過模組外殼 const X = (() => { … })()
            continue
        depth, j = 0, i
        while j < len(lines):
            depth += lines[j].count("{") - lines[j].count("}")
            if depth <= 0 and j > i:
                break
            j += 1
        yield m.group(1) or m.group(2), i + 1, j - i + 1


def main():
    found = []
    for p in sorted(code_files()):
        rel = os.path.relpath(p, ROOT)
        src = open(p, encoding="utf-8").read()
        n = src.count("\n") + 1
        if n > FILE_MAX:
            found.append("檔案 %s：%d 行（門檻 %d）" % (rel, n, FILE_MAX))
        funcs = py_funcs(src) if p.endswith(".py") else js_funcs(src) if p.endswith(".js") else []
        for name, line, size in funcs:
            if size > FUNC_MAX:
                found.append("函式 %s:%d %s()：%d 行（門檻 %d）" % (rel, line, name, size, FUNC_MAX))
    if found:
        print("建議評估重構（見 .claude/skills/refactor/SKILL.md）：")
        for f in found:
            print("  - " + f)
    else:
        print("程式規模都在門檻內（檔案 ≤ %d 行、函式 ≤ %d 行）" % (FILE_MAX, FUNC_MAX))
    return 0


if __name__ == "__main__":
    sys.exit(main())
