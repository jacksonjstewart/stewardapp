// ─── STEWARD · AppsScript Backend ──────────────────────────────────────────
// Paste this entire file into the Apps Script editor, then:
//   Deploy → New deployment → Web App
//   Execute as: Me · Access: Anyone
//   Copy the deployment URL into index.html → const API_URL = '...'

const SHEET_ID   = '1nZ6MOhUN9MsvUj6naUrLJanuQHFqRR9g3xP-c5jJH38';
const TASKS_TAB  = 'Tasks';   // Sheet tab with task definitions
const LOG_TAB    = 'Log';     // Sheet tab for completion history

// ─── ROUTING ─────────────────────────────────────────────────────────────────

function doPost(e) {
  try {
    const data   = JSON.parse(e.postData.contents);
    const action = data.action;

    if (action === 'commit')        return jsonOk(commitEntries(data.entries, data.dateKey));
    if (action === 'addTask')       return jsonOk(addTask(data.task));
    if (action === 'deleteTask')    return jsonOk(deleteTask(data.taskId));

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

    return jsonErr('Unknown action: ' + action);
  } catch (err) {
    return jsonErr(err.toString());
  }
}

// ─── COMMIT ──────────────────────────────────────────────────────────────────
// Full REPLACE for a given dateKey: delete every existing row for that date,
// then append the new set. Sending an empty entries array clears the day.
// This guarantees no stale rows — unchecking a task and re-committing removes it.

function commitEntries(entries, dateKey) {
  const dk = dateKey || (entries && entries.length ? entries[0].dateKey : null);
  if (!dk) return { committed: 0 };

  const ss       = SpreadsheetApp.openById(SHEET_ID);
  const logSheet = getOrCreateLog(ss);
  const data     = logSheet.getDataRange().getValues();
  const headers  = data[0];
  const dateIdx  = headers.indexOf('dateKey');

  // Delete all existing rows for this dateKey (iterate backwards to keep indices stable)
  for (let r = data.length - 1; r >= 1; r--) {
    if (String(data[r][dateIdx]) === String(dk)) {
      logSheet.deleteRow(r + 1);
    }
  }

  // Append fresh set
  (entries || []).forEach(entry => {
    logSheet.appendRow([
      entry.taskId      || '',
      entry.name        || '',
      entry.section     || '',
      entry.emoji       || '',
      entry.completedAt || '',
      entry.dateKey     || '',
      entry.who         || '',
    ]);
  });

  return { committed: (entries || []).length };
}

// ─── GET TODAY STATE ──────────────────────────────────────────────────────────
// Returns all log entries for a given dateKey so the frontend can hydrate
// doneLog on page load (handles multi-device sync).

function getTodayState(dateKey) {
  if (!dateKey) return { entries: [] };

  const ss       = SpreadsheetApp.openById(SHEET_ID);
  const logSheet = getOrCreateLog(ss);
  const data     = logSheet.getDataRange().getValues();
  const headers  = data[0];

  const dateIdx = headers.indexOf('dateKey');
  if (dateIdx < 0) return { entries: [] };

  const entries = data.slice(1)
    .filter(row => row[dateIdx] === dateKey)
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i]; });
      return obj;
    });

  return { entries };
}

// ─── GET HISTORY ──────────────────────────────────────────────────────────────
// Returns log entries from the past N days for the History view.

function getHistory(days) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = fmtDate(cutoff); // YYYY-MM-DD

  const ss       = SpreadsheetApp.openById(SHEET_ID);
  const logSheet = getOrCreateLog(ss);
  const data     = logSheet.getDataRange().getValues();
  const headers  = data[0];

  const dateIdx = headers.indexOf('dateKey');
  if (dateIdx < 0) return { entries: [] };

  const entries = data.slice(1)
    .filter(row => String(row[dateIdx]) >= cutoffStr)
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i]; });
      return obj;
    });

  return { entries };
}

// ─── ADD TASK ─────────────────────────────────────────────────────────────────
// Appends a new task row to the Tasks sheet.
// The frontend will re-sync the CSV after this call.

function addTask(task) {
  if (!task || !task.name) throw new Error('Task name is required');

  const ss         = SpreadsheetApp.openById(SHEET_ID);
  const tasksSheet = ss.getSheetByName(TASKS_TAB);
  if (!tasksSheet) throw new Error('Tasks sheet not found — check tab name');

  const headers = tasksSheet.getRange(1, 1, 1, tasksSheet.getLastColumn()).getValues()[0]
    .map(h => String(h).toLowerCase().replace(/\s+/g, ''));

  // Generate a short unique ID
  const id = task.id || generateId(task.name);

  const rowMap = {
    id:          id,
    name:        task.name        || '',
    emoji:       task.emoji       || '✅',
    section:     task.section     || 'home',
    frequency:   task.frequency   || 'once',
    dow:         task.dow         || '',
    dotm:        task.dotm        || '',
    dotw_ord:    task.dotw_ord    || '',
    yearmonth:   task.yearMonth   || '',
    anchordate:  task.anchorDate  || '',
    notes:       task.notes       || '',
    pushforward: task.pushforward || '',
    type:        task.type        || 'recurring',
    targetdate:  task.targetdate  || '',
    duedate:     task.duedate     || '',
  };

  const row = headers.map(h => rowMap[h] !== undefined ? rowMap[h] : '');
  tasksSheet.appendRow(row);

  return { ok: true, id };
}

// ─── DELETE TASK ──────────────────────────────────────────────────────────────
// Removes a task row from the Tasks sheet by ID.

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

// ─── MIDNIGHT TRIGGER (optional) ─────────────────────────────────────────────
// Set a time-driven trigger on this function: every day at midnight Edmonton time.
// Go to Triggers → Add Trigger → midnightCommit → Time-driven → Day timer → Midnight to 1am

function midnightCommit() {
  // This is a server-side safety net. The frontend also commits at midnight.
  // Nothing to do here unless you want server-side cleanup logic.
  Logger.log('Midnight commit check — ' + new Date().toISOString());
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function getOrCreateLog(ss) {
  let sheet = ss.getSheetByName(LOG_TAB);
  if (!sheet) {
    sheet = ss.insertSheet(LOG_TAB);
    sheet.appendRow(['taskId', 'name', 'section', 'emoji', 'completedAt', 'dateKey', 'who']);
  }
  return sheet;
}

function generateId(name) {
  const base = name.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 20);
  const rand = Math.random().toString(36).slice(2, 6);
  return base + '_' + rand;
}

function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
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
