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

  for (let r = data.length - 1; r >= 1; r--) {
    if (String(data[r][dateIdx]) === String(dk)) logSheet.deleteRow(r + 1);
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
    anchordate:     task.anchorDate     || '',
    notes:          task.notes          || '',
    pushforward:    task.pushforward    || '',
    type:           task.type           || 'recurring',
    targetdate:     task.targetdate     || '',
    duedate:        task.duedate        || '',
    completiontype: task.completionType || 'categorical',
    checklistitems: task.checklistItems || '',
    datatype:       task.dataType       || '',
    datatarget:     task.dataTarget     || 'log',
    proactive:      task.proactive      || 'no',
    getaheaddays:   String(task.getaheadDays || 0),
  };

  const row = headers.map(h => rowMap[h] !== undefined ? rowMap[h] : '');
  tasksSheet.appendRow(row);
  return { ok: true, id };
}

// ─── UPDATE TASK ──────────────────────────────────────────────────────────────
// Updates specific fields of a task row by ID.
// Used when data validation completions need to write back a new date/value
// (e.g. OTO expiry date → targetdate field → task reappears on new date).

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
