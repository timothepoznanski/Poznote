<?php
/**
 * Shared export helper functions
 * Used by api_export_folder.php, api_export_structured.php, api_export_entries.php, api_export_note.php
 */

/**
 * Build folder hierarchy to understand the structure
 */
function buildFolderTree($con, $workspace = null) {
    $query = 'SELECT id, name, parent_id FROM folders';
    $params = [];
    if ($workspace !== null) {
        $query .= ' WHERE workspace = ?';
        $params[] = $workspace;
    }
    $query .= ' ORDER BY CASE WHEN display_order > 0 THEN 0 ELSE 1 END, display_order, name COLLATE NOCASE ASC';
    
    $stmt = $con->prepare($query);
    $stmt->execute($params);
    $folders = [];
    $folderMap = [];
    
    while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
        $folders[] = $row;
        $folderMap[$row['id']] = $row;
    }
    
    return ['folders' => $folders, 'folderMap' => $folderMap];
}

/**
 * Sanitize folder/file name for filesystem
 */
function sanitizeFilename($name) {
    $name = str_replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], '_', $name);
    $name = trim($name, '. ');
    if (empty($name)) {
        $name = 'Untitled';
    }
    return $name;
}

/**
 * Get the folder path in the ZIP archive for a given folder_id (relative to the export root)
 * @param int|null $folder_id
 * @param array $folderMap
 * @param int|null $rootFolderId If set, stop traversal at this folder (used for single-folder exports)
 */
function getFolderZipPath($folder_id, $folderMap, $rootFolderId = null) {
    if ($folder_id === null || $folder_id === 0) {
        return '';
    }
    if ($rootFolderId !== null && $folder_id == $rootFolderId) {
        return '';
    }
    
    $path = [];
    $currentId = $folder_id;
    $maxDepth = 50;
    $depth = 0;
    
    while ($currentId !== null && $depth < $maxDepth) {
        if (!isset($folderMap[$currentId])) {
            break;
        }
        if ($rootFolderId !== null && $currentId == $rootFolderId) {
            break;
        }
        
        $folder = $folderMap[$currentId];
        array_unshift($path, sanitizeFilename($folder['name']));
        $currentId = $folder['parent_id'];
        $depth++;
    }
    
    return !empty($path) ? implode('/', $path) . '/' : '';
}

/**
 * Get all folder IDs that are children of a given folder (recursive)
 */
function getChildFolderIds($folder_id, $folders) {
    $childIds = [];
    foreach ($folders as $folder) {
        if ($folder['parent_id'] == $folder_id) {
            $childIds[] = $folder['id'];
            $childIds = array_merge($childIds, getChildFolderIds($folder['id'], $folders));
        }
    }
    return $childIds;
}

/**
 * Add YAML front matter to Markdown content
 */
