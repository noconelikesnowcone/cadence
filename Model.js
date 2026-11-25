.pragma library

// One session for every monitor. Two clocks, drink and food. Logging what
// you had resets that clock. The words are read to build a habit: protein,
// vegetables, and water, and a lighter hand with starch and sweet drinks.
// Nothing here sums, weighs, or counts calories.

var LIMITS = {
  drinkMinutes: [15, 480],
  foodMinutes: [30, 720],
  remindAgainMinutes: [5, 120],
  windDownMinutes: [0, 180]
}

var STEPS = {
  drinkMinutes: 15,
  foodMinutes: 30,
  remindAgainMinutes: 5,
  sleepStartMinutes: 15,
  sleepEndMinutes: 15,
  windDownMinutes: 15
}

var DEFAULTS = {
  drinkMinutes: 120,
  foodMinutes: 240,
  remindAgainMinutes: 30,
  // Off until the panel or shell.json turns it on. 11:00 pm to 7:00 am.
  sleepEnabled: false,
  sleepStartMinutes: 23 * 60,
  sleepEndMinutes: 7 * 60,
  // How long before sleep the bedtime chime begins. 0 is off.
  windDownMinutes: 45
}

var SETTING_KEYS = [
  "drinkMinutes",
  "foodMinutes",
  "remindAgainMinutes",
  "sleepEnabled",
  "sleepStartMinutes",
  "sleepEndMinutes",
  "windDownMinutes"
]

var MINUTE_KEYS = {
  sleepStartMinutes: true,
  sleepEndMinutes: true
}

var GLYPHS = {
  drink: 0xF01AB,
  food: 0xF0A70,
  winddown: 0xF0F6C
}

// Bedtime chime repeats on its own, slower than a snooze and shorter than the wind-down.
var WIND_AGAIN_MS = 15 * 60 * 1000
var STAMP_AHEAD_MS = 36 * 60 * 60 * 1000

var NOTE_MAX = 80
var TEXT_MAX = 200
var HISTORY_MAX = 6
var PLATE_MAX = 24
// A protein or a vegetable older than this is named when the food reminder is due.
var GAP_MS = 8 * 60 * 60 * 1000

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

function asBool(value, fallback) {
  if (value === true || value === false) return value
  return fallback
}

function minuteOfDay(value, fallback) {
  var n = Math.round(Number(value))
  if (!isFinite(n) || n < 0 || n > 1439) return fallback
  return n
}

// Quarter-hour steps roll past midnight instead of sticking at 23:45.
function wrapMinute(value) {
  var n = Math.round(Number(value))
  if (!isFinite(n)) return DEFAULTS.sleepStartMinutes
  var day = 1440
  return ((n % day) + day) % day
}

