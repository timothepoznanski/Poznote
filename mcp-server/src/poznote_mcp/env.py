"""Read a setting from the environment, or from a file named by <NAME>_FILE.

The same convention as the postgres and mariadb images (discussion #1815):
with POZNOTE_MCP_AUTH_TOKEN_FILE=/run/secrets/mcp_token, the token is read
from that file, so `docker inspect` shows a path and not the secret.
"""

from __future__ import annotations

import os


class SecretFileError(RuntimeError):
    """A <NAME>_FILE setting that cannot be honoured. Startup must stop."""


def env_or_file(name: str) -> str | None:
    """Return the value of NAME, read from the file NAME_FILE names if set.

    A blank NAME counts as unset: docker-compose.yml passes every variable to
    the container, empty when the .env file does not set it. Setting both a
    value and a file is refused rather than one of them winning silently, and
    a file that cannot be read stops startup instead of falling back to an
    empty secret, which for a token means an open endpoint. Only trailing line
    breaks are removed (a secrets file usually ends with one), so a value that
    ends with a space keeps it.
    """
    file_name = name + "_FILE"
    path = (os.getenv(file_name) or "").strip()
    if not path:
        return os.getenv(name)

    if (os.getenv(name) or "").strip():
        raise SecretFileError(
            f"Both {name} and {file_name} are set. Set only one of them."
        )
    try:
        with open(path, encoding="utf-8") as handle:
            value = handle.read()
    except (OSError, UnicodeDecodeError) as exc:
        raise SecretFileError(
            f"{file_name} points to {path}, which cannot be read ({exc}). "
            "Check the path and that the file is readable inside the container "
            "(the MCP server image runs as uid 1000)."
        ) from exc
    return value.rstrip("\r\n")
