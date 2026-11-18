<?php
/**
 * The notes that link to a note (its backlinks).
 *
 * Shared by GET /api/v1/notes/{id}/backlinks (BacklinksController) and by
 * note_display.php, which renders the backlinks row with the note so that it
 * is on screen at the first paint instead of arriving a moment later and
 * pushing the title down (js/backlinks.js rebuilds it from the data the row
 * carries, without asking the API again).
 *
 * Three link forms are detected:
 *   1. HTML internal-link attribute  data-note-id="{id}"
 *   2. URL-based link                ?note={id}
 *   3. Wiki-link syntax              [[Note Title]] (same workspace only)
 * plus, for a diary entry, a diary.php?date= link to its day (#1776).
 */

require_once __DIR__ . '/backlink-context.php';

/**
 * Every non-trash note that links to $noteId, sorted by title, or null when
 * the note is not found (in $workspace when one is given).
 *
 * @param string $workspace     scopes the target note, and the linking notes
 *                              unless $allWorkspaces
 * @param bool   $allWorkspaces collect linking notes from every workspace
 * @param string $contextMode   '' plain list, 'check' adds has_mentions,
 *                              '1' adds the mentions themselves (#1761)
 * @return list<array{id: int, heading: string, workspace: string, has_mentions?: bool, mentions?: array}>|null
 */
function poznoteCollectBacklinks(PDO $con, int $noteId, string $workspace, bool $allWorkspaces, string $contextMode = ''): ?array
{
    $withContext = ($contextMode === '1');
    $checkContext = ($contextMode === 'check');

    $targetSql = 'SELECT id, heading, workspace, folder_id FROM entries WHERE id = ? AND trash = 0';
    $targetParams = [$noteId];
    if ($workspace !== '') {
        $targetSql .= ' AND workspace = ?';
        $targetParams[] = $workspace;
    }

    // The target note: its heading is what wiki links name
    $stmt = $con->prepare($targetSql);
    $stmt->execute($targetParams);
    $targetNote = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$targetNote) {
        return null;
    }

    $targetHeading = (string) ($targetNote['heading'] ?? '');
    $targetWorkspace = (string) ($targetNote['workspace'] ?? '');
    $diaryLinks = poznoteBacklinksDiaryResolver($con, $noteId, $targetHeading, $targetWorkspace, $targetNote['folder_id'] ?? null);

    $candidateSql = "SELECT id, heading, type, workspace
           FROM entries
          WHERE trash = 0
            AND id != ?
            AND type IN ('note', 'markdown', 'tasklist')";
    $candidateParams = [$noteId];
    if ($workspace !== '' && !$allWorkspaces) {
        $candidateSql .= ' AND workspace = ?';
        $candidateParams[] = $workspace;
    }

    $stmt = $con->prepare($candidateSql);
    $stmt->execute($candidateParams);
    $candidates = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $entriesPath = getEntriesPath();
    $backlinks = [];

    foreach ($candidates as $note) {
        $ext = ($note['type'] === 'markdown') ? '.md' : '.html';
        $filePath = $entriesPath . '/' . $note['id'] . $ext;

        if (!is_file($filePath)) {
            continue;
        }
        $content = @file_get_contents($filePath);
        if ($content === false || $content === '') {
            continue;
        }

        // 0. A link to the diary day this note is the entry of
        //    (diary.php?date=…, discussion #1776) is read as a link
        //    to the note itself, for detection and snippets alike.
        if ($diaryLinks !== null) {
            $content = poznoteRewriteDiaryLinksToNote(
                $content,
                $diaryLinks['date'],
                $noteId,
                (string) $note['workspace'],
                $diaryLinks['resolves']
            );
        }

        $found = false;

        // 1. HTML internal-link attribute: data-note-id="123"
        if (strpos($content, 'data-note-id="' . $noteId . '"') !== false) {
            $found = true;
        }

        // 2. URL-based link: ?note=123 or &note=123
        //    The (?:[^0-9]|$) guard prevents matching note=1234 when looking for note=123.
        if (!$found && preg_match('/[?&]note=' . $noteId . '(?:[^0-9]|$)/', $content)) {
            $found = true;
        }

        // 3. Wiki-link syntax: [[Note Title]]
        if (!$found && $targetHeading !== '' &&
            (string) $note['workspace'] === $targetWorkspace &&
            strpos($content, '[[' . $targetHeading . ']]') !== false
        ) {
            $found = true;
        }

        if (!$found) {
            continue;
        }

        $entry = [
            'id' => (int) $note['id'],
            'heading' => $note['heading'] !== '' ? $note['heading'] : 'Untitled',
            'workspace' => (string) $note['workspace'],
        ];
        if ($withContext || $checkContext) {
            // The wiki form only counts inside the target's own
            // workspace, the same condition as detection 3 above:
            // without it a [[Title]] of another workspace would
            // come back as a snippet for a link nobody counted.
            $mentions = poznoteExtractBacklinkMentions(
                $content,
                (string) $note['type'],
                $noteId,
                $targetHeading,
                (string) $note['workspace'] === $targetWorkspace,
                // One match is all "is there anything to show"
                // needs, and it is what the probe stops at
                $checkContext ? 1 : null
            );
            if ($checkContext) {
                $entry['has_mentions'] = ($mentions !== []);
            } else {
                $entry['mentions'] = $mentions;
            }
        }
        $backlinks[] = $entry;
    }

    // Sort alphabetically for a consistent display order
    usort($backlinks, static function (array $a, array $b): int {
        return strcasecmp($a['heading'], $b['heading']);
    });

    return $backlinks;
}

