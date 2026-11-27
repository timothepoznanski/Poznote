<?php
/**
 * How many notes the "Recent notes" section of the notes tree lists
 * (notes_list.php), set from the slider of its right-click menu
 * (js/recent-notes.js) and kept per account as recent_notes_count.
 *
 * The section is always rendered with the most rows the slider allows, those
 * past the count hidden, so the slider shows or hides rows on the spot
 * without a rebuild of the tree.
 */

const POZNOTE_RECENT_NOTES_MIN = 1;
const POZNOTE_RECENT_NOTES_MAX = 20;
const POZNOTE_RECENT_NOTES_DEFAULT = 5;

/**
 * Read a recent_notes_count value. A number out of range is brought back
 * inside it; anything that is not a number (never set, hand-edited) falls
 * back to the default.
 */
function poznoteRecentNotesCount($value): int
{
    if ($value === null || $value === false || $value === '' || !is_numeric($value)) {
        return POZNOTE_RECENT_NOTES_DEFAULT;
    }
    return max(POZNOTE_RECENT_NOTES_MIN, min(POZNOTE_RECENT_NOTES_MAX, (int)$value));
}
