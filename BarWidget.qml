import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Commons as Commons
import qs.Ui
import "Model.js" as Model

// Drink and food clocks. Logging what you had resets that clock. The words
// steer the next habit: protein, vegetables, and water. The session is shared
// by every monitor and is saved only when it changes.
BarWidget {
  id: root
  moduleName: "giaodn.cadence"

  property double now: Date.now()
  // Replaced as a whole on each refresh. Bindings see that. Fields inside
  // the previous object would not notify, because the session lives in JS.
  property var view: ({
    drinkState: "unset",
    drinkMs: 0,
    drinkFraction: 0,
    drinkNote: "",
    foodState: "unset",
    foodMs: 0,
    foodFraction: 0,
    foodNote: "",
    proteinAt: 0,
    vegetableAt: 0,
    hasPlate: false,
    drinkNudge: "",
    foodNudge: "",
    drinkMinutes: 120,
    foodMinutes: 240,
    remindAgainMinutes: 30,
    sleepEnabled: false,
    sleepStartMinutes: 23 * 60,
    sleepEndMinutes: 7 * 60,
    windDownMinutes: 45,
    windingDown: false,
    windDownMs: 0,
    windDownSilenced: false,
    earlySleep: false,
    asleep: false,
    canGoodNight: false,
    canStayUp: false,
    canAckWindDown: false,
    canUndo: false
  })

  readonly property string statePath: {
    var home = Quickshell.env("HOME")
    var stateHome = Quickshell.env("XDG_STATE_HOME")
    var base = stateHome && stateHome.length > 0 ? stateHome : (home + "/.local/state")
    return base + "/omarchy/giaodn.cadence.json"
  }

  readonly property string quietPath: {
    var home = Quickshell.env("HOME")
    var stateHome = Quickshell.env("XDG_STATE_HOME")
    var base = stateHome && stateHome.length > 0 ? stateHome : (home + "/.local/state")
    return base + "/omarchy/notifications/quiet.json"
  }

  readonly property string bellPath: fileUrlPath(Qt.resolvedUrl("bell.wav"))
  readonly property string windPath: fileUrlPath(Qt.resolvedUrl("winddown.wav"))

  readonly property string drinkState: view.drinkState
  readonly property double drinkMs: view.drinkMs
  readonly property real drinkFraction: view.drinkFraction
  readonly property string drinkNote: view.drinkNote
  readonly property string foodState: view.foodState
  readonly property double foodMs: view.foodMs
  readonly property real foodFraction: view.foodFraction
  readonly property string foodNote: view.foodNote
  readonly property double proteinAt: view.proteinAt || 0
  readonly property double vegetableAt: view.vegetableAt || 0
  readonly property bool hasPlate: view.hasPlate === true
  readonly property string drinkNudge: view.drinkNudge || ""
  readonly property string foodNudge: view.foodNudge || ""
  readonly property int drinkMinutes: view.drinkMinutes
  readonly property int foodMinutes: view.foodMinutes
  readonly property int remindAgainMinutes: view.remindAgainMinutes
  readonly property bool sleepEnabled: view.sleepEnabled === true
  readonly property int sleepStartMinutes: view.sleepStartMinutes
  readonly property int sleepEndMinutes: view.sleepEndMinutes
  readonly property int windDownMinutes: view.windDownMinutes
  readonly property bool windingDown: view.windingDown === true
  readonly property double windDownMs: view.windDownMs
  readonly property bool windDownSilenced: view.windDownSilenced === true
  readonly property bool earlySleep: view.earlySleep === true
  readonly property bool asleep: view.asleep === true
  readonly property bool canGoodNight: view.canGoodNight === true
  readonly property bool canStayUp: view.canStayUp === true
  readonly property bool canAckWindDown: view.canAckWindDown === true
  readonly property bool canUndo: view.canUndo === true

  readonly property string urgentKind: {
    var drinkOver = drinkState === "overdue"
    var foodOver = foodState === "overdue"
    if (drinkOver && !foodOver) return "drink"
    if (foodOver && !drinkOver) return "food"
    if (drinkOver && foodOver) return drinkMs >= foodMs ? "drink" : "food"
    if (drinkState === "unset") return foodState === "unset" ? "drink" : "food"
    if (foodState === "unset") return "drink"
    return drinkMs <= foodMs ? "drink" : "food"
  }

  readonly property bool opened: panelLoader.item ? panelLoader.item.opened === true : false
  readonly property bool popoutSwitchClosing: panelLoader.item ? panelLoader.item.popoutSwitchClosing === true : false
  readonly property real openPanelIndicatorWidth: face.width
  readonly property real openPanelIndicatorHeight: face.height
  function habitLine(code) {
    var key = Model.nudgeKey(code)
    if (!key) return ""
    var titleKey = code === "sugary" ? "notice.nudge.drink.title" : "notice.nudge.food.title"
    return Model.plain(strings.t(titleKey) + " · " + strings.t(key))
  }

  readonly property string tooltip: {
    var line = tipFor("drink") + "    " + tipFor("food")
    var drinkHabit = habitLine(drinkNudge)
    var foodHabit = habitLine(foodNudge)
    if (drinkHabit) line += "    " + drinkHabit
    if (foodHabit) line += "    " + foodHabit
    if (asleep)
      return Model.plain(line + "    " + strings.t("bar.sleeping").arg(minuteClock(sleepEndMinutes)))
    if (windingDown) {
      var bed = strings.t("bar.winding")
        .arg(minuteClock(sleepStartMinutes))
        .arg(durationPhrase(windDownMs))
      return Model.plain(line + "    " + bed)
    }
    return line
  }

  function minuteClock(minutes) {
    var day = Model.wrapMinute(minutes)
    var when = new Date(2000, 0, 1, 0, 0, 0, 0)
    when.setMinutes(day)
    return clockText(when)
  }

  function minuteClockAt(ms) {
    return clockText(new Date(ms))
  }

  function clockText(when) {
    var locale = Qt.locale(Commons.I18n.formatLocale)
    return Model.plain(locale.toString(when, locale.timeFormat(Locale.ShortFormat)))
  }

  function pad(value) {
    var text = Commons.I18n.formatNumber(value)
    if (text.length >= 2) return text
    return Commons.I18n.formatNumber(0) + text
  }

  function formatFace(state, ms) {
    if (state === "unset") return strings.t("bar.unset")
    var parts = Model.clockParts(ms)
    return pad(parts.hours) + ":" + pad(parts.minutes)
  }

  function durationPhrase(ms) {
    var parts = Model.clockParts(ms)
    if (parts.hours > 0 && parts.minutes > 0) {
      return strings.t("duration.hoursMinutes")
        .arg(Commons.I18n.formatNumber(parts.hours))
        .arg(Commons.I18n.formatNumber(parts.minutes))
    }
    if (parts.hours > 0)
      return strings.tn("duration.hours", parts.hours).arg(Commons.I18n.formatNumber(parts.hours))
    return strings.tn("duration.minutes", parts.minutes).arg(Commons.I18n.formatNumber(parts.minutes))
  }

  function tipFor(kind) {
    var label = strings.t(kind === "food" ? "kind.food" : "kind.drink")
    var state = kind === "food" ? foodState : drinkState
    var note = kind === "food" ? foodNote : drinkNote
    var ms = kind === "food" ? foodMs : drinkMs
    if (state === "unset")
      return Model.tooltipCopy(strings.t("bar.tooltipUnset"), label, strings.t("bar.nothing"))
    var key = state === "overdue" ? "bar.tooltipOverdue" : "bar.tooltipLeft"
    return Model.tooltipCopy(strings.t(key), label, note, durationPhrase(ms))
  }

  function kindColor(state) {
    var ink = bar ? bar.barForeground : Commons.Color.foreground
    if (asleep) return Qt.darker(ink, 1.35)
    if (state === "overdue") return Commons.Color.accent
    if (state === "unset") return Qt.darker(ink, 1.45)
    return ink
  }

  function refresh() {
    var t = Date.now()
    now = t
    var quiet = Model.isAsleep(t)
    var notices = quiet ? [] : Model.dueNotices(t)
    var wind = quiet ? null : Model.windDownNotice(t)
    // Quiet hours swallow the toast. The panel still shows the habit line.
    var nudges = Model.takeNudges()
    view = Model.viewAt(t)
    saveState()
    for (var i = 0; i < notices.length; i++) sendNotice(notices[i], t)
    if (wind) sendWindNotice(wind)
    if (!quiet) {
      for (var n = 0; n < nudges.length; n++) sendNudge(nudges[n])
    }
    // The bowl replaces the diner bell while winding down, including the
    // minute a drink or a meal is due as well.
    if (wind) play(windPath)
    else if (notices.length > 0 && !view.windingDown) play(bellPath)
  }

  function fileUrlPath(url) {
    var text = String(url)
    if (text.indexOf("file://") === 0) text = text.slice(7)
    try { text = decodeURIComponent(text) } catch (e) {}
    return text
  }

  // Do Not Disturb already hides the toast. The bell follows it.
  function doNotDisturb() {
    var raw = quietFile.text()
    if (!raw || raw.length > 4096) return false
    try {
      var data = JSON.parse(raw)
      return !!(data && data.dnd === true)
    } catch (e) {
      return false
    }
  }

  function play(path) {
    if (doNotDisturb() || !path) return
    Util.execArgv([
      "paplay",
      "--client-name", "Cadence",
      "--stream-name", "Cadence",
      path
    ])
  }

  function saveState() {
    if (!Model.consumeDirty()) return
    var next = Model.serialize()
    if (stateFile.text() === next) return
    stateFile.setText(next)
  }

  function currentSettings() {
    var keys = ["drinkMinutes", "foodMinutes", "remindAgainMinutes", "sleepEnabled", "sleepStartMinutes", "sleepEndMinutes", "windDownMinutes"]
    var out = {}
    for (var i = 0; i < keys.length; i++) {
      var value = settings ? settings[keys[i]] : undefined
      if (value !== undefined && value !== null) out[keys[i]] = value
    }
    return out
  }

  function commitSettings(patch) {
    var entry = { id: moduleName }
    if (settings) {
      for (var existing in settings)
        if (existing !== "id") entry[existing] = settings[existing]
    }
    var keys = ["drinkMinutes", "foodMinutes", "remindAgainMinutes", "sleepEnabled", "sleepStartMinutes", "sleepEndMinutes", "windDownMinutes"]
    for (var i = 0; i < keys.length; i++) entry[keys[i]] = Model.setting(keys[i])
    if (patch) {
      for (var key in patch) entry[key] = patch[key]
    }
    settings = entry
    if (bar && bar.shell && typeof bar.shell.updateEntryInline === "function")
      bar.shell.updateEntryInline(moduleName, entry)
  }

  function sendNotice(notice, t) {
    if (!notice || (notice.kind !== "drink" && notice.kind !== "food")) return
    var copy = Model.notificationCopy(
      strings.t("notice." + notice.kind + ".title"),
      strings.t("notice.body"),
      strings.t("notice.bodyEmpty"),
      notice.note)
    if (notice.kind === "food") {
      var miss = Model.missingKey(t)
      if (miss === "notice.food.protein" || miss === "notice.food.vegetable" || miss === "notice.food.both") {
        var extra = Model.plain(strings.t(miss))
        copy.body = copy.body ? Model.plain(copy.body + " " + extra) : extra
      }
    }
    var argv = [
      "omarchy-notification-send",
      "--app-name", "Cadence",
      "-g", Model.glyph(notice.kind),
      "-u", "normal",
      "-t", "12000",
      copy.title
    ]
    if (copy.body) argv.push(copy.body)
    Util.execArgv(argv)
  }

  function sendNudge(nudge) {
    var key = Model.nudgeKey(nudge && nudge.code)
    if (!key || (nudge.kind !== "drink" && nudge.kind !== "food")) return
    var title = Model.plain(strings.t(nudge.kind === "drink" ? "notice.nudge.drink.title" : "notice.nudge.food.title"))
    var advice = Model.plain(strings.t(key))
    var last = Model.notificationCopy("", strings.t("notice.body"), "", nudge.note).body
    var body = last ? Model.plain(advice + " " + last) : advice
    var argv = [
      "omarchy-notification-send",
      "--app-name", "Cadence",
      "-g", Model.glyph(nudge.kind === "food" ? "food" : "drink"),
      "-u", "normal",
      "-t", "12000",
      title
    ]
    if (body) argv.push(body)
    Util.execArgv(argv)
  }

  function sendWindNotice(notice) {
    if (!notice || notice.kind !== "winddown") return
    var title = Model.plain(strings.t("notice.winddown.title"))
    var body = Model.plain(strings.t("notice.winddown.body")
      .arg(minuteClockAt(notice.sleepAt))
      .arg(durationPhrase(notice.untilMs)))
    var argv = [
      "omarchy-notification-send",
      "--app-name", "Cadence",
      "-g", Model.glyph("winddown"),
      "-u", "normal",
      "-t", "12000",
      title
    ]
    if (body) argv.push(body)
    Util.execArgv(argv)
  }

  function logDrink(note) {
    var ok = Model.log("drink", note, Date.now())
    if (ok) broadcast("refresh")
    return ok
  }

  function logFood(note) {
    var ok = Model.log("food", note, Date.now())
    if (ok) broadcast("refresh")
    return ok
  }

  function undoLast() {
    if (!Model.undo()) return false
    broadcast("refresh")
    return true
  }

  function canNudge(key, delta) {
    return Model.canNudge(key, delta)
  }

  function step(key) {
    return Model.step(key)
  }

  function nudge(key, delta) {
    if (!Model.canNudge(key, delta)) return
    var next = Model.setting(key) + delta
    if (key === "sleepStartMinutes" || key === "sleepEndMinutes") next = Model.wrapMinute(next)
    var patch = {}
    patch[key] = next
    commitSettings(patch)
  }

  function setSleepEnabled(on) {
    var patch = {}
    patch.sleepEnabled = on === true
    commitSettings(patch)
  }

  function acknowledgeWindDown() {
    if (!Model.acknowledgeWindDown(Date.now())) return false
    broadcast("refresh")
    return true
  }

  function goodNight() {
    if (!Model.goodNight(Date.now())) return false
    broadcast("refresh")
    return true
  }

  function stayUp() {
    if (!Model.stayUp(Date.now())) return false
    broadcast("refresh")
    return true
  }

  function open() {
    if (panelLoader.item) panelLoader.item.open()
  }

  function close() {
    if (panelLoader.item) panelLoader.item.close()
  }

  function togglePanel() {
    if (panelLoader.item) panelLoader.item.toggle()
  }

  function closeForPopoutSwitch() {
    if (panelLoader.item) panelLoader.item.closeForPopoutSwitch()
  }

  function injectPanel() {
    var target = panelLoader.item
    if (!target) return
    if ("bar" in target) target.bar = bar
    if ("settings" in target) target.settings = settings
    if ("anchorItem" in target) target.anchorItem = button
    if ("hostWidget" in target) target.hostWidget = root
  }

  onBarChanged: injectPanel()
  onSettingsChanged: {
    injectPanel()
    if (!Model.isHydrated()) return
    Model.applySettings(currentSettings())
    broadcast("refresh")
  }

  Component.onCompleted: {
    Model.hydrate(stateFile.text(), Date.now())
    Model.applySettings(currentSettings())
    refresh()
  }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  Commons.Translations {
    id: strings
    directory: Qt.resolvedUrl("i18n")
  }

  FileView {
    id: stateFile
    path: root.statePath
    watchChanges: false
    printErrors: false
    blockLoading: true
  }

  FileView {
    id: quietFile
    path: root.quietPath
    watchChanges: true
    printErrors: false
  }

  Timer {
    interval: 5000
    repeat: true
    running: true
    onTriggered: root.refresh()
  }

  Loader {
    id: panelLoader
    active: true
    source: Qt.resolvedUrl("Panel.qml")
    visible: false
    onLoaded: {
      root.injectPanel()
      Qt.callLater(root.injectPanel)
    }
  }

  ShellIpc {
    target: "giaodn.cadence"

    function open(): void { root.open() }
    function close(): void { root.close() }
    function show(): void { root.open() }
    function hide(): void { root.close() }
    function toggle(): void { root.togglePanel() }
    function logDrink(note: string): void { root.logDrink(note) }
    function logFood(note: string): void { root.logFood(note) }
    function undo(): void { root.undoLast() }
    function acknowledgeWindDown(): void { root.acknowledgeWindDown() }
    function goodNight(): void { root.goodNight() }
    function stayUp(): void { root.stayUp() }
  }

  WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: ""
    labelVisible: false
    hasVisualContent: true
    horizontalMargin: 8
    fixedWidth: root.vertical ? -1 : face.width + scaledHorizontalMargin * 2
    foreground: bar ? bar.barForeground : Commons.Color.foreground
    tooltipText: root.tooltip
    onPressed: function(mouseButton) {
      if (mouseButton === Qt.LeftButton) root.togglePanel()
    }

    Item {
      id: face
      anchors.centerIn: parent
      width: root.vertical ? solo.width : horizontalFace.width
      height: root.vertical ? solo.height : horizontalFace.height
      scale: button.pressScale
      transformOrigin: Item.Center

      OpticalGlyph {
        id: solo
        visible: root.vertical
        anchors.centerIn: parent
        width: Style.bar.iconCanvas
        height: Style.bar.iconCanvas
        text: Model.glyph(root.urgentKind)
        fontFamily: button.fontFamily
        fontSize: Style.bar.iconFont
        paintedSize: Style.bar.iconSize
        color: root.kindColor(root.urgentKind === "food" ? root.foodState : root.drinkState)
        Behavior on color { ColorAnimation { duration: Style.duration(160) } }
      }

      Item {
        id: horizontalFace
        visible: !root.vertical
        width: drinkGlyph.width + Style.space(4) + drinkTime.width
          + Style.space(10) + foodGlyph.width + Style.space(4) + foodTime.width
        height: Math.max(drinkGlyph.height, drinkTime.implicitHeight)

        OpticalGlyph {
          id: drinkGlyph
          anchors.verticalCenter: parent.verticalCenter
          anchors.left: parent.left
          width: Style.bar.iconCanvas
          height: Style.bar.iconCanvas
          text: Model.glyph("drink")
          fontFamily: button.fontFamily
          fontSize: Style.bar.iconFont
          paintedSize: Style.bar.iconSize
          color: root.kindColor(root.drinkState)
          Behavior on color { ColorAnimation { duration: Style.duration(160) } }
        }

        PlainText {
          id: drinkTime
          anchors.verticalCenter: parent.verticalCenter
          anchors.left: drinkGlyph.right
          anchors.leftMargin: Style.space(4)
          width: Math.max(implicitWidth, drinkSample.implicitWidth)
          text: root.formatFace(root.drinkState, root.drinkMs)
          color: root.kindColor(root.drinkState)
          font.family: button.fontFamily
          font.pixelSize: Style.font.body
          renderType: Text.NativeRendering
          Behavior on color { ColorAnimation { duration: Style.duration(160) } }
        }

        PlainText {
          id: drinkSample
          visible: false
          text: root.pad(88) + ":" + root.pad(88)
          font.family: drinkTime.font.family
          font.pixelSize: drinkTime.font.pixelSize
        }

        OpticalGlyph {
          id: foodGlyph
          anchors.verticalCenter: parent.verticalCenter
          anchors.left: drinkTime.right
          anchors.leftMargin: Style.space(10)
          width: Style.bar.iconCanvas
          height: Style.bar.iconCanvas
          text: Model.glyph("food")
          fontFamily: button.fontFamily
          fontSize: Style.bar.iconFont
          paintedSize: Style.bar.iconSize
          color: root.kindColor(root.foodState)
          Behavior on color { ColorAnimation { duration: Style.duration(160) } }
        }

        PlainText {
          id: foodTime
          anchors.verticalCenter: parent.verticalCenter
          anchors.left: foodGlyph.right
          anchors.leftMargin: Style.space(4)
          width: Math.max(implicitWidth, drinkSample.implicitWidth)
          text: root.formatFace(root.foodState, root.foodMs)
          color: root.kindColor(root.foodState)
          font.family: button.fontFamily
          font.pixelSize: Style.font.body
          renderType: Text.NativeRendering
          Behavior on color { ColorAnimation { duration: Style.duration(160) } }
        }
      }
    }
  }
}
