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

function local(year, month, day, hour, minute) {
  return new Date(year, month, day, hour, minute, 0, 0).getTime()
}

test("quiet hours are off until asked, and the clock keeps counting", () => {
  const model = load()
  const logged = local(2026, 0, 15, 22, 42)
  const night = local(2026, 0, 16, 4, 18)
  model.log("drink", "water", logged)
  assert.equal(model.setting("sleepEnabled"), false)
  assert.equal(model.viewAt(night).asleep, false)
  assert.equal(model.clockOf("drink", night).state, "overdue")
  assert.equal(model.clockOf("drink", night).ms, (5 * 60 + 36) * 60 * 1000 - 2 * hour)
  assert.equal(model.dueNotices(night).length, 1)
})

test("quiet hours swallow overnight reminders and fire once at wake", () => {
  const model = load()
  const logged = local(2026, 0, 15, 22, 42)
  const night = local(2026, 0, 16, 4, 18)
  model.hydrate(JSON.stringify({
    version: 1,
    drinkAt: logged,
    drinkNote: "water",
    foodAt: logged,
    foodNote: "pho",
    drinkNotifiedAt: night - 6 * 60 * 1000,
    foodNotifiedAt: night - 6 * 60 * 1000,
    settings: { drinkMinutes: 120, foodMinutes: 240, remindAgainMinutes: 30 }
  }), night)
  model.applySettings({
    sleepEnabled: true,
    sleepStartMinutes: 23 * 60,
    sleepEndMinutes: 7 * 60
  })

  assert.equal(model.viewAt(night).asleep, true)
  assert.equal(model.clockOf("drink", night).state, "overdue")
  assert.equal(model.clockOf("drink", night).ms, (5 * 60 + 36) * 60 * 1000 - 2 * hour)
  assert.equal(model.dueNotices(night).length, 0)
  assert.equal(model.dueNotices(local(2026, 0, 16, 6, 59)).length, 0)
  const held = JSON.parse(model.serialize())
  assert.equal(held.drinkNotifiedAt, night - 6 * 60 * 1000)
  assert.equal(held.foodNotifiedAt, night - 6 * 60 * 1000)
  assert.equal(held.settings.sleepEnabled, true)

  const wake = local(2026, 0, 16, 7, 0)
  assert.equal(model.viewAt(wake).asleep, false)
  assert.deepEqual(kinds(model.dueNotices(wake)), ["drink", "food"])
  assert.equal(model.dueNotices(wake + 29 * 60 * 1000).length, 0)
})

test("a quiet window is half-open and may sit inside one day", () => {
  const model = load()
  model.applySettings({ sleepEnabled: true, sleepStartMinutes: 23 * 60, sleepEndMinutes: 7 * 60 })
  assert.equal(model.viewAt(local(2026, 0, 15, 22, 59)).asleep, false)
  assert.equal(model.viewAt(local(2026, 0, 15, 23, 0)).asleep, true)
  assert.equal(model.viewAt(local(2026, 0, 16, 6, 59)).asleep, true)
  assert.equal(model.viewAt(local(2026, 0, 16, 7, 0)).asleep, false)
  assert.equal(model.viewAt(local(2026, 0, 16, 12, 0)).asleep, false)

  model.applySettings({ sleepStartMinutes: 60, sleepEndMinutes: 5 * 60 })
  assert.equal(model.viewAt(local(2026, 0, 15, 0, 30)).asleep, false)
  assert.equal(model.viewAt(local(2026, 0, 15, 1, 0)).asleep, true)
  assert.equal(model.viewAt(local(2026, 0, 15, 4, 59)).asleep, true)
  assert.equal(model.viewAt(local(2026, 0, 15, 5, 0)).asleep, false)

  model.applySettings({ sleepEnabled: true, sleepStartMinutes: 22 * 60, sleepEndMinutes: 22 * 60 })
  assert.equal(model.viewAt(local(2026, 0, 15, 23, 0)).asleep, false)
})

test("wind-down opens before bedtime, repeats, and can be silenced", () => {
  const model = load()
  model.applySettings({
    sleepEnabled: true,
    sleepStartMinutes: 23 * 60,
    sleepEndMinutes: 7 * 60,
    windDownMinutes: 45
  })
  const early = local(2026, 0, 15, 22, 14)
  const open = local(2026, 0, 15, 22, 15)
  assert.equal(model.viewAt(early).windingDown, false)
  assert.equal(model.windDownNotice(early), null)
  assert.equal(model.viewAt(open).windingDown, true)
  assert.equal(model.viewAt(open).windDownMs, 45 * 60 * 1000)
  const first = model.windDownNotice(open)
  assert.equal(first.kind, "winddown")
  assert.deepEqual(Object.keys(first).sort(), ["kind", "sleepAt", "untilMs"])
  assert.equal(model.windDownNotice(open + 14 * 60 * 1000), null)
  const again = model.windDownNotice(open + 15 * 60 * 1000)
  assert.equal(again.kind, "winddown")
  assert.equal(again.untilMs, 30 * 60 * 1000)

  const quiet = load()
  quiet.applySettings({
    sleepEnabled: true,
    sleepStartMinutes: 23 * 60,
    sleepEndMinutes: 7 * 60,
    windDownMinutes: 45
  })
  assert.equal(quiet.acknowledgeWindDown(open), true)
  assert.equal(quiet.viewAt(open).windingDown, true)
  assert.equal(quiet.viewAt(open).windDownSilenced, true)
  assert.equal(quiet.windDownNotice(open + 15 * 60 * 1000), null)
  assert.equal(quiet.viewAt(local(2026, 0, 15, 23, 0)).asleep, true)
  assert.equal(quiet.viewAt(local(2026, 0, 15, 23, 0)).windingDown, false)
})