function settingsFrom(raw) {
  var source = raw && typeof raw === "object" ? raw : {}
  return {
    drinkMinutes: clampInt(source.drinkMinutes, LIMITS.drinkMinutes[0], LIMITS.drinkMinutes[1], DEFAULTS.drinkMinutes),
    foodMinutes: clampInt(source.foodMinutes, LIMITS.foodMinutes[0], LIMITS.foodMinutes[1], DEFAULTS.foodMinutes),
    remindAgainMinutes: clampInt(source.remindAgainMinutes, LIMITS.remindAgainMinutes[0], LIMITS.remindAgainMinutes[1], DEFAULTS.remindAgainMinutes),
    sleepEnabled: asBool(source.sleepEnabled, DEFAULTS.sleepEnabled),
    sleepStartMinutes: minuteOfDay(source.sleepStartMinutes, DEFAULTS.sleepStartMinutes),
    sleepEndMinutes: minuteOfDay(source.sleepEndMinutes, DEFAULTS.sleepEndMinutes),
    windDownMinutes: clampInt(source.windDownMinutes, LIMITS.windDownMinutes[0], LIMITS.windDownMinutes[1], DEFAULTS.windDownMinutes)
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
    earlySleepUntil: 0,
    windDownAckStart: 0,
    windDownNotifiedAt: 0,
    history: [],
    plates: [],
    pendingDrink: false,
    pendingFood: false,
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
  if (MINUTE_KEYS[key]) return isFinite(delta) && delta !== 0
  var limits = LIMITS[key]
  if (!limits) return false
  var next = setting(key) + delta
  return next >= limits[0] && next <= limits[1]
}

function atMinute(year, month, day, minutes) {
  var when = new Date(year, month, day, 0, 0, 0, 0)
  when.setMinutes(minutes)
  return when.getTime()
}

// The window is half-open: asleep at the start, awake at the end. A window
// that crosses midnight belongs to the day it starts.
function windowBounds(year, month, day, startMin, endMin) {
  var start = atMinute(year, month, day, startMin)
  if (endMin > startMin) return [start, atMinute(year, month, day, endMin)]
  var next = new Date(year, month, day + 1)
  return [start, atMinute(next.getFullYear(), next.getMonth(), next.getDate(), endMin)]
}

function cleanStamp(value, now) {
  var n = Number(value)
  if (!isFinite(n) || n <= 0) return 0
  if (now > 0 && (n > now + STAMP_AHEAD_MS || n < now - STAMP_AHEAD_MS)) return 0
  return n
}

// The window that contains now, and the next one that has not started.
function nightContext(now) {
  ensure()
  var t = Number(now)
  var night = {
    quiet: false,
    early: false,
    scheduled: false,
    winding: false,
    silenced: false,
    untilMs: 0,
    sleepAt: 0,
    wakeAt: 0
  }
  if (!isFinite(t)) return night
  var settings = session.settings
  if (settings.sleepEnabled !== true) return night
  if (settings.sleepStartMinutes === settings.sleepEndMinutes) return night
  var d = new Date(t)
  var current = null
  var upcoming = null
  for (var offset = -1; offset <= 2; offset++) {
    var day = new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset)
    var bounds = windowBounds(day.getFullYear(), day.getMonth(), day.getDate(), settings.sleepStartMinutes, settings.sleepEndMinutes)
    if (t >= bounds[0] && t < bounds[1] && (!current || bounds[0] < current[0])) current = bounds
    if (bounds[0] > t && (!upcoming || bounds[0] < upcoming[0])) upcoming = bounds
  }
  if (current) {
    night.quiet = true
    night.scheduled = true
    night.sleepAt = current[0]
    night.wakeAt = current[1]
    return night
  }
  if (upcoming) {
    night.sleepAt = upcoming[0]
    night.wakeAt = upcoming[1]
    var lead = setting("windDownMinutes") * 60000
    var until = upcoming[0] - t
    if (lead > 0 && until > 0 && until <= lead) {
      night.winding = true
      night.untilMs = until
      night.silenced = session.windDownAckStart === upcoming[0]
    }
  }
  // Good night pulls quiet hours forward to the scheduled wake, and only that far.
  if (session.earlySleepUntil > t) {
    night.quiet = true
    night.early = true
    night.winding = false
    night.wakeAt = session.earlySleepUntil
  }
  return night
}

function isAsleep(now) {
  return nightContext(now).quiet
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
  var night = nightContext(now)
  var t = Number(now)
  var drinkHabit = currentDrinkNudge()
  var foodHabit = currentFoodNudge()
  return {
    drinkState: drink.state,
    drinkMs: drink.ms,
    drinkFraction: drink.fraction,
    drinkNote: session.drinkNote,
    foodState: food.state,
    foodMs: food.ms,
    foodFraction: food.fraction,
    foodNote: session.foodNote,
    proteinAt: signalAt("protein"),
    vegetableAt: signalAt("vegetable"),
    hasPlate: session.plates.length > 0,
    drinkNudge: drinkHabit ? drinkHabit.code : "",
    foodNudge: foodHabit ? foodHabit.code : "",
    drinkMinutes: session.settings.drinkMinutes,
    foodMinutes: session.settings.foodMinutes,
    remindAgainMinutes: session.settings.remindAgainMinutes,
    sleepEnabled: session.settings.sleepEnabled,
    sleepStartMinutes: session.settings.sleepStartMinutes,
    sleepEndMinutes: session.settings.sleepEndMinutes,
    windDownMinutes: session.settings.windDownMinutes,
    windingDown: night.winding,
    windDownMs: night.untilMs,
    windDownSilenced: night.silenced,
    earlySleep: night.early,
    asleep: night.quiet,
    canGoodNight: !night.quiet && night.wakeAt > t,
    canStayUp: night.early === true && night.scheduled !== true,
    canAckWindDown: night.winding === true && night.silenced !== true,
    canUndo: session.history.length > 0
  }
}

