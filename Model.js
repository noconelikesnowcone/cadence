.pragma library

// One session for every monitor. Two clocks, drink and food. Logging what
// you had resets that clock. The note is only a label for the reset. Nothing
// here sums, weighs, or scores what was logged.

var LIMITS = {
  drinkMinutes: [15, 480],
  foodMinutes: [30, 720],
  remindAgainMinutes: [5, 120]
}

var STEPS = {
  drinkMinutes: 15,
  foodMinutes: 30,
  remindAgainMinutes: 5
}

var DEFAULTS = {
  drinkMinutes: 120,
  foodMinutes: 240,
  remindAgainMinutes: 30
}

var GLYPHS = {
  drink: 0xF01AB,
  food: 0xF0A70
}

var NOTE_MAX = 80
var TEXT_MAX = 200
var HISTORY_MAX = 6

var session = null
var hydrated = false
var dirty = false

function clampInt(value, min, max, fallback) {
  var n = Math.round(Number(value))
  if (!isFinite(n)) return fallback
  if (n < min) return min
  if (n > max) return max
  return n
}

function settingsFrom(raw) {
  var source = raw && typeof raw === "object" ? raw : {}
  return {
    drinkMinutes: clampInt(source.drinkMinutes, LIMITS.drinkMinutes[0], LIMITS.drinkMinutes[1], DEFAULTS.drinkMinutes),
    foodMinutes: clampInt(source.foodMinutes, LIMITS.foodMinutes[0], LIMITS.foodMinutes[1], DEFAULTS.foodMinutes),
    remindAgainMinutes: clampInt(source.remindAgainMinutes, LIMITS.remindAgainMinutes[0], LIMITS.remindAgainMinutes[1], DEFAULTS.remindAgainMinutes)
  }
}

function freshState(settings) {
  return {
    drinkAt: 0,
    foodAt: 0,
    drinkNote: "",
    foodNote: "",
    drinkNotifiedAt: 0,
    foodNotifiedAt: 0,
    history: [],
    settings: settingsFrom(settings)
  }
}

function ensure() {
  if (!session) session = freshState(null)
  return session
}

function isHydrated() {
  return hydrated
}

function setting(key) {
  ensure()
  return session.settings[key]
}

function step(key) {
  return STEPS[key] || 0
}

function canNudge(key, delta) {
  var limits = LIMITS[key]
  if (!limits) return false
  var next = setting(key) + delta
  return next >= limits[0] && next <= limits[1]
}

function glyph(name) {
  var cp = GLYPHS[name]
  return cp ? String.fromCodePoint(cp) : ""
}

// Notification bodies are rich text after entity decoding, and Qt's .arg()
// treats %1 in a note as another placeholder. Strip both.
function plain(value, limit) {
  var cap = typeof limit === "number" ? limit : TEXT_MAX
  var text = String(value == null ? "" : value)
  text = text.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, "")
  text = text.replace(/[<>&]/g, "")
  text = text.replace(/%/g, "％")
  text = text.trim()
  if (text.length > cap) text = text.slice(0, cap)
  return text
}

function fill(template, values) {
  var text = String(template || "")
  var list = values || []
  for (var i = 0; i < list.length; i++) {
    if (list[i] === undefined) continue
    text = text.replace("%" + (i + 1), plain(list[i]))
  }
  return plain(text)
}

function tooltipCopy(template, a, b, c) {
  return fill(template, [a, b, c])
}

function notificationCopy(title, bodyWithNote, bodyWithout, note) {
  var safe = plain(note, NOTE_MAX)
  var body = fill(safe ? bodyWithNote : bodyWithout, [safe])
  return { title: plain(title), body: body }
}

function cleanAt(value, now) {
  var n = Number(value)
  if (!isFinite(n) || n <= 0) return 0
  if (now > 0 && n > now + 2000) return now
  return n
}

function clockOf(kind, now) {
  ensure()
  var at = session[kind + "At"]
  if (!(at > 0)) return { state: "unset", ms: 0, fraction: 0 }
  var total = setting(kind + "Minutes") * 60000
  var elapsed = Number(now) - at
  if (!isFinite(elapsed) || elapsed < 0) elapsed = 0
  if (!(total > 0)) return { state: "overdue", ms: elapsed, fraction: 1 }
  if (elapsed >= total) return { state: "overdue", ms: elapsed - total, fraction: 1 }
  return { state: "remaining", ms: total - elapsed, fraction: elapsed / total }
}

function clockParts(ms) {
  var n = Number(ms)
  if (!isFinite(n) || n <= 0) return { hours: 0, minutes: 0 }
  var total = Math.ceil(n / 60000)
  var cap = 99 * 60 + 59
  if (total > cap) total = cap
  return { hours: Math.floor(total / 60), minutes: total % 60 }
}

function viewAt(now) {
  ensure()
  var drink = clockOf("drink", now)
  var food = clockOf("food", now)
  return {
    drinkState: drink.state,
    drinkMs: drink.ms,
    drinkFraction: drink.fraction,
    drinkNote: session.drinkNote,
    foodState: food.state,
    foodMs: food.ms,
    foodFraction: food.fraction,
    foodNote: session.foodNote,
    drinkMinutes: session.settings.drinkMinutes,
    foodMinutes: session.settings.foodMinutes,
    remindAgainMinutes: session.settings.remindAgainMinutes,
    canUndo: session.history.length > 0
  }
}

