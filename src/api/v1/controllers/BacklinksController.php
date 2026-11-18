<?php
/**
 * Backlinks Controller
 *
 * Returns all notes that reference a given note (backlinks).
 *
 * Detection supports three formats written by the editor:
 *   1. HTML internal link attribute  — data-note-id="{id}"
 *   2. URL-based link                — ?note={id} or &note={id}
 *   3. Wiki-link syntax              — [[Note Title]]
 *
 * A [[Note Title]] only resolves inside its own workspace, so it counts only
 * for notes of the target's workspace; id-based links count from any
 * workspace.
 *
 * With context=1 each backlink also carries the text around every link it
 * writes (discussion #1761, lib/backlink-context.php); with context=check it
 * only carries whether there is any, which is what the row needs to know
 * before it offers a chevron to unfold. Without either the response is byte
 * for byte what it has always been, so get_backlinks and every other caller
 * are untouched.
 */
require_once __DIR__ . '/../../../note_loader.php';
require_once __DIR__ . '/../../../lib/backlinks.php';

class BacklinksController
{
    private PDO $con;

    public function __construct(PDO $con)
    {
        $this->con = $con;
    }


    // -------------------------------------------------------------------------
    // Public actions
    // -------------------------------------------------------------------------

    /**
     * GET /api/v1/notes/{id}/backlinks
     *
     * Returns every non-trash note that links to the note with the given ID.
     */
    public function index(string $noteId): void
    {
        if (!ctype_digit($noteId)) {
            $this->sendError(400, 'Invalid note ID');
            return;
        }
        $noteId = (int) $noteId;

        try {
            $workspace = '';
            // all_workspaces=1: the workspace parameter still scopes the
            // target note, but linking notes are collected from every
            // workspace. Not for a session confined to a shared workspace.
            if (isset($_GET['workspace']) && is_string($_GET['workspace'])) {
                $workspace = trim($_GET['workspace']);
            }
            $allWorkspaces = ($_GET['all_workspaces'] ?? '') === '1'
                && !(function_exists('isSharedWorkspaceScopeActive') && isSharedWorkspaceScopeActive());
            // context=1 quotes the text around every link; context=check
            // only says whether there is any, which is what the row needs to
            // know before it offers to unfold (discussion #1761).
            $contextMode = (string) ($_GET['context'] ?? '');

            $backlinks = poznoteCollectBacklinks($this->con, $noteId, $workspace, $allWorkspaces, $contextMode);
            if ($backlinks === null) {
                $this->sendError(404, 'Note not found');
                return;
            }

            $this->sendSuccess([
                'backlinks' => $backlinks,
                'count'     => count($backlinks),
            ]);

        } catch (Exception $e) {
            $this->sendError(500, 'Failed to retrieve backlinks');
        }
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private function sendSuccess(array $data): void
    {
        apiSuccess($data);
    }

    private function sendError(int $code, string $message): void
    {
        // Delegates to lib/api-response.php. Note that FoldersController and
        // TrashController declare the arguments the other way round; the
        // signatures are typed, so a call in the wrong order fails loudly.
        apiFail($message, $code);
    }
}