// Whole words and phrases only. "Eggplant" is not an egg, "green beans" are
// not the bean habit, and "soda water" is not a soda. A plate that already
// has protein and a vegetable is the habit, starch and all.
var PROTEIN = [
  "chicken", "beef", "steak", "pork", "bacon", "ham", "turkey", "lamb", "duck",
  "fish", "salmon", "tuna", "shrimp", "prawn", "crab", "cod", "tilapia", "trout",
  "sardine", "sardines", "mackerel", "anchovy", "scallop",
  "tofu", "tempeh", "seitan", "edamame",
  "egg", "eggs", "omelette", "omelet",
  "lentil", "lentils", "chickpea", "chickpeas", "hummus", "dal",
  "black beans", "kidney beans", "pinto beans", "beans", "bean",
  "yogurt", "yoghurt", "skyr", "quark", "cottage cheese",
  "cheese", "paneer", "halloumi", "parmesan", "mozzarella", "cheddar", "feta", "ricotta",
  "peanut butter", "peanut", "peanuts", "almond", "almonds", "nuts",
  "sausage", "meatball", "meatballs", "jerky", "whey", "protein", "meat", "milk",
  "burger", "hamburger", "cheeseburger", "hot dog", "hotdog", "pepperoni"
]

var VEGETABLE = [
  "salad", "broccoli", "spinach", "kale", "carrot", "carrots",
  "vegetable", "vegetables", "veggie", "veggies", "veg", "greens",
  "lettuce", "cabbage", "zucchini", "courgette", "asparagus",
  "pepper", "peppers", "cucumber", "tomato", "tomatoes",
  "onion", "onions", "mushroom", "mushrooms", "cauliflower",
  "brussels sprouts", "brussels", "bok choy", "pak choi", "celery",
  "eggplant", "aubergine",
  "green beans", "green bean", "string beans", "string bean", "bean sprouts", "bean sprout",
  "snap peas", "peas", "pea", "squash", "pumpkin",
  "radish", "beet", "beets", "arugula", "rocket", "chard",
  "collard", "collards", "okra", "artichoke", "leek", "leeks", "fennel",
  "sauerkraut", "kimchi", "slaw", "avocado", "seaweed", "nori",
  "pickle", "pickles", "salsa", "guacamole", "sweet potato", "sweet potatoes"
]

var NOT_VEGETABLE = [
  "tomato sauce", "tomato paste", "ketchup", "catsup", "onion rings", "pepperoni"
]

var NOT_PROTEIN = [
  "green beans", "green bean", "string beans", "string bean", "bean sprouts", "bean sprout"
]

var STARCH = [
  "fried rice", "white rice", "brown rice", "rice", "risotto", "biryani", "sushi", "congee",
  "porridge", "oatmeal", "oats", "cereal", "granola", "couscous", "polenta", "gnocchi",
  "mac and cheese", "mac n cheese", "mac cheese", "macaroni", "spaghetti", "lasagna", "ravioli", "pasta",
  "instant noodles", "noodles", "noodle", "ramen", "udon", "soba", "pho", "pad thai", "lo mein", "chow mein",
  "garlic bread", "bread", "toast", "bagel", "baguette", "brioche", "focaccia", "ciabatta", "sourdough",
  "naan", "pita", "tortilla", "wrap", "sandwich", "burrito", "taco", "quesadilla", "nachos",
  "croissant", "bun", "buns", "roll", "rolls", "biscuit", "biscuits", "muffin", "pretzel",
  "cracker", "crackers", "pancake", "pancakes", "waffle", "waffles",
  "donut", "doughnut", "pastry", "cake", "cookie", "cookies", "brownie", "gingerbread",
  "ice cream", "icecream", "chocolate", "candy", "pizza",
  "burger", "hamburger", "cheeseburger", "hot dog", "hotdog", "sub", "hoagie",
  "dumpling", "dumplings", "pierogi",
  "french fries", "fries", "chips", "crisps", "onion rings",
  "potato", "potatoes", "hash brown", "hash browns", "tater tots",
  "popcorn", "cornbread", "sweetcorn", "corn", "tortilla chips"
]

