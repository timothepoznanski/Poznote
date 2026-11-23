"""<NAME>_FILE settings (#1815): secrets read from a file, not the environment."""

import pytest

from poznote_mcp.auth_external import ExternalAuthConfig
from poznote_mcp.env import SecretFileError, env_or_file
from poznote_mcp.server import AUTH_TOKEN_ENV, _load_inbound_auth_token

NAME = "POZNOTE_TEST_SECRET"


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    for name in (NAME, NAME + "_FILE", AUTH_TOKEN_ENV, AUTH_TOKEN_ENV + "_FILE"):
        monkeypatch.delenv(name, raising=False)


def test_plain_variable_is_unchanged(monkeypatch):
    monkeypatch.setenv(NAME, "value")
    assert env_or_file(NAME) == "value"


def test_unset_returns_none():
    assert env_or_file(NAME) is None


def test_file_is_read_and_trailing_line_breaks_removed(monkeypatch, tmp_path):
    secret = tmp_path / "secret"
    secret.write_text("s3cret \r\n\n", encoding="utf-8")
    monkeypatch.setenv(NAME + "_FILE", str(secret))
    assert env_or_file(NAME) == "s3cret "


def test_blank_variable_next_to_a_file_is_ignored(monkeypatch, tmp_path):
    # docker-compose.yml passes every variable, empty when .env lacks it.
    secret = tmp_path / "secret"
    secret.write_text("from-file\n", encoding="utf-8")
    monkeypatch.setenv(NAME, "")
    monkeypatch.setenv(NAME + "_FILE", str(secret))
    assert env_or_file(NAME) == "from-file"


def test_blank_file_variable_falls_back_to_the_value(monkeypatch):
    monkeypatch.setenv(NAME, "value")
    monkeypatch.setenv(NAME + "_FILE", "  ")
    assert env_or_file(NAME) == "value"


def test_both_set_is_refused(monkeypatch, tmp_path):
    secret = tmp_path / "secret"
    secret.write_text("from-file", encoding="utf-8")
    monkeypatch.setenv(NAME, "value")
    monkeypatch.setenv(NAME + "_FILE", str(secret))
    with pytest.raises(SecretFileError, match="Set only one"):
        env_or_file(NAME)


def test_missing_file_is_refused_not_empty(monkeypatch, tmp_path):
    monkeypatch.setenv(NAME + "_FILE", str(tmp_path / "missing"))
    with pytest.raises(SecretFileError, match=NAME + "_FILE"):
        env_or_file(NAME)


def test_inbound_token_from_file(monkeypatch, tmp_path):
    secret = tmp_path / "token"
    secret.write_text("abc123\n", encoding="utf-8")
    monkeypatch.setenv(AUTH_TOKEN_ENV, "")
    monkeypatch.setenv(AUTH_TOKEN_ENV + "_FILE", str(secret))
    assert _load_inbound_auth_token() == "abc123"


def test_unreadable_token_file_stops_instead_of_opening_the_endpoint(monkeypatch, tmp_path):
    monkeypatch.setenv(AUTH_TOKEN_ENV + "_FILE", str(tmp_path / "missing"))
    with pytest.raises(SecretFileError):
        _load_inbound_auth_token()


def test_introspection_client_secret_from_file(monkeypatch, tmp_path):
    secret = tmp_path / "client_secret"
    secret.write_text("cs-from-file\n", encoding="utf-8")
    monkeypatch.setenv("POZNOTE_MCP_AUTH_PROVIDER", "introspection")
    monkeypatch.setenv("POZNOTE_MCP_AUTH_URL", "https://idp.example.com/introspect")
    monkeypatch.setenv("POZNOTE_MCP_AUTH_CLIENT_ID", "poznote")
    monkeypatch.delenv("POZNOTE_MCP_AUTH_CLIENT_SECRET", raising=False)
    monkeypatch.setenv("POZNOTE_MCP_AUTH_CLIENT_SECRET_FILE", str(secret))
    config = ExternalAuthConfig.from_env()
    assert config is not None
    assert config.client_secret == "cs-from-file"
