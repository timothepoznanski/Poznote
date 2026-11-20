<?php
lib('tasklists');
require_once dirname(__DIR__) . '/src/export_helpers.php';
require_once dirname(__DIR__) . '/src/import_helpers.php';

// A task list exported as Markdown (download, and "Copy as Markdown" #1805)
// and read back by the import: checkbox, priority, due date, subtasks and
// text written on several lines all survive the trip.

function tasklistMarkdownRoundTrip(array $tasks): array {
    $markdown = convertTasklistToMarkdown(json_encode($tasks));
    return json_decode(convertMarkdownCheckboxListToTasklistJson($markdown), true);
}

test('a due date is written with the Obsidian Tasks marker, after the priority', function () {
    $md = convertTasklistToMarkdown(json_encode([
        ['text' => 'Ship it', 'completed' => false, 'priority' => 'medium', 'dueAt' => '2026-11-25'],
        ['text' => 'Call', 'completed' => false, 'dueAt' => '2026-11-26T14:30'],
        ['text' => 'Urgent', 'completed' => false, 'priority' => 'high', 'dueAt' => '2026-11-27'],
        ['text' => 'No date', 'completed' => true, 'dueAt' => 'garbage'],
    ]));
    assertSame("- [ ] Ship it 🔼 📅 2026-11-25\n- [ ] Call 📅 2026-11-26 14:30\n- [ ] **Urgent** ⭐ 📅 2026-11-27\n- [x] No date\n", $md);
});

test('due dates and priorities come back on import', function () {
    $out = tasklistMarkdownRoundTrip([
        ['text' => 'Ship it', 'completed' => false, 'priority' => 'medium', 'dueAt' => '2026-11-25'],
        ['text' => 'Call', 'completed' => false, 'dueAt' => '2026-11-26T14:30'],
        ['text' => 'Urgent', 'completed' => false, 'priority' => 'high', 'dueAt' => '2026-11-27'],
        ['text' => 'Plain', 'completed' => true],
    ]);
    assertSame(4, count($out));
    assertSame('Ship it', $out[0]['text']);
    assertSame('medium', $out[0]['priority']);
    assertSame('2026-11-25', $out[0]['dueAt']);
    assertSame('Call', $out[1]['text']);
    assertSame('2026-11-26T14:30', $out[1]['dueAt']);
    assertSame('Urgent', $out[2]['text']);
    assertSame('high', $out[2]['priority']);
    assertTrue($out[2]['important']);
    assertSame('2026-11-27', $out[2]['dueAt']);
    assertFalse(array_key_exists('dueAt', $out[3]));
    assertTrue($out[3]['completed']);
});

test('an impossible date stays in the text', function () {
    $out = json_decode(convertMarkdownCheckboxListToTasklistJson("- [ ] Odd 📅 2026-02-31\n"), true);
    assertSame('Odd 📅 2026-02-31', $out[0]['text']);
    assertFalse(array_key_exists('dueAt', $out[0]));
});

test('a task on several lines stays one item and comes back whole', function () {
    $tasks = [
        ['text' => "First line\nsecond line\n\nafter a blank", 'completed' => false, 'dueAt' => '2026-12-01',
            'subtasks' => [['id' => 1, 'text' => "sub\nmore", 'completed' => true]]],
        ['text' => "Big\ndeal", 'completed' => false, 'priority' => 'high'],
        ['text' => 'Next', 'completed' => false],
    ];
    $md = convertTasklistToMarkdown(json_encode($tasks));
    assertSame("- [ ] First line\n  second line\n\n  after a blank 📅 2026-12-01\n    - [x] sub\n      more\n- [ ] **Big**\n  **deal** ⭐\n- [ ] Next\n", $md);

    $out = tasklistMarkdownRoundTrip($tasks);
    assertSame(3, count($out));
    assertSame("First line\nsecond line\n\nafter a blank", $out[0]['text']);
    assertSame('2026-12-01', $out[0]['dueAt']);
    assertSame("sub\nmore", $out[0]['subtasks'][0]['text']);
    assertTrue($out[0]['subtasks'][0]['completed']);
    assertSame("Big\ndeal", $out[1]['text']);
    assertSame('high', $out[1]['priority']);
    assertSame('Next', $out[2]['text']);
});

test('a line back at the margin is not part of the task above', function () {
    $out = json_decode(convertMarkdownCheckboxListToTasklistJson("- [ ] One\nA paragraph\n  indented later\n- [ ] Two\n"), true);
    assertSame('One', $out[0]['text']);
    assertSame('Two', $out[1]['text']);
});