var SUGARY = [
  "sweet tea", "bubble tea", "milk tea", "energy drink", "red bull", "mountain dew",
  "dr pepper", "hot chocolate", "chocolate milk", "orange juice", "apple juice",
  "grape juice", "cranberry juice", "fruit juice", "soft drink", "milk shake",
  "ginger ale", "root beer", "cream soda", "soda pop", "coca cola", "coke zero",
  "diet coke", "diet pepsi", "ginger beer", "kool aid",
  "cola", "coke", "pepsi", "sprite", "fanta", "7up", "7 up", "soda", "pop",
  "juice", "lemonade", "smoothie", "milkshake", "gatorade", "powerade", "lucozade",
  "ribena", "frappuccino", "mocha", "boba", "monster", "koolaid", "tonic", "squash",
  "horchata", "chocolate", "caramel", "sugar", "syrup", "honey", "sweetened", "nectar"
]

var NOT_SUGARY = ["club soda", "soda water", "baking soda"]

var NUDGE_KEYS = {
  sugary: "nudge.sugary",
  heavyBare: "nudge.heavyBare",
  heavyProtein: "nudge.heavyProtein",
  heavyVegetable: "nudge.heavyVegetable"
}

function norm(note) {
  return String(note || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "")
}

function hasAny(text, phrases) {
  var padded = " " + text + " "
  for (var i = 0; i < phrases.length; i++) {
    if (!phrases[i]) continue
    if (padded.indexOf(" " + phrases[i] + " ") !== -1) return true
  }
  return false
}

function blankPhrases(text, phrases) {
  var ranked = phrases.slice().sort(function(a, b) { return b.length - a.length })
  var out = " " + text + " "
  for (var i = 0; i < ranked.length; i++) {
    if (!ranked[i]) continue
    var phrase = " " + ranked[i] + " "
    var guard = 0
    while (out.indexOf(phrase) !== -1 && guard < 8) {
      out = out.replace(phrase, " ")
      guard++
    }
  }
  return out.replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "")
}

function readFood(note) {
  var text = norm(plain(note, NOTE_MAX))
  return {
    protein: hasAny(blankPhrases(text, NOT_PROTEIN), PROTEIN),
    vegetable: hasAny(blankPhrases(text, NOT_VEGETABLE), VEGETABLE),
    heavy: hasAny(text, STARCH)
  }
}

function readDrink(note) {
  var text = blankPhrases(norm(plain(note, NOTE_MAX)), NOT_SUGARY)
  return { sugary: hasAny(text, SUGARY) }
}

// Starch is the nudge only when the plate is missing the habit.
function foodNudgeCode(reading) {
  if (!reading || !reading.heavy) return ""
  if (reading.protein && reading.vegetable) return ""
  if (reading.protein) return "heavyProtein"
  if (reading.vegetable) return "heavyVegetable"
  return "heavyBare"
}

function nudgeKey(code) {
  return NUDGE_KEYS[code] || ""
}

function signalAt(flag) {
  ensure()
  var best = 0
  for (var i = 0; i < session.plates.length; i++) {
    var plate = session.plates[i]
    if (!readFood(plate.note)[flag]) continue
    if (plate.at > best) best = plate.at
  }
  return best
}

function signalFresh(at, now) {
  var stamp = Number(at)
  var t = Number(now)
  if (!(stamp > 0) || !isFinite(t)) return false
  return t - stamp < GAP_MS
}

function missingKey(now) {
  ensure()
  if (!session.plates.length) return ""
  var t = Number(now)
  if (!isFinite(t)) return ""
  var proteinMiss = !signalFresh(signalAt("protein"), t)
  var vegetableMiss = !signalFresh(signalAt("vegetable"), t)
  if (proteinMiss && vegetableMiss) return "notice.food.both"
  if (proteinMiss) return "notice.food.protein"
  if (vegetableMiss) return "notice.food.vegetable"
  return ""
}

function currentDrinkNudge() {
  ensure()
  if (!(session.drinkAt > 0) || !session.drinkNote) return null
  if (!readDrink(session.drinkNote).sugary) return null
  return { kind: "drink", code: "sugary", note: session.drinkNote, at: session.drinkAt }
}