function log(kind, note, now) {
  if (kind !== "drink" && kind !== "food") return false
  var cleaned = plain(note, NOTE_MAX)
  var t = Number(now)
  if (!cleaned || !isFinite(t) || t <= 0) return false
  ensure()
  session[kind + "At"] = t
  session[kind + "Note"] = cleaned
  session[kind + "NotifiedAt"] = 0
  session.history.unshift({ kind: kind, note: cleaned, at: t })
  if (session.history.length > HISTORY_MAX) session.history.length = HISTORY_MAX
  dirty = true
  return true
}

function undo() {
  ensure()
  if (!session.history.length) return false
  var entry = session.history.shift()
  var prev = null
  for (var i = 0; i < session.history.length; i++) {
    if (session.history[i].kind === entry.kind) {
      prev = session.history[i]
      break
    }
  }
  if (prev) {
    session[entry.kind + "At"] = prev.at
    session[entry.kind + "Note"] = prev.note
  } else {
    session[entry.kind + "At"] = 0
    session[entry.kind + "Note"] = ""
  }
  session[entry.kind + "NotifiedAt"] = 0
  dirty = true
  return true
}

function dueNotices(now) {
  ensure()
  var t = Number(now)
  if (!isFinite(t)) return []
  var again = setting("remindAgainMinutes") * 60000
  var kinds = ["drink", "food"]
  var notices = []
  for (var i = 0; i < kinds.length; i++) {
    var kind = kinds[i]
    var clock = clockOf(kind, t)
    if (clock.state !== "overdue") continue
    var last = session[kind + "NotifiedAt"]
    if (last > 0 && t - last < again) continue
    session[kind + "NotifiedAt"] = t
    dirty = true
    notices.push({ kind: kind, note: session[kind + "Note"] })
  }
  return notices
}

function applySettings(raw) {
  ensure()
  var merged = {
    drinkMinutes: session.settings.drinkMinutes,
    foodMinutes: session.settings.foodMinutes,
    remindAgainMinutes: session.settings.remindAgainMinutes
  }
  var incoming = raw && typeof raw === "object" ? raw : {}
  var keys = ["drinkMinutes", "foodMinutes", "remindAgainMinutes"]
  for (var i = 0; i < keys.length; i++) {
    if (incoming[keys[i]] !== undefined && incoming[keys[i]] !== null)
      merged[keys[i]] = incoming[keys[i]]
  }
  var next = settingsFrom(merged)
  var changed = false
  for (var k = 0; k < keys.length; k++) {
    if (next[keys[k]] !== session.settings[keys[k]]) changed = true
  }
  session.settings = next
  if (changed) dirty = true
  return changed
}

function parseState(raw, now) {
  var data = raw
  if (typeof raw === "string") {
    if (!raw || !String(raw).trim()) return null
    try { data = JSON.parse(raw) } catch (e) { return null }
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null
  if (data.version !== 1) return null
  var t = Number(now)
  if (!isFinite(t)) t = 0
  var state = freshState(data.settings)
  state.drinkAt = cleanAt(data.drinkAt, t)
  state.foodAt = cleanAt(data.foodAt, t)
  state.drinkNote = state.drinkAt > 0 ? plain(data.drinkNote, NOTE_MAX) : ""
  state.foodNote = state.foodAt > 0 ? plain(data.foodNote, NOTE_MAX) : ""
  if (state.drinkAt > 0 && !state.drinkNote) state.drinkAt = 0
  if (state.foodAt > 0 && !state.foodNote) state.foodAt = 0
  state.drinkNotifiedAt = cleanAt(data.drinkNotifiedAt, t)
  state.foodNotifiedAt = cleanAt(data.foodNotifiedAt, t)
  var list = Array.isArray(data.history) ? data.history : []
  for (var i = 0; i < list.length && state.history.length < HISTORY_MAX; i++) {
    var item = list[i]
    if (!item || (item.kind !== "drink" && item.kind !== "food")) continue
    var note = plain(item.note, NOTE_MAX)
    var at = cleanAt(item.at, t)
    if (!note || !(at > 0)) continue
    state.history.push({ kind: item.kind, note: note, at: at })
  }
  return state
}

function hydrate(raw, now) {
  if (hydrated) return null
  hydrated = true
  var t = Number(now)
  if (!isFinite(t)) t = 0
  session = parseState(raw, t) || freshState(null)
  dirty = false
  return null
}

function copyHistory() {
  var out = []
  for (var i = 0; i < session.history.length; i++) {
    var item = session.history[i]
    out.push({ kind: item.kind, note: item.note, at: item.at })
  }
  return out
}

function serialize() {
  ensure()
  return JSON.stringify({
    version: 1,
    drinkAt: session.drinkAt,
    foodAt: session.foodAt,
    drinkNote: session.drinkNote,
    foodNote: session.foodNote,
    drinkNotifiedAt: session.drinkNotifiedAt,
    foodNotifiedAt: session.foodNotifiedAt,
    history: copyHistory(),
    settings: {
      drinkMinutes: session.settings.drinkMinutes,
      foodMinutes: session.settings.foodMinutes,
      remindAgainMinutes: session.settings.remindAgainMinutes
    }
  }, null, 2) + "\n"
}

function consumeDirty() {
  if (!dirty) return false
  dirty = false
  return true
}

if (typeof module !== "undefined") {
  module.exports = {
    applySettings: applySettings,
    canNudge: canNudge,
    clockOf: clockOf,
    clockParts: clockParts,
    consumeDirty: consumeDirty,
    dueNotices: dueNotices,
    glyph: glyph,
    hydrate: hydrate,
    isHydrated: isHydrated,
    log: log,
    notificationCopy: notificationCopy,
    parseState: parseState,
    plain: plain,
    serialize: serialize,
    setting: setting,
    step: step,
    tooltipCopy: tooltipCopy,
    undo: undo,
    viewAt: viewAt
  }
}
