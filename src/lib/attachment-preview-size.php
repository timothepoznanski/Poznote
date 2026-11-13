<?php
/**
 * Width of an attachment preview tile ("Attachment previews"), in pixels.
 *
 * Chosen with the slider of the attachment right-click menu
 * (js/note-attachment-menu.js) and saved as attachment_preview_size. It is one
 * value for the account, so every tile of every note follows it: index.php
 * writes it on :root as --pz-attachment-preview-size, which the tile grid
 * (css/notes/noteentry.css) and the one-line row of tiles
 * (css/notes/attachments-row.css) read. The tiles take exactly that width;
 * before, the grid stretched 150px columns to fill the line, which made them
 * about 180px wide in a desktop note, hence the default.
 */

const POZNOTE_ATTACHMENT_PREVIEW_SIZE_MIN = 100;
const POZNOTE_ATTACHMENT_PREVIEW_SIZE_MAX = 360;
const POZNOTE_ATTACHMENT_PREVIEW_SIZE_DEFAULT = 180;

/**
 * Read an attachment_preview_size value. A number out of range is brought
 * back inside it; anything that is not a number (never set, hand-edited)
 * falls back to the default.
 */
function poznoteAttachmentPreviewSize($value): int
{
    if ($value === null || $value === false || $value === '' || !is_numeric($value)) {
        return POZNOTE_ATTACHMENT_PREVIEW_SIZE_DEFAULT;
    }
    return max(POZNOTE_ATTACHMENT_PREVIEW_SIZE_MIN, min(POZNOTE_ATTACHMENT_PREVIEW_SIZE_MAX, (int)$value));
}