function currentFoodNudge() {
  ensure()
  if (!session.plates.length) return null
  var plate = session.plates[0]
  var code = foodNudgeCode(readFood(plate.note))
  if (!code) return null
  return { kind: "food", code: code, note: plate.note, at: plate.at }
}

function dropPlate(at, note) {
  for (var i = 0; i < session.plates.length; i++) {
    if (session.plates[i].at === at && session.plates[i].note === note) {
      session.plates.splice(i, 1)
      return
    }
  }
}

// The toast for a nudge that has not been shown yet. Clears the pending flags.
function takeNudges() {
  ensure()
  var nudges = []
  if (session.pendingDrink === true) {
    var drink = currentDrinkNudge()
    if (drink) nudges.push(drink)
  }
  if (session.pendingFood === true) {
    var food = currentFoodNudge()
    if (food) nudges.push(food)
  }
  if (session.pendingDrink === true || session.pendingFood === true) {
    session.pendingDrink = false
    session.pendingFood = false
    dirty = true
  }
  return nudges
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
  // A sweet drink or a starchy plate still resets the clock. The nudge is the habit.
  if (kind === "drink") session.pendingDrink = readDrink(cleaned).sugary === true
  if (kind === "food") {
    session.plates.unshift({ at: t, note: cleaned })
    if (session.plates.length > PLATE_MAX) session.plates.length = PLATE_MAX
    session.pendingFood = foodNudgeCode(readFood(cleaned)) !== ""
  }
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
  if (entry.kind === "drink") session.pendingDrink = false
  if (entry.kind === "food") {
    session.pendingFood = false
    dropPlate(entry.at, entry.note)
  }
  dirty = true
  return true
}