function addFrontMatterToMarkdown($content, $metadata, $con) {
    $title = $metadata['heading'] ?? 'New note';
    $tags = $metadata['tags'] ?? '';
    $favorite = !empty($metadata['favorite']) ? 'true' : 'false';
    $created = convertUtcToUserTimezone($metadata['created'] ?? '');
    $updated = convertUtcToUserTimezone($metadata['updated'] ?? '');
    $folder_id = $metadata['folder_id'] ?? null;
    $noteType = $metadata['type'] ?? 'note';
    
    $tagsList = [];
    if (!empty($tags)) {
        $tagsList = array_filter(array_map('trim', explode(',', $tags)));
    }
    
    $folderPath = '';
    if ($folder_id) {
        $folderPath = getFolderPath($folder_id, $con);
    }
    
    $frontMatter = "---\n";
    $frontMatter .= "title: " . json_encode($title, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n";
    
    if (!empty($tagsList)) {
        $frontMatter .= "tags:\n";
        foreach ($tagsList as $tag) {
            $frontMatter .= "  - " . json_encode($tag, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n";
        }
    }
    
    if (!empty($folderPath)) {
        $frontMatter .= "folder: " . json_encode($folderPath, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n";
    }

    if ($noteType === 'tasklist') {
        $frontMatter .= "type: tasklist\n";
    }
    
    $frontMatter .= "favorite: " . $favorite . "\n";
    
    if (!empty($created)) {
        $frontMatter .= "created: " . json_encode($created, JSON_UNESCAPED_UNICODE) . "\n";
    }
    
    if (!empty($updated)) {
        $frontMatter .= "updated: " . json_encode($updated, JSON_UNESCAPED_UNICODE) . "\n";
    }
    
    $frontMatter .= "---\n\n";
    
    return $frontMatter . $content;
}

/**
 * Remove code block copy buttons from HTML export
 */
function removeCopyButtonsFromHtml($html) {
    if ($html === '' || $html === null) {
        return $html;
    }

    $dom = new DOMDocument();
    libxml_use_internal_errors(true);
    $dom->loadHTML('<?xml encoding="utf-8" ?>' . $html, LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD);
    libxml_clear_errors();

    $xpath = new DOMXPath($dom);
    // Code block UI affordances (copy / delete / language badge / line numbers
    // / word wrap / fold chevron and its line count)
    $actionButtons = $xpath->query("//*[contains(@class, 'code-block-copy-btn') or contains(@class, 'code-block-delete-btn') or contains(@class, 'code-block-lang-btn') or contains(@class, 'code-block-line-numbers-btn') or contains(@class, 'code-block-wrap-btn') or contains(@class, 'code-block-collapse-btn') or contains(@class, 'code-block-collapsed-summary')]");
    foreach ($actionButtons as $button) {
        $button->parentNode->removeChild($button);
    }

    // Strip the xml processing instruction added above for UTF-8 handling
    return preg_replace('/^<\?xml[^>]*\?>\s*/', '', $dom->saveHTML());
}

/**
 * Add a download attribute to <a> tags pointing at exported attachment files so
 * browsers save the file instead of navigating to it when the export is opened locally.
 * $downloadNames maps the exported basename (attachment id + extension) to the
 * original filename used as the suggested download name.
 *
 * backup_zip.php carries its own copy (it stays standalone to be usable from the
 * S3 backup worker); keep both in sync.
 */
function addDownloadAttributesToAttachmentLinks($html, $downloadNames) {
    if ($html === '' || $html === null) {
        return $html;
    }

    return preg_replace_callback(
        '#<a\b[^>]*href=("|\')(?:\.\./)*attachments/([^"\'?\#]+)(?:[?\#][^"\']*)?\1[^>]*>#i',
        function ($matches) use ($downloadNames) {
            $tag = $matches[0];

            // Keep the click-to-view behavior of image preview wrappers; their
            // caption link is the download entry point
            if (stripos($tag, 'note-attachment-preview-media') !== false) {
                return $tag;
            }

            // Skip tags that already carry a download attribute (compare with
            // quoted values blanked out so title="Download ..." does not match)
            $tagWithoutValues = preg_replace('/"[^"]*"|\'[^\']*\'/', '""', $tag);
            if (preg_match('/\sdownload\b/i', $tagWithoutValues)) {
                return $tag;
            }

            $basename = $matches[2];
            $downloadAttr = ' download';
            if (isset($downloadNames[$basename]) && $downloadNames[$basename] !== '') {
                $downloadAttr = ' download="' . htmlspecialchars($downloadNames[$basename], ENT_QUOTES, 'UTF-8') . '"';
            }

            return '<a' . $downloadAttr . substr($tag, 2);
        },
        $html
    );
}

/**
 * The due date of a task in Markdown: " 📅 2026-11-25", the Obsidian Tasks
 * marker, with " 14:30" after it when the task has a time. '' without a
 * valid date. Read back by convertMarkdownCheckboxListToTasklistJson().
 *
 * @param mixed $dueAt Stored dueAt ('Y-m-d' or 'Y-m-d\TH:i').
 */
function tasklistDueMarkdownMarker($dueAt): string {
    if (!is_string($dueAt) || !preg_match('/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/', trim($dueAt), $parts)) {
        return '';
    }
    return ' 📅 ' . $parts[1] . (isset($parts[2]) ? ' ' . $parts[2] : '');
}

/**
 * One checkbox item of a task list in Markdown. A text written on several
 * lines (Shift+Enter) keeps its line breaks: each following line is indented
 * under the checkbox, so it stays in the item instead of ending the list, and
 * the import joins it back. Empty lines stay empty.
 */
function tasklistMarkdownItem(string $indent, string $checkbox, string $text): string {
    $lines = explode("\n", str_replace(["\r\n", "\r"], "\n", $text));
    $out = $indent . '- ' . $checkbox . ' ' . array_shift($lines) . "\n";
    foreach ($lines as $line) {
        $out .= (trim($line) === '' ? '' : $indent . '  ' . $line) . "\n";
    }
    return $out;
}

/**
 * Convert tasklist JSON to Markdown checkbox format
 */
function convertTasklistToMarkdown($jsonContent) {
    $jsonContent = preg_replace('/^\xEF\xBB\xBF/', '', $jsonContent);

    $tasks = json_decode($jsonContent, true);

    if (!is_array($tasks) || empty($tasks)) {
        return '';
    }

    $markdown = '';

    foreach ($tasks as $task) {
        $text = isset($task['text']) && is_scalar($task['text']) ? trim((string) $task['text']) : '';
        $completed = !empty($task['completed']);
        $priority = getTasklistTaskPriority($task);

        if ($text === '') {
            continue;
        }

        $checkbox = $completed ? '[x]' : '[ ]';

        // Priority (#1730): high keeps the bold text and ⭐ of the important
        // star, medium and low take the Obsidian Tasks markers; the import
        // (convertMarkdownCheckboxListToTasklistJson) reads all three back.
        // Bold goes round each line: ** does not span a line break.
        if ($priority === 'high') {
            $text = implode("\n", array_map(function ($line) {
                return trim($line) === '' ? $line : '**' . trim($line) . '**';
            }, explode("\n", $text)));
        }
        $suffix = $priority === null ? '' : (['high' => ' ⭐', 'medium' => ' 🔼', 'low' => ' 🔽'][$priority] ?? '');

        // Due date, after the priority as Obsidian Tasks writes them
        $suffix .= tasklistDueMarkdownMarker($task['dueAt'] ?? null);

        $markdown .= tasklistMarkdownItem('', $checkbox, $text . $suffix);

        // Subtasks: checkbox lines indented under their task, which is what
        // convertMarkdownCheckboxListToTasklistJson() reads back on import
        foreach (getTasklistSubtasks($task) as $subtask) {
            $markdown .= tasklistMarkdownItem('    ', $subtask['completed'] ? '[x]' : '[ ]', $subtask['text']);
        }
    }

    return $markdown;
}
