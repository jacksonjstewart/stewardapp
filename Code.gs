// ─── STEWARD · AppsScript Backend ──────────────────────────────────────────

const SHEET_ID  = '1nZ6MOhUN9MsvUj6naUrLJanuQHFqRR9g3xP-c5jJH38';
const TASKS_TAB = 'Tasks';
const LOG_TAB   = 'Log';

// ─── ROUTING ─────────────────────────────────────────────────────────────────

function doPost(e) {
  try {
    const data   = JSON.parse(e.postData.contents);
    const action = data.action;
    if (action === 'commit')     return jsonOk(commitEntries(data.entries, data.dateKey));
    if (action === 'addTask')    return jsonOk(addTask(data.task));
    if (action === 'updateTask') return jsonOk(updateTask(data.taskId, data.updates));
    if (action === 'deleteTask') return jsonOk(deleteTask(data.taskId));
    return jsonErr('Unknown action: ' + action);
  } catch (err) {
    return jsonErr(err.toString());
  }
}

function doGet(e) {
  try {
    const action = e.parameter.action;
    if (action === 'getTodayState') return jsonOk(getTodayState(e.parameter.dateKey));
    if (action === 'getHistory')    return jsonOk(getHistory(parseInt(e.parameter.days) || 90));
    if (action === 'getSections')   return jsonOk(getSections());
    return jsonErr('Unknown action: ' + action);
  } catch (err) {
    return jsonErr(err.toString());
  }
}

// ─── COMMIT ──────────────────────────────────────────────────────────────────
// Full REPLACE for a given dateKey — no stale rows, no bloat.

function commitEntries(entries, dateKey) {
  const dk = dateKey || (entries && entries.length ? entries[0].dateKey : null);
  if (!dk) return { committed: 0 };

  const ss       = SpreadsheetApp.openById(SHEET_ID);
  const logSheet = getOrCreateLog(ss);
  const data     = logSheet.getDataRange().getValues();
  const headers  = data[0];
  const dateIdx  = headers.indexOf('dateKey');

  // Prune rows older than 365 days, then replace today's rows
  const cutoff = fmtDate(new Date(Date.now() - 365 * 86400000));
  for (let r = data.length - 1; r >= 1; r--) {
    const rowDk = String(data[r][dateIdx]);
    if (rowDk < cutoff || rowDk === String(dk)) logSheet.deleteRow(r + 1);
  }

  (entries || []).forEach(entry => {
    logSheet.appendRow([
      entry.taskId      || '',
      entry.name        || '',
      entry.section     || '',
      entry.emoji       || '',
      entry.completedAt || '',
      entry.dateKey     || '',
      entry.who         || '',
      entry.dataValue   || '',
    ]);
  });

  return { committed: (entries || []).length };
}

// ─── GET TODAY STATE ──────────────────────────────────────────────────────────

function getTodayState(dateKey) {
  if (!dateKey) return { entries: [] };
  const ss       = SpreadsheetApp.openById(SHEET_ID);
  const logSheet = getOrCreateLog(ss);
  const data     = logSheet.getDataRange().getValues();
  const headers  = data[0];
  const dateIdx  = headers.indexOf('dateKey');
  if (dateIdx < 0) return { entries: [] };
  const entries = data.slice(1)
    .filter(row => row[dateIdx] === dateKey)
    .map(row => { const o = {}; headers.forEach((h, i) => { o[h] = row[i]; }); return o; });
  return { entries };
}

// ─── GET HISTORY ──────────────────────────────────────────────────────────────

function getHistory(days) {
  const nowUtc    = new Date();
  const msMtn     = nowUtc.getTime() - (7 * 3600000); // UTC-7 (Edmonton conservative)
  const cutoffUtc = new Date(msMtn - (days * 86400000));
  const cutoffStr = fmtDate(cutoffUtc);

  const ss       = SpreadsheetApp.openById(SHEET_ID);
  const logSheet = getOrCreateLog(ss);
  const data     = logSheet.getDataRange().getValues();
  const headers  = data[0];
  const dateIdx  = headers.indexOf('dateKey');
  if (dateIdx < 0) return { entries: [] };

  const entries = data.slice(1)
    .filter(row => String(row[dateIdx]) >= cutoffStr)
    .map(row => { const o = {}; headers.forEach((h, i) => { o[h] = row[i]; }); return o; });
  return { entries };
}