/**
 * When the target is a diary entry, the day it is the entry of and the
 * test that tells whether a diary.php?date= link lands on it; null for
 * any other note, which costs the candidates loop nothing.
 *
 * A link lands on the target when diary.php would open it: the entry of
 * that date in the diary the link names (the first diary when it names
 * none), in the target's workspace. Two entries titled with the same day
 * in one diary resolve to the oldest, as diary.php does.
 *
 * @return array{date: string, resolves: callable(string, int): bool}|null
 */
function poznoteBacklinksDiaryResolver(PDO $con, int $noteId, string $heading, string $workspace, $folderId): ?array
{
    if ($folderId === null || $folderId === '' || $workspace === ''
        || !function_exists('parseDiaryEntryTitle')) {
        return null;
    }
    $date = parseDiaryEntryTitle($heading);
    if ($date === null) {
        return null;
    }
    $roots = getDiaryRoots($con, $workspace);
    if ($roots === [] || findDiaryRootForFolder($con, $workspace, (int) $folderId) === null) {
        return null;
    }
    $rootIds = array_column($roots, 'id');
    $memo = [];
    $resolves = static function (string $linkWorkspace, int $diary) use ($con, $workspace, $date, $noteId, $rootIds, &$memo): bool {
        if ($linkWorkspace !== $workspace) {
            return false;
        }
        $rootId = in_array($diary, $rootIds, true) ? $diary : $rootIds[0];
        if (!array_key_exists($rootId, $memo)) {
            $memo[$rootId] = findDiaryEntryIdForDate($con, $workspace, $date, $rootId) === $noteId;
        }
        return $memo[$rootId];
    };
    return ['date' => $date, 'resolves' => $resolves];
}

/**
 * The backlinks row as js/backlinks.js builds it (buildRow(), plus the empty
 * mentions block under it), for the note rendered with the page. The script
 * rebuilds it, wiring its links and its chevron, from the data
 * poznoteRenderBacklinksData() writes next to the note, without asking the
 * API again. '' when there is nothing to show (no backlinks, not a task list).
 *
 * @param list<array{id: int, heading: string, workspace: string, has_mentions?: bool}> $backlinks
 * @param string $currentWorkspace the workspace the page is in
 */
function poznoteRenderBacklinksRow(int $noteId, array $backlinks, bool $isTasklist, string $currentWorkspace): string
{
    if ($backlinks === [] && !$isTasklist) {
        return '';
    }
    $h = static function (string $value): string {
        return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    };

    $quotable = false;
    $links = '';
    if ($isTasklist) {
        $links .= '<a href="' . $h('tasks.php' . ($currentWorkspace !== '' ? '?workspace=' . rawurlencode($currentWorkspace) : ''))
            . '" class="backlink-link backlink-tasks-page">' . t_h('tasks_page.title', [], 'Tasks') . '</a>';
    }
    foreach ($backlinks as $link) {
        if (!empty($link['has_mentions'])) {
            $quotable = true;
        }
        $id = (int) $link['id'];
        $heading = (string) $link['heading'];
        $linkWorkspace = (string) $link['workspace'];
        $otherWorkspace = ($linkWorkspace !== '' && $currentWorkspace !== '' && $linkWorkspace !== $currentWorkspace) ? $linkWorkspace : '';
        // Same URLs as createSourceLink() and buildNoteNavigationUrl()
        $href = $otherWorkspace !== ''
            ? 'index.php?workspace=' . rawurlencode($otherWorkspace) . '&note=' . $id
            : 'index.php?' . ($currentWorkspace !== '' ? 'workspace=' . rawurlencode($currentWorkspace) . '&' : '') . 'note=' . $id;
        $links .= '<a href="' . $h($href) . '" class="backlink-link" data-note-id="' . $id . '"'
            . ($otherWorkspace !== '' ? ' title="' . $h($otherWorkspace . ' / ' . $heading) . '"' : '') . '>'
            . $h($heading)
            . ($otherWorkspace !== '' ? '<span class="backlink-workspace">' . $h($otherWorkspace) . '</span>' : '')
            . '</a>';
    }

    $html = '<div id="backlinks-row" class="backlinks-row" data-note-id="' . $noteId . '">'
        . '<span class="icon-backlinks-btn"><i class="lucide lucide-link icon_backlinks" aria-hidden="true"></i></span>';
    if ($quotable) {
        $label = t_h('backlinks.mentions.show', [], 'Show the text around each link');
        $html .= '<button type="button" class="backlinks-mentions-toggle" aria-expanded="false" title="' . $label . '" aria-label="' . $label . '">'
            . '<i class="lucide lucide-chevron-right" aria-hidden="true"></i></button>';
    }
    $html .= '<span class="backlinks-links-list">' . $links . '</span></div>';
    if ($quotable) {
        $html .= '<div id="backlinks-mentions" class="backlinks-mentions" hidden></div>';
    }
    return $html;
}

/**
 * The data the backlinks row was drawn from, for js/backlinks.js: present
 * even when there is no row, so that "nothing links here" does not send the
 * script to the API to learn it again.
 *
 * @param list<array{id: int, heading: string, workspace: string, has_mentions?: bool}> $backlinks
 */
function poznoteRenderBacklinksData(int $noteId, array $backlinks): string
{
    $data = json_encode($backlinks, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP);
    if ($data === false) {
        return '';
    }
    return '<script type="application/json" class="backlinks-data" data-note-id="' . $noteId . '">' . $data . '</script>';
}
