// The download arrow of an attachment card (css/components/attachment-card.css).
//
// A card is one plain link in the stored note, so a click anywhere on it opens
// the file. The arrow at its end is drawn by the stylesheet (::after) and is
// not an element of its own: nothing can be added to the card without it
// being saved with the note. So the arrow is found by where the click lands,
// the last stretch of the card (the arrow, its margin and the card's right
// padding), and a click there downloads the file instead (?download=1, the
// parameter the attachments endpoint already reads). Loaded by index.php and
// by the public page of a note, where the card's address carries the share
// token and takes the same parameter.
//
// The arrow lights up only while the pointer is over it: a class on <body>,
// never on the card, which belongs to the note's content.
(function () {
    'use strict';

    var CARD = 'a.attachment-card[href]';
    var HOVER_CLASS = 'pz-attachment-card-download-hover';

    function cardAt(target) {
        return target && target.closest ? target.closest(CARD) : null;
    }

    function onArrow(card, clientX) {
        var rect = card.getBoundingClientRect();
        var style = getComputedStyle(card, '::after');
        var after = getComputedStyle(card);
        var arrow = (parseFloat(style.width) || 16) + (parseFloat(style.marginLeft) || 0);
        var end = (parseFloat(after.paddingRight) || 0) + (parseFloat(after.borderRightWidth) || 0);
        // A few pixels before the arrow too: it is a small target
        return clientX >= rect.right - end - arrow - 6;
    }

    function downloadUrl(card) {
        try {
            var url = new URL(card.getAttribute('href'), document.baseURI);
            url.searchParams.set('download', '1');
            return url.href;
        } catch (e) {
            return null;
        }
    }

    document.addEventListener('click', function (event) {
        if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        var card = cardAt(event.target);
        if (!card || !onArrow(card, event.clientX)) return;
        var url = downloadUrl(card);
        if (!url) return;
        // Ahead of the note's own link handling, which would open the file
        event.preventDefault();
        event.stopImmediatePropagation();
        var link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', '');
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        link.remove();
    }, true);

    document.addEventListener('mousemove', function (event) {
        var card = cardAt(event.target);
        var over = !!card && onArrow(card, event.clientX);
        if (document.body.classList.contains(HOVER_CLASS) !== over) {
            document.body.classList.toggle(HOVER_CLASS, over);
        }
    }, { passive: true });
})();
