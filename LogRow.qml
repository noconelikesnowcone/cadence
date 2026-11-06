import QtQuick
import QtQuick.Layouts
import qs.Commons
import qs.Ui

// What was eaten or drunk. The note is a label for the clock reset, not a measure.
Item {
  id: root

  property string placeholder: ""
  property string logText: ""
  property bool selected: false
  property color foreground: Commons.Color.foreground
  property string fontFamily: Style.font.family

  signal submit(string text)
  signal picked()
  signal cancelled()

  readonly property bool editing: field.activeFocus

  function focusField() { field.forceActiveFocus() }
  function blur() { field.focus = false }
  function clear() { field.text = "" }

  implicitHeight: row.implicitHeight
  width: parent ? parent.width : implicitWidth

  function commit() {
    root.submit(field.text)
  }

  RowLayout {
    id: row
    anchors.left: parent.left
    anchors.right: parent.right
    height: implicitHeight
    spacing: Style.spacing.controlGap

    TextField {
      id: field
      Layout.fillWidth: true
      Layout.alignment: Qt.AlignVCenter
      placeholderText: root.placeholder
      foreground: root.foreground
      font.family: root.fontFamily
      hasCursor: root.selected && !activeFocus
      selectByMouse: true
      maximumLength: 80
      onActiveFocusChanged: {
        if (activeFocus) root.picked()
      }
      onAccepted: root.commit()
      Keys.onEscapePressed: function(event) {
        field.focus = false
        root.cancelled()
        event.accepted = true
      }
    }

    Button {
      Layout.alignment: Qt.AlignVCenter
      Layout.preferredWidth: implicitWidth
      text: root.logText
      foreground: root.foreground
      fontFamily: root.fontFamily
      onClicked: {
        root.picked()
        root.commit()
      }
    }
  }
}