function dueNotices(now) {
  ensure()
  var t = Number(now)
  if (!isFinite(t)) return []
  // Quiet hours swallow the bell and the notification. The clocks keep
  // counting. A reminder that comes due overnight fires once the window ends,
  // not once for every repeat that was missed.
  if (isAsleep(t)) return []
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

// One bedtime chime when wind-down opens, then again every 15 minutes until
// it is silenced, good night starts quiet hours, or sleep itself begins.
function windDownNotice(now) {
  ensure()
  var t = Number(now)
  if (!isFinite(t)) return null
  var night = nightContext(t)
  if (!night.winding || night.silenced || night.quiet) return null
  var last = session.windDownNotifiedAt
  if (last > 0 && t - last < WIND_AGAIN_MS) return null
  session.windDownNotifiedAt = t
  dirty = true
  return { kind: "winddown", untilMs: night.untilMs, sleepAt: night.sleepAt }
}

function acknowledgeWindDown(now) {
  ensure()
  var t = Number(now)
  if (!isFinite(t)) return false
  var night = nightContext(t)
  if (!night.winding || night.silenced || !(night.sleepAt > 0)) return false
  session.windDownAckStart = night.sleepAt
  dirty = true
  return true
}

function goodNight(now) {
  ensure()
  var t = Number(now)
  if (!isFinite(t)) return false
  var night = nightContext(t)
  if (night.quiet || !(night.wakeAt > t)) return false
  session.earlySleepUntil = night.wakeAt
  if (night.sleepAt > 0) session.windDownAckStart = night.sleepAt
  dirty = true
  return true
}

function stayUp(now) {
  ensure()
  var t = Number(now)
  if (!isFinite(t) || !(session.earlySleepUntil > t)) return false
  if (nightContext(t).scheduled) return false
  session.earlySleepUntil = 0
  dirty = true
  return true
}

function applySettings(raw) {
  ensure()
  var merged = {}
  var incoming = raw && typeof raw === "object" ? raw : {}
  for (var i = 0; i < SETTING_KEYS.length; i++) {
    var key = SETTING_KEYS[i]
    merged[key] = session.settings[key]
    if (incoming[key] !== undefined && incoming[key] !== null) merged[key] = incoming[key]
  }
  var next = settingsFrom(merged)
  var changed = false
  for (var k = 0; k < SETTING_KEYS.length; k++) {
    if (next[SETTING_KEYS[k]] !== session.settings[SETTING_KEYS[k]]) changed = true
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
  state.earlySleepUntil = cleanStamp(data.earlySleepUntil, t)
  state.windDownAckStart = cleanStamp(data.windDownAckStart, t)
  state.windDownNotifiedAt = cleanAt(data.windDownNotifiedAt, t)
  var list = Array.isArray(data.history) ? data.history : []
  for (var i = 0; i < list.length && state.history.length < HISTORY_MAX; i++) {
    var item = list[i]
    if (!item || (item.kind !== "drink" && item.kind !== "food")) continue
    var note = plain(item.note, NOTE_MAX)
    var at = cleanAt(item.at, t)
    if (!note || !(at > 0)) continue
    state.history.push({ kind: item.kind, note: note, at: at })
  }
  state.plates = platesFrom(data, state.history, state.foodAt, state.foodNote, t)
  state.pendingDrink = data.pendingDrink === true
  state.pendingFood = data.pendingFood === true
  return state
}

function cleanPlates(list, now) {
  var out = []
  if (!Array.isArray(list)) return out
  for (var i = 0; i < list.length && out.length < PLATE_MAX; i++) {
    var item = list[i]
    if (!item || typeof item !== "object") continue
    var note = plain(item.note, NOTE_MAX)
    var at = cleanAt(item.at, now)
    if (!note || !(at > 0)) continue
    out.push({ at: at, note: note })
  }
  return out
}

// Older saves have the meal on the clock and not a plate list. Read that meal
// once so the habit has a place to start. A saved plate list is left alone.
function platesFrom(data, history, foodAt, foodNote, now) {
  if (Array.isArray(data.plates)) return cleanPlates(data.plates, now)
  var seeded = []
  for (var i = 0; i < history.length; i++) {
    if (history[i].kind !== "food") continue
    seeded.push({ at: history[i].at, note: history[i].note })
  }
  if (foodAt > 0 && foodNote) {
    var found = false
    for (var j = 0; j < seeded.length; j++) {
      if (seeded[j].at === foodAt && seeded[j].note === foodNote) found = true
    }
    if (!found) seeded.unshift({ at: foodAt, note: foodNote })
  }
  if (seeded.length > PLATE_MAX) seeded.length = PLATE_MAX
  return seeded
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

function copyPlates() {
  var out = []
  for (var i = 0; i < session.plates.length; i++) {
    var plate = session.plates[i]
    out.push({ at: plate.at, note: plate.note })
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
    earlySleepUntil: session.earlySleepUntil,
    windDownAckStart: session.windDownAckStart,
    windDownNotifiedAt: session.windDownNotifiedAt,
    history: copyHistory(),
    plates: copyPlates(),
    pendingDrink: session.pendingDrink === true,
    pendingFood: session.pendingFood === true,
    settings: {
      drinkMinutes: session.settings.drinkMinutes,
      foodMinutes: session.settings.foodMinutes,
      remindAgainMinutes: session.settings.remindAgainMinutes,
      sleepEnabled: session.settings.sleepEnabled,
      sleepStartMinutes: session.settings.sleepStartMinutes,
      sleepEndMinutes: session.settings.sleepEndMinutes,
      windDownMinutes: session.settings.windDownMinutes
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
    acknowledgeWindDown: acknowledgeWindDown,
    applySettings: applySettings,
    canNudge: canNudge,
    clockOf: clockOf,
    clockParts: clockParts,
    consumeDirty: consumeDirty,
    dueNotices: dueNotices,
    glyph: glyph,
    goodNight: goodNight,
    hydrate: hydrate,
    isAsleep: isAsleep,
    isHydrated: isHydrated,
    log: log,
    missingKey: missingKey,
    notificationCopy: notificationCopy,
    nudgeKey: nudgeKey,
    parseState: parseState,
    readDrink: readDrink,
    readFood: readFood,
    plain: plain,
    serialize: serialize,
    setting: setting,
    signalFresh: signalFresh,
    stayUp: stayUp,
    step: step,
    takeNudges: takeNudges,
    tooltipCopy: tooltipCopy,
    undo: undo,
    viewAt: viewAt,
    windDownNotice: windDownNotice,
    wrapMinute: wrapMinute
  }
}
