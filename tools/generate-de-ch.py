#!/usr/bin/env python3
"""Regenerate src/i18n/de-ch.json (Swiss Standard German) from src/i18n/de.json.

Usage:
    python3 tools/generate-de-ch.py          # rewrite src/i18n/de-ch.json
    python3 tools/generate-de-ch.py --check  # exit 1 if it is out of date

Swiss Standard German differs from the German of de.json by its orthography,
not its vocabulary: no eszett ("Grösse" rather than "Größe") and
guillemets instead of the low-high German quotes. de-ch.json therefore holds
only the strings these rules change. The interface falls back de-ch -> de -> en
(poznoteI18nLanguageChain() in src/lib/i18n.php), so every other string is read
from de.json and a new German string never has to be written twice.

Run it after changing de.json. tests/swiss-german-i18n.test.php fails when
de-ch.json no longer matches what this script would write.

Contributed as a full dictionary by phelex in PR #1755; the rules below are
exactly the changes that file made, minus the ellipsis character, which is not
a Swiss difference and stays "..." like in every other dictionary.
"""

import collections
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SOURCE = ROOT / "src" / "i18n" / "de.json"
TARGET = ROOT / "src" / "i18n" / "de-ch.json"


def swiss(text):
    text = text.replace("ß", "ss")  # ß
    text = re.sub("„(.*?)“", "«\\1»", text, flags=re.S)  # „…“ -> «…»
    text = re.sub("‚(.*?)‘", "‹\\1›", text, flags=re.S)  # ‚…‘ -> ‹…›
    return text


def overrides(node):
    """The part of the German tree the Swiss rules change, same key order."""
    out = collections.OrderedDict()
    for key, value in node.items():
        if isinstance(value, dict):
            sub = overrides(value)
            if sub:
                out[key] = sub
        elif isinstance(value, str) and swiss(value) != value:
            out[key] = swiss(value)
    return out


def render():
    with SOURCE.open(encoding="utf-8") as fh:
        german = json.load(fh, object_pairs_hook=collections.OrderedDict)
    return json.dumps(overrides(german), ensure_ascii=False, indent=2) + "\n"


def main():
    text = render()
    if "--check" in sys.argv[1:]:
        current = TARGET.read_text(encoding="utf-8") if TARGET.exists() else ""
        if current != text:
            print("src/i18n/de-ch.json is out of date: run python3 tools/generate-de-ch.py", file=sys.stderr)
            return 1
        return 0
    TARGET.write_text(text, encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
