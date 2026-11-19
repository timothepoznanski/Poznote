"""The usage guide this server hands to agents (issue #1800).

One text, served two ways: as the server's MCP `instructions`, which clients
such as Claude and VS Code put in the agent's context when they connect, and
as the `poznote://guide` resource, for clients that ignore instructions or for
an agent that wants to read it again.

It covers what the tool descriptions cannot say on their own: how the tools
fit together, which one to reach for, and what an error asks the agent to do.
It does not repeat the parameters, which each tool already documents. Keep it
short, since every connected session pays for it, and keep it true: a tool
renamed or a rule changed in server.py must be followed here, which
tests/test_guide.py checks for tool names.
"""

GUIDE_URI = "poznote://guide"
GUIDE_RESOURCE_NAME = "poznote_guide"

GUIDE = """\
Poznote is a self-hosted note app. These tools act on one Poznote account. \
Read this before the first call; each tool's own description gives its \
parameters.

## How notes are organised

An account has workspaces (list_workspaces), each holding a tree of folders \
(list_folders) and notes. A note has a title, tags, a folder and a type: \
"note" (HTML), "markdown", "tasklist" (tasks stored as JSON) or "excalidraw" \
(a drawing). Write content in the format of the note you are editing. New \
notes are HTML unless you pass note_type="markdown".

## Finding a note

- search_notes requires every word of the query (mode="all"), anywhere in the \
title or body; quote words that must stay together. Filter with tags, folder \
and updated_from/updated_to ("what changed since Monday").
- Any tool that takes a note id also accepts path="Folder/Sub/Exact title" \
instead (just the title for a note at a workspace root). Pass one, never both. \
An ambiguous path is refused with the candidates listed; nothing is picked \
for you. A title containing "/" can only be reached by id.
- list_notes pages through a workspace; get_backlinks lists the notes linking \
to one.

## Workspaces when writing

When a write names no workspace, it goes to the account's default: the \
mcp_default_workspace setting, or the only workspace there is. With several \
workspaces and no setting, the call is refused and lists them: ask the user \
which one, or pass workspace explicitly. Never guess.

## Reading and editing long notes

Do not read and resend a whole long note to change a part of it.

- get_note_outline returns the headings with their offsets, without the \
content. get_note(offset=..., max_chars=...) reads one part; follow \
next_offset until it is null.
- append_to_note adds to the end (logs, journals, status pages).
- replace_section rewrites (mode="replace") or extends (mode="append") the \
section under a heading, subsections included. Check the outline first if you \
only meant to change one paragraph.
- replace_in_note changes exact passages: each find must match the stored text \
exactly once (or set "all": true), and all replacements apply or none does.
- update_note replaces the whole content. When you rewrite content you read \
earlier, pass if_version with the version from get_note; on version_conflict, \
merge your change into the current content returned and retry.

These text tools refuse tasklist and excalidraw notes.

## Task lists and reminders

Use add_task, update_task, complete_task, delete_task and the subtask tools: \
they change one task without resending the list. Priority is high, medium or \
low. list_tasks reads one list; list_all_tasks reads every list, with \
due_before/due_after for a date window. Reminders are set with set_reminder \
(or reminder_at on create_note/update_note); list_reminders with \
scope="upcoming" shows what is scheduled.

## Errors that ask for something

- note_locked (HTTP 423): another person is editing the note. Nothing was \
written; wait and retry later.
- note_is_locked (HTTP 403): the user locked the note on purpose. Its text and \
title cannot change through any tool. Tell the user; do not work around it.
- write_outcome_unknown: the request timed out after being sent. Read the note \
before retrying, or the same change may be written twice.
- version_conflict: the note changed since you read it; merge and retry.

## Safety net

delete_note moves a note to the trash (restore_note brings it back). \
delete_trash_note and empty_trash erase for good: ask before using them. \
Before this server rewrites a note, Poznote saves a snapshot; after a bad \
edit, list_snapshots and restore_snapshot (origin "mcp") recover the earlier \
content. Snapshots expire, so this is a safety net, not a history.

## Other things to know

- Link to another note in Markdown with [Title](index.php?note=ID), in HTML \
with <a href="index.php?note=ID">Title</a>; [[Exact title]] also works.
- add_attachment stores a file on a note; get_attachment reads one back \
(images come back as images).
- user_id is for multi-user servers: omit it unless the user asks you to act \
on another profile.
- Some tools may be missing: the server's operator can limit it to reading, \
or to changes that can be undone.
"""
