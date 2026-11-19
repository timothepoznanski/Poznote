"""The usage guide served as instructions and as a resource (issue #1800)."""

import asyncio
import re
from types import SimpleNamespace

from fastmcp.server.auth import AccessToken, AuthContext

from poznote_mcp import server
from poznote_mcp.guide import GUIDE, GUIDE_RESOURCE_NAME, GUIDE_URI
from poznote_mcp.server import TOOL_SCOPES, _caller_scope_check


def test_the_guide_is_the_server_instructions():
    assert server.mcp.instructions == GUIDE


def test_the_guide_is_readable_as_a_resource():
    async def read():
        resources = await server.mcp.list_resources(run_middleware=False)
        assert GUIDE_URI in {str(r.uri) for r in resources}
        result = await server.mcp.read_resource(GUIDE_URI)
        return result.contents[0].content

    assert asyncio.run(read()) == GUIDE


def test_every_tool_the_guide_names_exists():
    # A word with an underscore that names no tool is a tool renamed or
    # removed since the guide was written, unless it is one of these.
    not_tools = {
        "note_type", "if_version", "version_conflict", "note_locked",
        "note_is_locked", "write_outcome_unknown", "next_offset", "max_chars",
        "updated_from", "updated_to", "due_before", "due_after", "reminder_at",
        "user_id", "mcp_default_workspace",
    }
    named = set(re.findall(r"\b[a-z]+(?:_[a-z]+)+\b", GUIDE)) - not_tools
    assert named, "the guide should name tools"
    assert named <= set(TOOL_SCOPES), sorted(named - set(TOOL_SCOPES))


def test_the_guide_stays_short():
    # Every connected session pays for it: about 1,100 tokens today.
    assert len(GUIDE) < 7000


def _ctx(scopes, name):
    return AuthContext(
        token=AccessToken(token="t", client_id="c", scopes=scopes),
        component=SimpleNamespace(name=name),
    )


def test_a_read_only_caller_can_read_the_guide():
    assert _caller_scope_check(_ctx(["read"], GUIDE_RESOURCE_NAME))
    assert _caller_scope_check(_ctx([], GUIDE_RESOURCE_NAME))


def test_an_unclassified_component_is_still_refused_to_a_scoped_caller():
    assert not _caller_scope_check(_ctx(["admin"], "something_unlisted"))
