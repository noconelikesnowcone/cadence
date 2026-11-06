import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import vm from "node:vm"

const source = readFileSync(new URL("./Model.js", import.meta.url), "utf8")
  .replace(/^\.pragma library\n/, "")

function load() {
  const sandbox = { module: { exports: {} } }
  vm.runInNewContext(source, sandbox, { filename: "Model.js" })
  return sandbox.module.exports
}

const tracker = '<img src="https://example.invalid/tracker">'
const hour = 60 * 60 * 1000

function assertClock(model, ms, hours, minutes) {
  const parts = model.clockParts(ms)
  assert.equal(parts.hours, hours)
  assert.equal(parts.minutes, minutes)
}

function kinds(notices) {
  return Array.from(notices, (notice) => notice.kind)
}

test("plain text drops markup, entities, controls, and placeholders", () => {
  const model = load()
  const cleaned = model.plain(tracker + "\nhello&lt;&amp; 100%")
  assert.equal(cleaned.includes("<"), false)
  assert.equal(cleaned.includes(">"), false)
  assert.equal(cleaned.includes("&"), false)
  assert.equal(cleaned.includes("\n"), false)
  assert.equal(cleaned.includes("%"), false)
  assert.equal(model.plain("water"), "water")
})

test("tooltip and notification sinks stay plain when given markup", () => {
  const model = load()
  const tip = model.tooltipCopy("%1 · %2 · %3 left", "Drink", tracker, "2 hours")
  assert.equal(tip.includes("<"), false)
  assert.equal(tip.includes(">"), false)
  assert.equal(tip.includes("&"), false)
  assert.equal(tip.includes("2 hours"), true)

  const notice = model.notificationCopy(
    tracker,
    "Last was %1.",
    "The reminder is due.",
    "100% water " + tracker)
  assert.equal(notice.title.includes("<"), false)
  assert.equal(notice.title.includes(">"), false)
  assert.equal(notice.body.includes("<"), false)
  assert.equal(notice.body.includes(">"), false)
  assert.equal(notice.body.includes("%"), false)
  assert.equal(notice.body.startsWith("Last was "), true)
  assert.equal(notice.body.includes("100％ water"), true)

  const empty = model.notificationCopy("Time to eat", "Last was %1.", "The reminder is due.", "   ")
  assert.equal(empty.body, "The reminder is due.")
})

test("logging resets one clock and keeps the other", () => {
  const model = load()
  const now = 1_700_000_000_000
  assert.equal(model.log("drink", "   ", now), false)
  assert.equal(model.log("snack", "apple", now), false)
  assert.equal(model.log("drink", tracker, now), true)
  assert.equal(model.log("food", "rice and eggs", now + 1000), true)

  const drink = model.clockOf("drink", now + 1000)
  const food = model.clockOf("food", now + 1000)
  assert.equal(drink.state, "remaining")
  assert.equal(food.state, "remaining")
  assert.equal(drink.ms, 2 * hour - 1000)
  assert.equal(food.ms, 4 * hour)

  const view = model.viewAt(now + 1000)
  assert.equal(view.drinkNote.includes("<"), false)
  assert.equal(view.foodNote, "rice and eggs")
  assert.equal(view.canUndo, true)
  assert.equal("calories" in view, false)
})

test("a markup-only note does not reset the clock", () => {
  const model = load()
  assert.equal(model.log("food", "<<<>>>", 1_700_000_000_000), false)
  assert.equal(model.clockOf("food", 1_700_000_000_000).state, "unset")
})

test("undo restores the previous clock for that kind only", () => {
  const model = load()
  const first = 1_700_000_000_000
  const second = first + hour
  model.log("drink", "water", first)
  model.log("food", "soup", first + 5000)
  model.log("drink", "tea", second)
  assert.equal(model.undo(), true)
  assert.equal(model.viewAt(second).drinkNote, "water")
  assert.equal(model.clockOf("drink", second).ms, 2 * hour - hour)
  assert.equal(model.viewAt(second).foodNote, "soup")
  assert.equal(model.undo(), true)
  assert.equal(model.viewAt(second).foodState, "unset")
  assert.equal(model.viewAt(second).drinkNote, "water")
  assert.equal(model.undo(), true)
  assert.equal(model.viewAt(second).drinkState, "unset")
  assert.equal(model.undo(), false)
})

test("history keeps the six newest labels and nothing else about them", () => {
  const model = load()
  const start = 1_700_000_000_000
  for (let i = 0; i < 7; i++) model.log(i % 2 ? "food" : "drink", "item " + i, start + i * 1000)
  const saved = JSON.parse(model.serialize())
  assert.equal(saved.history.length, 6)
  assert.equal(saved.history[0].note, "item 6")
  assert.deepEqual(Object.keys(saved.history[0]).sort(), ["at", "kind", "note"])
  const banned = JSON.stringify(saved)
  assert.equal(/calorie|kcal|energy|protein|carb/i.test(banned), false)
  assert.equal(Object.hasOwn(saved, "calories"), false)
})