// ─── GET SECTIONS ─────────────────────────────────────────────────────────────
// Returns the ordered list of domain sections from the Sections tab.
// Creates the tab (and the README tab) on first run.

function getSections() {
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSections(ss);
  const data  = sheet.getDataRange().getValues();
  if (data.length < 2) return { sections: [] };
  const headers = data[0].map(h => String(h).toLowerCase().trim());
  const ki = headers.indexOf('key');
  const li = headers.indexOf('label');
  const ei = headers.indexOf('emoji');
  const ci = headers.indexOf('color');
  const sections = data.slice(1)
    .filter(row => row[ki] && String(row[ki]).trim())
    .map(row => ({
      key:   String(row[ki]).trim(),
      label: String(row[li] || '').trim(),
      emoji: String(row[ei] || '').trim(),
      color: String(row[ci] || '#888').trim(),
    }));
  return { sections };
}

// ─── ADD TASK ─────────────────────────────────────────────────────────────────

function addTask(task) {
  if (!task || !task.name) throw new Error('Task name is required');
  const ss         = SpreadsheetApp.openById(SHEET_ID);
  const tasksSheet = ss.getSheetByName(TASKS_TAB);
  if (!tasksSheet) throw new Error('Tasks sheet not found — check tab name');

  const headers = tasksSheet.getRange(1, 1, 1, tasksSheet.getLastColumn()).getValues()[0]
    .map(h => String(h).toLowerCase().replace(/\s+/g, ''));

  const id = task.id || generateId(task.name);

  const rowMap = {
    id:             id,
    name:           task.name           || '',
    emoji:          task.emoji          || '✅',
    section:        task.section        || 'home',
    indicator:      task.indicator      || '',
    frequency:      task.frequency      || 'once',
    dow:            task.dow            || '',
    dotm:           task.dotm           || '',
    dotw_ord:       task.dotw_ord       || '',
    yearmonth:      task.yearMonth      || '',
    yearmonth2:     task.yearMonth2     || '',
    freqmonths:     task.freqMonths     || '',
    anchordate:     task.anchorDate     || '',
    notes:          task.notes          || '',
    type:           task.type           || 'recurring',
    targetdate:     task.targetdate     || '',
    completiontype: task.completionType || 'categorical',
    checklistitems: task.checklistItems || '',
    datatype:       task.dataType       || '',
    datatarget:     task.dataTarget     || 'log',
    datalabel:         task.dataLabel         || '',
    datatargettask:    task.dataTargetTask    || '',
    overdueGraceDays:  String(task.overdueGraceDays || 0),
    getaheaddays:      String(task.getaheadDays || 0),
  };

  const row = headers.map(h => rowMap[h] !== undefined ? rowMap[h] : '');
  tasksSheet.appendRow(row);
  return { ok: true, id };
}

// ─── UPDATE TASK ──────────────────────────────────────────────────────────────
// Updates specific fields of a task row by ID.
// Used when data validation completions need to write back a new date/value.

function updateTask(taskId, updates) {
  if (!taskId) throw new Error('taskId required');
  const ss         = SpreadsheetApp.openById(SHEET_ID);
  const tasksSheet = ss.getSheetByName(TASKS_TAB);
  if (!tasksSheet) throw new Error('Tasks sheet not found');

  const data    = tasksSheet.getDataRange().getValues();
  const headers = data[0].map(h => String(h).toLowerCase().replace(/\s+/g, ''));
  const idIdx   = headers.indexOf('id');
  if (idIdx < 0) throw new Error('ID column not found');

  for (let r = 1; r < data.length; r++) {
    if (String(data[r][idIdx]) === String(taskId)) {
      Object.entries(updates).forEach(([field, value]) => {
        const colIdx = headers.indexOf(field.toLowerCase().replace(/\s+/g, ''));
        if (colIdx >= 0) tasksSheet.getRange(r + 1, colIdx + 1).setValue(value);
      });
      return { ok: true, updated: taskId, fields: Object.keys(updates) };
    }
  }
  return { ok: false, error: 'Task not found: ' + taskId };
}

// ─── DELETE TASK ──────────────────────────────────────────────────────────────

