import QtQuick
import qs.Commons
import qs.Commons as Commons
import qs.Ui
import "Model.js" as Model

// Popup for the Cadence clocks. Logging what you had resets that clock.
Panel {
  id: root
  moduleName: "giaodn.cadence"
  manageIpc: false

  property var anchorItem: null
  property var hostWidget: null
  readonly property var host: hostWidget
  readonly property var barIdentity: hostWidget || root

  property int cursorRow: 0

  signal dismissEditors()

  readonly property color foreground: bar ? bar.foreground : Commons.Color.foreground
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family
  readonly property color dim: Qt.darker(foreground, 1.4)

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

  function intervalPhrase(minutes) {
    return durationPhrase((minutes || 0) * 60000)
  }

  function minuteClock(minutes) {
    var day = Model.wrapMinute(minutes)
    var when = new Date(2000, 0, 1, 0, 0, 0, 0)
    when.setMinutes(day)
    var locale = Qt.locale(Commons.I18n.formatLocale)
    return Model.plain(locale.toString(when, locale.timeFormat(Locale.ShortFormat)))
  }

  function sleepDescription() {
    if (!host) return ""
    var from = minuteClock(host.sleepStartMinutes)
    var until = minuteClock(host.sleepEndMinutes)
    if (host.sleepStartMinutes === host.sleepEndMinutes) return strings.t("panel.sleepEmpty")
    if (host.asleep) return strings.t("panel.sleepingNow").arg(until)
    if (host.windingDown && host.windDownSilenced)
      return strings.t("panel.windingQuiet").arg(from)
    if (host.windingDown)
      return strings.t("panel.windingNow").arg(from).arg(durationPhrase(host.windDownMs))
    return strings.t("panel.sleepHours").arg(from).arg(until)
  }

  function windDownValue() {
    var minutes = host ? host.windDownMinutes : 45
    if (!minutes) return strings.t("panel.windDownOff")
    return intervalPhrase(minutes)
  }

  function statusLine(kind) {
    var state = host ? (kind === "food" ? host.foodState : host.drinkState) : "unset"
    var ms = host ? (kind === "food" ? host.foodMs : host.drinkMs) : 0
    if (state === "unset") return strings.t("panel.nothing")
    var key = state === "overdue" ? "panel.overdue" : "panel.left"
    return strings.t(key).arg(durationPhrase(ms))
  }

  function statusColor(kind) {
    if (host && host.asleep) return dim
    var state = host ? (kind === "food" ? host.foodState : host.drinkState) : "unset"
    if (state === "overdue") return Commons.Color.accent
    if (state === "unset") return dim
    return foreground
  }

  function lastLine(kind) {
    var note = host ? (kind === "food" ? host.foodNote : host.drinkNote) : ""
    return Model.tooltipCopy(strings.t("panel.last"), note)
  }

  function fractionOf(kind) {
    if (!host) return 0
    return kind === "food" ? host.foodFraction : host.drinkFraction
  }

  function signalText(at, noneKey, nowKey, agoKey) {
    if (!(at > 0)) return strings.t(noneKey)
    var elapsed = (host ? host.now : 0) - at
    if (!isFinite(elapsed) || elapsed < 60000) return strings.t(nowKey)
    return strings.t(agoKey).arg(durationPhrase(elapsed))
  }

  function signalColor(at) {
    if (Model.signalFresh(at, host ? host.now : 0)) return dim
    return Commons.Color.accent
  }

  function nudgeLine(code) {
    var key = Model.nudgeKey(code)
    if (!key) return ""
    var titleKey = code === "sugary" ? "notice.nudge.drink.title" : "notice.nudge.food.title"
    return strings.t(titleKey) + " · " + strings.t(key)
  }

  function open() {
    cursorRow = 0
    dismissEditors()
    controller.show()
    Qt.callLater(function() {
      if (root.opened) setCenterHoverRevealSuppressed(true)
    })
  }

  function close() {
    dismissEditors()
    setCenterHoverRevealSuppressed(false)
    controller.hide()
  }

  function toggle() {
    if (opened) close()
    else open()
  }

  function switchPanel(direction) {
    if (bar && typeof bar.switchPanelFrom === "function")
      return bar.switchPanelFrom(barIdentity, direction)
    return false
  }

  function setCenterHoverRevealSuppressed(value) {
    if (bar && typeof bar.setCenterHoverRevealSuppressed === "function")
      bar.setCenterHoverRevealSuppressed(value)
    else if (bar && "centerHoverRevealSuppressed" in bar)
      bar.centerHoverRevealSuppressed = value
  }

  function moveCursor(dx, dy) {
    if (dy !== 0) {
      var next = cursorRow + dy
      if (next < 0) next = 0
      if (next > 11) next = 11
      cursorRow = next
      return
    }
    if (dx === 0 || !host || cursorRow < 3) return
    if (cursorRow === 3) {
      host.setSleepEnabled(dx > 0)
      return
    }
    var keys = [
      "",
      "",
      "",
      "",
      "sleepStartMinutes",
      "sleepEndMinutes",
      "windDownMinutes",
      "",
      "",
      "drinkMinutes",
      "foodMinutes",
      "remindAgainMinutes"
    ]
    var key = keys[cursorRow]
    if (!key) return
    host.nudge(key, dx > 0 ? host.step(key) : -host.step(key))
  }

  Commons.Translations {
    id: strings
    directory: Qt.resolvedUrl("i18n")
  }

  KeyboardPanel {
    id: panel
    anchorItem: root.anchorItem
    owner: root.barIdentity
    bar: root.bar
    open: root.opened
    centerOnBar: false
    focusTarget: panel.loadedContent
    contentWidth: panel.fittedContentWidth(Style.space(400))
    contentHeight: panel.fittedContentHeight(panel.loadedContentHeight)

    content: PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      implicitHeight: column.implicitHeight
      blocked: drinkRow.editing || foodRow.editing
      onMoveRequested: function(dx, dy) { root.moveCursor(dx, dy) }
      onActivateRequested: activateCursor()
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }

      function activateCursor() {
        if (root.cursorRow === 0) drinkRow.focusField()
        else if (root.cursorRow === 1) foodRow.focusField()
        else if (root.cursorRow === 2 && root.host && root.host.canUndo) root.host.undoLast()
        else if (root.cursorRow === 3 && root.host) root.host.setSleepEnabled(!root.host.sleepEnabled)
        else if (root.cursorRow === 7 && root.host && root.host.canAckWindDown) root.host.acknowledgeWindDown()
        else if (root.cursorRow === 8 && root.host) {
          if (root.host.earlySleep) root.host.stayUp()
          else root.host.goodNight()
        }
      }

      function finishLog(row, ok) {
        if (!ok) return
        row.clear()
        row.blur()
        keyCatcher.forceActiveFocus()
      }

      Connections {
        target: root
        function onDismissEditors() {
          drinkRow.blur()
          foodRow.blur()
        }
      }

      Flickable {
        id: scroller
        anchors.fill: parent
        contentWidth: width
        contentHeight: column.implicitHeight
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        interactive: contentHeight > height

        Column {
          id: column
          width: scroller.width
          spacing: Style.space(16)

          Column {
            width: parent.width
            spacing: Style.space(8)

            Item {
              width: parent.width
              implicitHeight: Math.max(drinkTitle.implicitHeight, drinkStatus.implicitHeight)

              PlainText {
                id: drinkTitle
                anchors.left: parent.left
                anchors.right: drinkStatus.left
                anchors.rightMargin: Style.space(8)
                anchors.verticalCenter: parent.verticalCenter
                text: strings.t("kind.drink")
                color: root.foreground
                font.family: root.fontFamily
                font.pixelSize: Style.font.body
                font.bold: true
                elide: Text.ElideRight
              }

              PlainText {
                id: drinkStatus
                anchors.right: parent.right
                anchors.verticalCenter: parent.verticalCenter
                text: root.statusLine("drink")
                color: root.statusColor("drink")
                font.family: root.fontFamily
                font.pixelSize: Style.font.caption
                Behavior on color { ColorAnimation { duration: Style.duration(160) } }
              }
            }

            Item {
              id: drinkTrack
              width: parent.width
              implicitHeight: Style.space(4)

              Rectangle {
                anchors.fill: parent
                radius: height / 2
                color: Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.12)
              }

              Rectangle {
                anchors.left: parent.left
                anchors.verticalCenter: parent.verticalCenter
                height: parent.height
                radius: height / 2
                width: Math.round(drinkTrack.width * root.fractionOf("drink"))
                color: root.statusColor("drink")
                Behavior on width { NumberAnimation { duration: Style.duration(180); easing.type: Easing.OutCubic } }
                Behavior on color { ColorAnimation { duration: Style.duration(160) } }
              }
            }

            PlainText {
              width: parent.width
              visible: root.host && root.host.drinkState !== "unset"
              text: root.lastLine("drink")
              color: root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              elide: Text.ElideRight
            }

            LogRow {
              id: drinkRow
              placeholder: strings.t("panel.promptDrink")
              logText: strings.t("panel.log")
              selected: root.cursorRow === 0
              foreground: root.foreground
              fontFamily: root.fontFamily
              onPicked: root.cursorRow = 0
              onCancelled: keyCatcher.forceActiveFocus()
              onSubmit: function(text) {
                root.cursorRow = 0
                keyCatcher.finishLog(drinkRow, root.host && root.host.logDrink(text))
              }
            }

            PlainText {
              width: parent.width
              visible: root.host && root.host.drinkNudge !== ""
              wrapMode: Text.WordWrap
              text: root.nudgeLine(root.host ? root.host.drinkNudge : "")
              color: Commons.Color.accent
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
            }
          }

          Column {
            width: parent.width
            spacing: Style.space(8)

            Item {
              width: parent.width
              implicitHeight: Math.max(foodTitle.implicitHeight, foodStatus.implicitHeight)

              PlainText {
                id: foodTitle
                anchors.left: parent.left
                anchors.right: foodStatus.left
                anchors.rightMargin: Style.space(8)
                anchors.verticalCenter: parent.verticalCenter
                text: strings.t("kind.food")
                color: root.foreground
                font.family: root.fontFamily
                font.pixelSize: Style.font.body
                font.bold: true
                elide: Text.ElideRight
              }

              PlainText {
                id: foodStatus
                anchors.right: parent.right
                anchors.verticalCenter: parent.verticalCenter
                text: root.statusLine("food")
                color: root.statusColor("food")
                font.family: root.fontFamily
                font.pixelSize: Style.font.caption
                Behavior on color { ColorAnimation { duration: Style.duration(160) } }
              }
            }

            Item {
              id: foodTrack
              width: parent.width
              implicitHeight: Style.space(4)

              Rectangle {
                anchors.fill: parent
                radius: height / 2
                color: Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.12)
              }

              Rectangle {
                anchors.left: parent.left
                anchors.verticalCenter: parent.verticalCenter
                height: parent.height
                radius: height / 2
                width: Math.round(foodTrack.width * root.fractionOf("food"))
                color: root.statusColor("food")
                Behavior on width { NumberAnimation { duration: Style.duration(180); easing.type: Easing.OutCubic } }
                Behavior on color { ColorAnimation { duration: Style.duration(160) } }
              }
            }

            PlainText {
              width: parent.width
              visible: root.host && root.host.foodState !== "unset"
              text: root.lastLine("food")
              color: root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              elide: Text.ElideRight
            }

            LogRow {
              id: foodRow
              placeholder: strings.t("panel.promptFood")
              logText: strings.t("panel.log")
              selected: root.cursorRow === 1
              foreground: root.foreground
              fontFamily: root.fontFamily
              onPicked: root.cursorRow = 1
              onCancelled: keyCatcher.forceActiveFocus()
              onSubmit: function(text) {
                root.cursorRow = 1
                keyCatcher.finishLog(foodRow, root.host && root.host.logFood(text))
              }
            }

            Column {
              width: parent.width
              spacing: Style.space(4)
              visible: root.host && root.host.hasPlate

              PlainText {
                width: parent.width
                text: root.signalText(root.host ? root.host.proteinAt : 0, "plate.proteinNone", "plate.proteinNow", "plate.proteinAgo")
                color: root.signalColor(root.host ? root.host.proteinAt : 0)
                font.family: root.fontFamily
                font.pixelSize: Style.font.caption
                elide: Text.ElideRight
                Behavior on color { ColorAnimation { duration: Style.duration(160) } }
              }

              PlainText {
                width: parent.width
                text: root.signalText(root.host ? root.host.vegetableAt : 0, "plate.vegetableNone", "plate.vegetableNow", "plate.vegetableAgo")
                color: root.signalColor(root.host ? root.host.vegetableAt : 0)
                font.family: root.fontFamily
                font.pixelSize: Style.font.caption
                elide: Text.ElideRight
                Behavior on color { ColorAnimation { duration: Style.duration(160) } }
              }
            }

            PlainText {
              width: parent.width
              visible: root.host && root.host.foodNudge !== ""
              wrapMode: Text.WordWrap
              text: root.nudgeLine(root.host ? root.host.foodNudge : "")
              color: Commons.Color.accent
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
            }
          }

          Button {
            width: parent.width
            text: strings.t("panel.undo")
            foreground: root.foreground
            fontFamily: root.fontFamily
            enabled: root.host ? root.host.canUndo : false
            opacity: enabled ? 1 : 0.45
            hasCursor: root.cursorRow === 2
            onClicked: {
              root.cursorRow = 2
              if (root.host) root.host.undoLast()
            }
          }

          PanelSeparator { foreground: root.foreground }

          Column {
            width: parent.width
            spacing: Style.space(4)

            PanelSectionHeader {
              text: strings.t("panel.reminders")
              foreground: root.foreground
              fontFamily: root.fontFamily
            }

            Toggle {
              width: parent.width
              label: strings.t("panel.sleep")
              description: root.sleepDescription()
              checked: root.host ? root.host.sleepEnabled : false
              foreground: root.foreground
              fontFamily: root.fontFamily
              titleSize: Style.font.body
              hasCursor: root.cursorRow === 3
              onClicked: {
                root.cursorRow = 3
                if (root.host) root.host.setSleepEnabled(!root.host.sleepEnabled)
              }
            }

            LengthRow {
              title: strings.t("panel.sleepFrom")
              valueText: root.minuteClock(root.host ? root.host.sleepStartMinutes : 23 * 60)
              selected: root.cursorRow === 4
              canDecrease: root.host ? root.host.canNudge("sleepStartMinutes", -root.host.step("sleepStartMinutes")) : false
              canIncrease: root.host ? root.host.canNudge("sleepStartMinutes", root.host.step("sleepStartMinutes")) : false
              foreground: root.foreground
              fontFamily: root.fontFamily
              onPicked: root.cursorRow = 4
              onDecrease: { if (root.host) root.host.nudge("sleepStartMinutes", -root.host.step("sleepStartMinutes")) }
              onIncrease: { if (root.host) root.host.nudge("sleepStartMinutes", root.host.step("sleepStartMinutes")) }
            }

            LengthRow {
              title: strings.t("panel.sleepUntil")
              valueText: root.minuteClock(root.host ? root.host.sleepEndMinutes : 7 * 60)
              selected: root.cursorRow === 5
              canDecrease: root.host ? root.host.canNudge("sleepEndMinutes", -root.host.step("sleepEndMinutes")) : false
              canIncrease: root.host ? root.host.canNudge("sleepEndMinutes", root.host.step("sleepEndMinutes")) : false
              foreground: root.foreground
              fontFamily: root.fontFamily
              onPicked: root.cursorRow = 5
              onDecrease: { if (root.host) root.host.nudge("sleepEndMinutes", -root.host.step("sleepEndMinutes")) }
              onIncrease: { if (root.host) root.host.nudge("sleepEndMinutes", root.host.step("sleepEndMinutes")) }
            }

            LengthRow {
              title: strings.t("panel.windDown")
              valueText: root.windDownValue()
              selected: root.cursorRow === 6
              canDecrease: root.host ? root.host.canNudge("windDownMinutes", -root.host.step("windDownMinutes")) : false
              canIncrease: root.host ? root.host.canNudge("windDownMinutes", root.host.step("windDownMinutes")) : false
              foreground: root.foreground
              fontFamily: root.fontFamily
              onPicked: root.cursorRow = 6
              onDecrease: { if (root.host) root.host.nudge("windDownMinutes", -root.host.step("windDownMinutes")) }
              onIncrease: { if (root.host) root.host.nudge("windDownMinutes", root.host.step("windDownMinutes")) }
            }

            Button {
              width: parent.width
              text: strings.t("panel.ack")
              foreground: root.foreground
              fontFamily: root.fontFamily
              enabled: root.host ? root.host.canAckWindDown : false
              opacity: enabled ? 1 : 0.45
              hasCursor: root.cursorRow === 7
              onClicked: {
                root.cursorRow = 7
                if (root.host) root.host.acknowledgeWindDown()
              }
            }

            Button {
              width: parent.width
              text: root.host && root.host.earlySleep ? strings.t("panel.stayUp") : strings.t("panel.goodNight")
              foreground: root.foreground
              fontFamily: root.fontFamily
              enabled: root.host ? (root.host.earlySleep ? root.host.canStayUp : root.host.canGoodNight) : false
              opacity: enabled ? 1 : 0.45
              hasCursor: root.cursorRow === 8
              onClicked: {
                root.cursorRow = 8
                if (!root.host) return
                if (root.host.earlySleep) root.host.stayUp()
                else root.host.goodNight()
              }
            }

            LengthRow {
              title: strings.t("panel.drinkEvery")
              valueText: root.intervalPhrase(root.host ? root.host.drinkMinutes : 120)
              selected: root.cursorRow === 9
              canDecrease: root.host ? root.host.canNudge("drinkMinutes", -root.host.step("drinkMinutes")) : false
              canIncrease: root.host ? root.host.canNudge("drinkMinutes", root.host.step("drinkMinutes")) : false
              foreground: root.foreground
              fontFamily: root.fontFamily
              onPicked: root.cursorRow = 9
              onDecrease: { if (root.host) root.host.nudge("drinkMinutes", -root.host.step("drinkMinutes")) }
              onIncrease: { if (root.host) root.host.nudge("drinkMinutes", root.host.step("drinkMinutes")) }
            }

            LengthRow {
              title: strings.t("panel.foodEvery")
              valueText: root.intervalPhrase(root.host ? root.host.foodMinutes : 240)
              selected: root.cursorRow === 10
              canDecrease: root.host ? root.host.canNudge("foodMinutes", -root.host.step("foodMinutes")) : false
              canIncrease: root.host ? root.host.canNudge("foodMinutes", root.host.step("foodMinutes")) : false
              foreground: root.foreground
              fontFamily: root.fontFamily
              onPicked: root.cursorRow = 10
              onDecrease: { if (root.host) root.host.nudge("foodMinutes", -root.host.step("foodMinutes")) }
              onIncrease: { if (root.host) root.host.nudge("foodMinutes", root.host.step("foodMinutes")) }
            }

            LengthRow {
              title: strings.t("panel.again")
              valueText: root.intervalPhrase(root.host ? root.host.remindAgainMinutes : 30)
              selected: root.cursorRow === 11
              canDecrease: root.host ? root.host.canNudge("remindAgainMinutes", -root.host.step("remindAgainMinutes")) : false
              canIncrease: root.host ? root.host.canNudge("remindAgainMinutes", root.host.step("remindAgainMinutes")) : false
              foreground: root.foreground
              fontFamily: root.fontFamily
              onPicked: root.cursorRow = 11
              onDecrease: { if (root.host) root.host.nudge("remindAgainMinutes", -root.host.step("remindAgainMinutes")) }
              onIncrease: { if (root.host) root.host.nudge("remindAgainMinutes", root.host.step("remindAgainMinutes")) }
            }
          }
        }
      }
    }
  }
}