test("an overdue clock notifies once per remind-again interval", () => {
  const model = load()
  const logged = 1_700_000_000_000
  model.log("drink", "water", logged)
  model.log("food", "lunch", logged)
  const due = logged + 4 * hour
  const mid = model.dueNotices(logged + 2 * hour)
  assert.deepEqual(kinds(mid), ["drink"])
  const first = model.dueNotices(due)
  assert.deepEqual(kinds(first), ["drink", "food"])
  assert.deepEqual(Object.keys(first[0]).sort(), ["kind", "note"])
  assert.equal(model.dueNotices(due + 29 * 60 * 1000).length, 0)
  const again = model.dueNotices(due + 30 * 60 * 1000)
  assert.deepEqual(kinds(again), ["drink", "food"])
})

test("nothing logged never notifies, and a log clears a pending reminder", () => {
  const model = load()
  const now = 1_700_000_000_000
  assert.equal(model.dueNotices(now).length, 0)
  model.log("drink", "water", now - 3 * hour)
  assert.equal(model.dueNotices(now).length, 1)
  assert.equal(model.log("drink", "tea", now), true)
  assert.equal(model.dueNotices(now).length, 0)
  assert.equal(model.clockOf("drink", now).state, "remaining")
})

test("changing an interval does not move the moment you logged", () => {
  const model = load()
  const now = 1_700_000_000_000
  model.log("food", "lunch", now)
  model.applySettings({ foodMinutes: 60, calories: 900 })
  assert.equal(model.setting("foodMinutes"), 60)
  assert.equal(model.clockOf("food", now + 30 * 60 * 1000).state, "remaining")
  assert.equal(model.clockOf("food", now + 61 * 60 * 1000).state, "overdue")
  assert.equal(model.setting("calories"), undefined)
})

test("settings and saved state reject junk, including a markup phase", () => {
  const model = load()
  const now = 1_700_000_000_000
  model.applySettings({ drinkMinutes: "nope", foodMinutes: 0, remindAgainMinutes: 9999 })
  assert.equal(model.setting("drinkMinutes"), 120)
  assert.equal(model.setting("foodMinutes"), 30)
  assert.equal(model.setting("remindAgainMinutes"), 120)
  assert.equal(model.canNudge("drinkMinutes", -15), true)
  model.applySettings({ drinkMinutes: 15 })
  assert.equal(model.canNudge("drinkMinutes", -15), false)
  assert.equal(model.canNudge("foodMinutes", model.step("foodMinutes")), true)

  const parsed = model.parseState(JSON.stringify({
    version: 1,
    drinkAt: now + hour,
    drinkNote: tracker,
    foodAt: "soon",
    foodNote: "rice",
    history: [
      { kind: tracker, note: "nope", at: now },
      { kind: "drink", note: tracker, at: now - hour }
    ]
  }), now)
  assert.equal(parsed.drinkAt, now)
  assert.equal(parsed.drinkNote.includes("<"), false)
  assert.equal(parsed.foodAt, 0)
  assert.equal(parsed.history.length, 1)
  assert.equal(parsed.history[0].kind, "drink")
  assert.equal(model.parseState('{"version":"1"}', now), null)
})

test("hydrate applies once and a second call leaves the session alone", () => {
  const model = load()
  const now = 1_700_000_000_000
  const raw = JSON.stringify({
    version: 1,
    drinkAt: now - 3 * hour,
    drinkNote: "water",
    foodAt: 0,
    foodNote: "",
    history: [{ kind: "drink", note: "water", at: now - 3 * hour }],
    settings: { drinkMinutes: 120, foodMinutes: 240, remindAgainMinutes: 30 }
  })
  assert.equal(model.hydrate(raw, now), null)
  assert.equal(model.dueNotices(now).length, 1)
  model.log("food", "lunch", now)
  assert.equal(model.hydrate('{"version":1,"drinkNote":"nope"}', now), null)
  assert.equal(model.viewAt(now).foodNote, "lunch")
  assert.equal(model.isHydrated(), true)
})

test("clock parts ceil to the next visible minute and then cap", () => {
  const model = load()
  assertClock(model, 2 * hour, 2, 0)
  assertClock(model, 2 * hour - 1, 2, 0)
  assertClock(model, 2 * hour - 60000, 1, 59)
  assertClock(model, 1, 0, 1)
  assertClock(model, 0, 0, 0)
  assertClock(model, -5, 0, 0)
  assertClock(model, 200 * hour, 99, 59)
})

test("glyphs are the drink and food marks", () => {
  const model = load()
  assert.equal(model.glyph("drink"), String.fromCodePoint(0xF01AB))
  assert.equal(model.glyph("food"), String.fromCodePoint(0xF0A70))
  assert.equal(model.glyph("calorie"), "")
})