function deleteTask(taskId) {
  if (!taskId) throw new Error('taskId is required');
  const ss         = SpreadsheetApp.openById(SHEET_ID);
  const tasksSheet = ss.getSheetByName(TASKS_TAB);
  if (!tasksSheet) throw new Error('Tasks sheet not found');

  const data    = tasksSheet.getDataRange().getValues();
  const headers = data[0].map(h => String(h).toLowerCase().replace(/\s+/g, ''));
  const idIdx   = headers.indexOf('id');
  if (idIdx < 0) throw new Error('ID column not found in Tasks sheet');

  for (let r = 1; r < data.length; r++) {
    if (String(data[r][idIdx]) === String(taskId)) {
      tasksSheet.deleteRow(r + 1);
      return { ok: true, deleted: taskId };
    }
  }
  return { ok: false, error: 'Task not found: ' + taskId };
}

// ─── MIDNIGHT TRIGGER ─────────────────────────────────────────────────────────
// Set a time-driven trigger: Triggers → midnightCommit → Day timer → Midnight–1am

function midnightCommit() {
  Logger.log('Midnight commit check — ' + new Date().toISOString());
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function getOrCreateLog(ss) {
  let sheet = ss.getSheetByName(LOG_TAB);
  if (!sheet) {
    sheet = ss.insertSheet(LOG_TAB);
    sheet.appendRow(['taskId','name','section','emoji','completedAt','dateKey','who','dataValue']);
  }
  return sheet;
}

function getOrCreateSections(ss) {
  let sheet = ss.getSheetByName('Sections');
  if (!sheet) {
    sheet = ss.insertSheet('Sections');
    sheet.appendRow(['key', 'label', 'emoji', 'color']);
    [
      ['vehicle', 'Vehicle',   '🚗', '#e8e8e8'],
      ['digital', 'Digital',   '💻', '#7dd3fc'],
      ['home',    'Household', '🏠', '#4ade80'],
      ['finance', 'Finance',   '💳', '#facc15'],
      ['family',  'Family',    '🌸', '#f4a4b8'],
    ].forEach(r => sheet.appendRow(r));
    sheet.getRange(1, 1, 1, 4).setFontWeight('bold').setBackground('#cfe2ff');
    sheet.setColumnWidth(1, 120);
    sheet.setColumnWidth(2, 160);
    sheet.setColumnWidth(3, 80);
    sheet.setColumnWidth(4, 100);
    getOrCreateReadme(ss);
  }
  return sheet;
}

function getOrCreateReadme(ss) {
  if (ss.getSheetByName('README')) return;
  const sheet = ss.insertSheet('README');

  const rows = [
    ['STEWARD — Sheet Reference Guide'],
    [],
    ['── TASKS TAB ───────────────────────────────────────────────────────────'],
    ['Column', 'Required for', 'Description', 'Valid values / examples'],
    ['id', 'All tasks', 'Unique task ID. Auto-generated by the app when added via the UI. If adding manually, enter any unique short string.', 'e.g.  car_ins_a1b2'],
    ['name', 'All tasks', 'Task display name shown in the app.', 'e.g.  Renew Car Insurance'],
    ['emoji', 'All tasks', 'Task icon. Defaults to ✅ if left blank.', 'Any single emoji'],
    ['section', 'All tasks', 'Domain section. Must exactly match a key from the Sections tab.', 'vehicle · digital · home · finance · family'],
    ['indicator', 'All tasks', 'Health indicator label. Tasks sharing the same label are grouped under one indicator dot within their domain. A new label auto-creates a new indicator — no other changes needed.', 'e.g.  Car Insurance'],
    ['frequency', 'All tasks', 'How often the task recurs.', 'daily · weekly · biweekly · monthly · yearly · once'],
    ['type', 'All tasks', 'Task lifecycle type.', 'recurring · once'],
    ['dow', 'weekly, biweekly', 'Day(s) of week as comma-separated numbers.  0=Sun  1=Mon  2=Tue  3=Wed  4=Thu  5=Fri  6=Sat', 'e.g.  1  for Monday   ·   1,3  for Mon & Wed'],
    ['dotm', 'monthly, yearly', 'Day of the month (1–31).', 'e.g.  7  for the 7th of the month'],
    ['dotw_ord', 'monthly, yearly', 'Ordinal week number. Used for patterns like "2nd Monday of the month". Combined with the dow column.', '1 · 2 · 3 · 4 · 5'],
    ['yearmonth', 'yearly', 'Month number (1–12) for annual tasks.', 'e.g.  4  for April'],
    ['anchordate', 'biweekly only', 'A past date (YYYY-MM-DD) that falls on the correct cycle week. Determines which weeks the biweekly task appears on.', 'e.g.  2024-01-01'],
    ['targetdate', 'once type', 'The specific date a one-time task appears (YYYY-MM-DD). Can be updated on completion to recycle the task to a new future date.', 'e.g.  2026-04-07'],
    ['completiontype', 'All tasks', 'How the task is marked complete.\n  categorical = instant tick (no prompt)\n  checklist = all items must be ticked before confirming\n  data = a value must be entered before confirming', 'categorical · checklist · data'],
    ['checklistitems', 'checklist type', 'Pipe-separated list of items. All must be checked before the task can be confirmed.', 'e.g.  Check oil|Check tires|Top up fluids'],
    ['datatype', 'data type', 'The type of input to collect in the data modal.', 'number · date · text'],
    ['datatarget', 'data type', 'Where the entered value is stored.\n  log = saved to history only\n  targetdate = writes back to the targetdate column (useful for recycling one-time tasks to a new date)', 'log · targetdate'],
    ['notes', 'Optional', 'Shown in the task expand panel and as the prompt label in the data entry modal. Use the pipe character | to separate multiple paragraphs.', 'e.g.  Check glove box for policy number'],
    ['getaheaddays', 'Optional', 'Days before the due date to start showing the task in the blue GET AHEAD section. Allows early completion. 0 or blank = disabled.', 'e.g.  60  (shows 60 days before due date)'],
    [],
    ['── SECTIONS TAB ─────────────────────────────────────────────────────────'],
    ['Column', 'Description', 'Valid values / examples', ''],
    ['key', 'Short unique identifier used in the Tasks → section column. Lowercase, no spaces.', 'e.g.  health', ''],
    ['label', 'Display name shown in domain cards and section headers in the app.', 'e.g.  Health & Fitness', ''],
    ['emoji', 'Domain icon shown in the app header and domain card.', 'Any single emoji', ''],
    ['color', 'Hex colour code for the domain section header and indicator dots.', 'e.g.  #a78bfa', ''],
    [],
    ['── HEALTH INDICATOR LOGIC ───────────────────────────────────────────────'],
    ['Status', 'What it means', '', ''],
    ['🟢  GREEN', 'All tasks attached to this indicator are completed. Nothing is due, overdue, or in the GET AHEAD window.', '', ''],
    ['🟡  AMBER', 'At least one attached task is: (a) due today and not yet done, (b) within its GET AHEAD window, or (c) overdue and awaiting completion.', '', ''],
    ['🔴  RED', 'At least one attached task has passed its scheduled due date without being marked complete (overdue).', '', ''],
    [],
    ['── HOW TO ADD A NEW DOMAIN ──────────────────────────────────────────────'],
    ['Step 1', 'Open the Sections tab and add a new row: fill in key (unique, lowercase, no spaces), label, emoji, and color.', '', ''],
    ['Step 2', 'Add tasks to the Tasks tab using that new key in the section column.', '', ''],
    ['Step 3', 'The new domain card appears automatically in the app on next sync (≤5 min). No code changes required.', '', ''],
    [],
    ['── HOW TO ADD A NEW HEALTH INDICATOR ───────────────────────────────────'],
    ['Step 1', 'Add tasks to the Tasks tab and set the indicator column to the same text for all tasks that should be grouped.', '', ''],
    ['Step 2', 'The new indicator dot and accordion row appear automatically in the domain card on next sync.', '', ''],
    ['Step 3', 'No other changes needed.', '', ''],
    [],
    ['── HOW TO ADD A TASK MANUALLY ───────────────────────────────────────────'],
    ['Step 1', 'Add a new row in the Tasks tab.', '', ''],
    ['Step 2', 'Fill in at minimum: id, name, section, indicator, frequency, type, and the schedule columns relevant to that frequency (see table above).', '', ''],
    ['Step 3', 'For id: type a unique short string (e.g.  task_name_1234). Must not duplicate any existing id.', '', ''],
    ['Step 4', 'The app picks up new tasks on its next sync (every 5 minutes) or immediately on page refresh.', '', ''],
  ];

  rows.forEach(r => sheet.appendRow(Array.isArray(r) ? r : [r]));

  // Basic formatting: title, section banners, column header rows
  sheet.getRange(1, 1).setFontSize(14).setFontWeight('bold');
  [3, 25, 30, 36, 41, 46].forEach(r => sheet.getRange(r, 1).setFontWeight('bold').setFontColor('#1a5276'));
  [4, 26, 31].forEach(r => sheet.getRange(r, 1, 1, 4).setFontWeight('bold').setBackground('#d6eaf8'));

  sheet.setColumnWidth(1, 160);
  sheet.setColumnWidth(2, 380);
  sheet.setColumnWidth(3, 300);
  sheet.setColumnWidth(4, 220);
  sheet.setFrozenRows(1);
}

// ─── README WRITER ────────────────────────────────────────────────────────────
// Run this ONCE from the Apps Script editor (Run → populateReadme) to write
// a full field-reference guide into the README tab. Safe to re-run — clears
// and rewrites the tab each time.

function populateReadme() {
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  let sheet   = ss.getSheetByName('README');
  if (!sheet) sheet = ss.insertSheet('README');
  sheet.clearContents();
  sheet.clearFormats();

  const rows = [
    // ── Title ──────────────────────────────────────────────────────────────
    ['STEWARD · Task Schema Reference'],
    ['Last updated by populateReadme() — re-run after schema changes.'],
    [],

    // ── Section 1: Field Reference ─────────────────────────────────────────
    ['SECTION 1 · FIELD REFERENCE'],
    ['Field', 'Required for', 'Valid values / format', 'Notes'],

    ['id', 'All tasks',
     'Any unique short string — no spaces (use hyphens)',
     'e.g. home-gutters-clean · Must be unique across entire Tasks tab'],

    ['name', 'All tasks', 'Free text', 'Displayed in the app exactly as written'],

    ['emoji', 'All tasks', 'Any single emoji', 'Defaults to ✅ if blank'],

    ['section', 'All tasks',
     'Must match a key in the Sections tab exactly',
     'e.g. vehicle · digital · home · finance · family'],

    ['indicator', 'All tasks',
     'Free text — shared by all tasks in the same indicator group',
     'Tasks with the same indicator value are grouped under one health dot. A new value auto-creates a new indicator — no other changes needed.'],

    ['frequency', 'All tasks',
     'daily · weekly · biweekly · monthly · yearly · biannual · nmonthly · once',
     'See Section 2 for which extra columns each frequency needs'],

    ['type', 'All tasks', 'recurring · once',
     '"once" tasks have special lifecycle rules — see Section 3'],

    ['dow', 'weekly, biweekly, monthly (weekday pattern)',
     'Comma-separated day numbers: 0=Sun 1=Mon 2=Tue 3=Wed 4=Thu 5=Fri 6=Sat',
     'e.g. 1 for every Monday · 1,3 for Mon & Wed · biweekly only uses the first value'],

    ['dotm', 'monthly (date), yearly, biannual, nmonthly',
     'Integer 1–31',
     'Day of the month. e.g. 7 = the 7th of each relevant month'],

    ['dotw_ord', 'monthly (weekday pattern)',
     '1 · 2 · 3 · 4 · 5',
     'Ordinal week — combine with dow. e.g. dow=2 + dotw_ord=2 = 2nd Tuesday of each month'],

    ['yearmonth', 'yearly, biannual',
     'Integer 1–12',
     'Month number. e.g. 4 = April. For biannual: first of the two months.'],

    ['yearmonth2', 'biannual only',
     'Integer 1–12',
     'Second month for biannual tasks. e.g. yearmonth=5 + yearmonth2=11 fires May & November'],

    ['freqmonths', 'nmonthly only',
     'Integer ≥ 1',
     'Interval in months. e.g. 4 = every 4 months. Always pair with anchordate and dotm.'],

    ['anchordate', 'biweekly, nmonthly',
     'YYYY-MM-DD — a past date on the correct day',
     'Biweekly: any past date that falls on the intended day of week. nmonthly: the first occurrence date.'],

    ['targetdate', 'once type only',
     'YYYY-MM-DD  ·  always  ·  (empty)',
     '"always" = pure OTO, shows every day until done. Empty = hidden until a booking task writes a real date. A real date = appears on that day only.'],

    ['completiontype', 'All tasks',
     'categorical · checklist · data',
     'categorical = instant tick, no modal. checklist = all items must be checked. data = user enters a value.'],

    ['checklistitems', 'checklist completion type',
     'Pipe-separated items: Item one|Item two|Item three',
     'All items must be checked before the task can be confirmed complete'],

    ['datatype', 'data completion type',
     'date · number · text',
     'Controls the input field shown in the data modal'],

    ['datatarget', 'data completion type',
     'log · targetdate',
     '"log" = value saved to history only. "targetdate" = value written back to a task\'s targetdate column (use to schedule an OTO task on completion)'],

    ['datalabel', 'data completion type (optional)',
     'Free text',
     'Custom text for the confirm button in the data modal. e.g. "BOOK APPOINTMENT". Defaults to CONFIRM COMPLETE if blank.'],

    ['datatargettask', 'data completion type (optional)',
     'A valid task id from the Tasks tab',
     'When set, the data value is written to THIS task\'s targetdate instead of the completing task\'s own. Used to have a booking task schedule a separate OTO task.'],

    ['notes', 'Optional',
     'Free text. Use | to separate paragraphs.',
     'Shown in the task detail panel and as the prompt in the data modal'],

    ['overdueGraceDays', 'Optional',
     'Integer ≥ 0. Default = 0.',
     '0 = task goes RED immediately on miss. Any number = task stays AMBER for that many days after the missed due date, then turns RED.'],

    ['getaheaddays', 'Optional',
     'Integer ≥ 0. Default = 0.',
     'Days before due date to show the task in the blue GET AHEAD section. 0 or blank = disabled.'],

    ['proactive', 'Optional',
     'yes · no',
     'If yes, the task can be completed directly from the Domain view before it appears in Today.'],

    [],

    // ── Section 2: Frequency Patterns ──────────────────────────────────────
    ['SECTION 2 · FREQUENCY PATTERNS — which fields to fill per type'],
    ['frequency', 'dow', 'dotm', 'dotw_ord', 'yearmonth', 'yearmonth2', 'freqmonths', 'anchordate', 'Example'],
    ['daily',     '',    '',     '',          '',           '',           '',            '',           'Due every single day'],
    ['weekly',    '1',   '',     '',          '',           '',           '',            '',           'Every Monday'],
    ['weekly',    '1,3', '',     '',          '',           '',           '',            '',           'Every Monday and Wednesday'],
    ['biweekly',  '3',   '',     '',          '',           '',           '',            '2026-03-25', 'Every other Wednesday, anchored to Mar 25 2026'],
    ['monthly',   '',    '7',    '',          '',           '',           '',            '',           '7th of every month'],
    ['monthly',   '2',   '',     '2',         '',           '',           '',            '',           '2nd Tuesday of every month'],
    ['yearly',    '',    '10',   '',          '9',          '',           '',            '',           'September 10 annually'],
    ['biannual',  '',    '1',    '',          '5',          '11',         '',            '',           'May 1 and November 1 each year'],
    ['nmonthly',  '',    '10',   '',          '',           '',           '4',           '2025-04-10', 'Every 4 months on the 10th, starting Apr 2025 (Apr · Aug · Dec)'],
    ['once',      '',    '',     '',          '',           '',           '',            '',           'targetdate=always (pure OTO) · targetdate=YYYY-MM-DD (fixed) · targetdate empty (awaiting booking)'],

    [],

    // ── Section 3: OTO Types ────────────────────────────────────────────────
    ['SECTION 3 · ONE-TIME TASK (OTO) TYPES'],
    ['OTO Type', 'targetdate value', 'Behaviour', 'When to use'],
    ['Pure OTO',        'always',       'Appears every day until the user marks it done. Stays done permanently.', 'Tasks with no fixed due date that just need to be done once (e.g. "Secure copies of registration")'],
    ['Fixed-date OTO',  'YYYY-MM-DD',   'Appears only on the specified date. Done status is permanent.',            'One-off tasks with a known deadline'],
    ['Schedulable OTO', '(empty)',       'Hidden until a booking task writes a real date into this field via datatargettask. Reusable — updating the date recycles the task to the new appointment.', 'Appointment-based tasks scheduled by another recurring task (e.g. oil change, tire swap)'],

    [],

    // ── Section 4: Health Indicator Logic ──────────────────────────────────
    ['SECTION 4 · HEALTH INDICATOR LOGIC'],
    ['Status', 'Condition', '', ''],
    ['🟢  GREEN',  'All tasks in this indicator group are completed for the current cycle. Nothing is due, overdue, or in a GET AHEAD window.', '', ''],
    ['🟡  AMBER',  'At least one task is: (a) due today and not yet done, (b) within its GET AHEAD window, or (c) missed but within its overdueGraceDays window.', '', ''],
    ['🔴  RED',    'At least one task has been missed AND has exceeded its overdueGraceDays (0 = goes RED immediately on miss).', '', ''],
    ['⚪  GRAY',   'All tasks in this indicator are newly added with no completion history, or are unscheduled OTOs. Does not affect GREEN/AMBER/RED.', '', ''],
    [],
    ['overdueGraceDays = 0  (default)',  '→  Task missed = indicator goes RED immediately', '', ''],
    ['overdueGraceDays = 7',             '→  Task missed = AMBER for 7 days, then RED',     '', ''],
    ['overdueGraceDays = 30',            '→  Task missed = AMBER for 30 days, then RED',    '', ''],

    [],

    // ── Section 5: How to add a task ───────────────────────────────────────
    ['SECTION 5 · HOW TO ADD A TASK MANUALLY'],
    ['Step', 'Action', '', ''],
    ['1', 'Open the Tasks tab and add a new row at the bottom.', '', ''],
    ['2', 'Fill in at minimum: id · name · emoji · section · indicator · frequency · type · completiontype', '', ''],
    ['3', 'Add the schedule fields for your chosen frequency (see Section 2).', '', ''],
    ['4', 'For id: use a short unique hyphenated string. Check that it does not already exist in the tab.', '', ''],
    ['5', 'The app picks up new tasks on its next sync (~5 min) or immediately on page refresh.', '', ''],
    ['6', 'New tasks with no completion history show as gray — they will not trigger AMBER or RED until their first due date passes without completion.', '', ''],

    [],

    // ── Section 6: How to add a health indicator ───────────────────────────
    ['SECTION 6 · HOW TO ADD A NEW HEALTH INDICATOR'],
    ['Step', 'Action', '', ''],
    ['1', 'Decide on an indicator label (e.g. "Gutters Clean").', '', ''],
    ['2', 'Add one or more tasks to the Tasks tab. Set the indicator column to that exact label for every task in the group.', '', ''],
    ['3', 'The new indicator dot and accordion row appear automatically in the domain card. No code changes.', '', ''],

    [],

    // ── Section 7: How to add a domain ─────────────────────────────────────
    ['SECTION 7 · HOW TO ADD A NEW DOMAIN'],
    ['Step', 'Action', '', ''],
    ['1', 'Open the Sections tab. Add a new row: key (unique lowercase, no spaces) · label · emoji · color (hex)', '', ''],
    ['2', 'Add tasks to the Tasks tab using that new key in the section column.', '', ''],
    ['3', 'The new domain card appears automatically on next sync. No code changes.', '', ''],
  ];

  rows.forEach(r => sheet.appendRow(Array.isArray(r) ? r : [r]));

  // ── Formatting ────────────────────────────────────────────────────────────
  const lastRow = sheet.getLastRow();
  sheet.getRange(1, 1).setFontSize(15).setFontWeight('bold');
  sheet.getRange(2, 1).setFontColor('#888888').setFontStyle('italic');

  // Section title rows: bold blue
  const sectionTitles = [4, 37, 51, 57, 68, 77, 84];
  sectionTitles.forEach(r => {
    try { sheet.getRange(r, 1).setFontWeight('bold').setFontColor('#1a5276').setFontSize(11); } catch(e) {}
  });

  // Header rows (field table headers, pattern headers, etc.)
  const headerRows = [5, 38, 52, 58, 69, 78, 85];
  headerRows.forEach(r => {
    try { sheet.getRange(r, 1, 1, 4).setFontWeight('bold').setBackground('#d6eaf8'); } catch(e) {}
  });

  // Column widths
  sheet.setColumnWidth(1, 180);
  sheet.setColumnWidth(2, 320);
  sheet.setColumnWidth(3, 300);
  sheet.setColumnWidth(4, 340);
  sheet.setFrozenRows(1);
  sheet.setRowHeight(1, 32);

  Logger.log('README populated — ' + lastRow + ' rows written.');
}

function generateId(name) {
  const base = name.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 20);
  const rand = Math.random().toString(36).slice(2, 6);
  return base + '_' + rand;
}

function fmtDate(d) {
  const y   = d.getFullYear();
  const m   = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function jsonOk(data) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, ...data }))
    .setMimeType(ContentService.MimeType.JSON);
}

function jsonErr(msg) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: false, error: msg }))
    .setMimeType(ContentService.MimeType.JSON);
}