test("good night starts quiet hours early and stay up takes them back", () => {
  const model = load()
  const at = local(2026, 0, 15, 22, 20)
  model.applySettings({
    sleepEnabled: true,
    sleepStartMinutes: 23 * 60,
    sleepEndMinutes: 7 * 60,
    windDownMinutes: 45
  })
  model.log("drink", "water", at - 3 * hour)
  assert.equal(model.dueNotices(at).length, 1)
  assert.equal(model.goodNight(at), true)
  assert.equal(model.isAsleep(at + 1000), true)
  assert.equal(model.viewAt(at + 1000).earlySleep, true)
  assert.equal(model.dueNotices(at + 1000).length, 0)
  assert.equal(model.windDownNotice(at + 1000), null)
  assert.equal(model.goodNight(at + 1000), false)
  assert.equal(model.stayUp(at + 60 * 1000), true)
  assert.equal(model.isAsleep(at + 60 * 1000), false)
  assert.equal(model.viewAt(at + 60 * 1000).windingDown, true)

  assert.equal(model.goodNight(at), true)
  const during = local(2026, 0, 15, 23, 10)
  assert.equal(model.stayUp(during), false)
  assert.equal(model.isAsleep(during), true)
})

test("wind-down can cross midnight and rejects a bad lead", () => {
  const model = load()
  model.applySettings({
    sleepEnabled: true,
    sleepStartMinutes: 30,
    sleepEndMinutes: 7 * 60,
    windDownMinutes: 60
  })
  const at = local(2026, 0, 15, 23, 40)
  const view = model.viewAt(at)
  assert.equal(view.windingDown, true)
  assert.equal(view.windDownMs, 50 * 60 * 1000)
  assert.equal(model.windDownNotice(at).kind, "winddown")
  model.applySettings({ windDownMinutes: 0 })
  assert.equal(model.viewAt(at).windingDown, false)
  assert.equal(model.windDownNotice(at), null)
  assert.equal(model.goodNight(at), true)

  model.applySettings({ windDownMinutes: "nope" })
  assert.equal(model.setting("windDownMinutes"), 45)
  model.applySettings({ windDownMinutes: 9999 })
  assert.equal(model.setting("windDownMinutes"), 180)
  model.applySettings({ windDownMinutes: -4 })
  assert.equal(model.setting("windDownMinutes"), 0)
  assert.equal(model.canNudge("windDownMinutes", -15), false)
  assert.equal(model.glyph("winddown"), String.fromCodePoint(0xF0F6C))
})

test("a future good-night survives a reload and a far stamp does not", () => {
  const model = load()
  const now = local(2026, 0, 15, 22, 30)
  const wake = local(2026, 0, 16, 7, 0)
  const parsed = model.parseState(JSON.stringify({
    version: 1,
    earlySleepUntil: wake,
    windDownAckStart: local(2026, 0, 15, 23, 0),
    windDownNotifiedAt: now - 1000,
    settings: {
      sleepEnabled: true,
      sleepStartMinutes: 23 * 60,
      sleepEndMinutes: 7 * 60,
      windDownMinutes: 45
    }
  }), now)
  assert.equal(parsed.earlySleepUntil, wake)
  assert.equal(parsed.windDownAckStart, local(2026, 0, 15, 23, 0))
  assert.equal(parsed.windDownNotifiedAt, now - 1000)

  const fresh = load()
  fresh.hydrate(JSON.stringify({
    version: 1,
    earlySleepUntil: wake,
    settings: { sleepEnabled: true, sleepStartMinutes: 23 * 60, sleepEndMinutes: 7 * 60, windDownMinutes: 45 }
  }), now)
  assert.equal(fresh.isAsleep(now), true)
  assert.equal(fresh.viewAt(now).earlySleep, true)
  const saved = JSON.parse(fresh.serialize())
  assert.equal(saved.earlySleepUntil, wake)
  assert.equal(saved.settings.windDownMinutes, 45)

  const junk = fresh.parseState(JSON.stringify({
    version: 1,
    earlySleepUntil: now + 10 * 24 * 60 * 60 * 1000
  }), now)
  assert.equal(junk.earlySleepUntil, 0)
})

test("sleep times wrap at midnight and junk settings fall back", () => {
  const model = load()
  assert.equal(model.wrapMinute(23 * 60 + 45 + 15), 0)
  assert.equal(model.wrapMinute(-15), 23 * 60 + 45)
  model.applySettings({ sleepEnabled: "yes", sleepStartMinutes: -5, sleepEndMinutes: 9999 })
  assert.equal(model.setting("sleepEnabled"), false)
  assert.equal(model.setting("sleepStartMinutes"), 23 * 60)
  assert.equal(model.setting("sleepEndMinutes"), 7 * 60)
  assert.equal(model.canNudge("sleepStartMinutes", 15), true)
  assert.equal(model.canNudge("sleepStartMinutes", 0), false)
  model.applySettings({ sleepEnabled: true, sleepStartMinutes: 0, sleepEndMinutes: 1439 })
  assert.equal(model.setting("sleepEnabled"), true)
  assert.equal(model.setting("sleepStartMinutes"), 0)
  assert.equal(model.setting("sleepEndMinutes"), 1439)
  const saved = JSON.parse(model.serialize())
  assert.equal(saved.settings.sleepEnabled, true)
  assert.equal(saved.settings.sleepEndMinutes, 1439)
  assert.equal(/<|>|&/.test(JSON.stringify(saved.settings)), false)
})
