import QtQuick
import QtQuick.Layouts
import qs.Commons
import qs.Ui

// One interval: a label, the current value, and a step down / step up pair.
Item {
  id: root

  property string title: ""
  property string valueText: ""
  property bool selected: false
  property bool canDecrease: false
  property bool canIncrease: false
  property color foreground: Commons.Color.foreground
  property string fontFamily: Style.font.family

  signal picked()
  signal decrease()
  signal increase()

  width: parent ? parent.width : implicitWidth
  implicitHeight: Math.max(Style.spacing.popupRowHeight, valueLabel.implicitHeight + Style.space(8))

  Rectangle {
    anchors.fill: parent
    radius: Style.cornerRadius
    color: root.selected ? Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.08) : "transparent"
    Behavior on color { ColorAnimation { duration: Style.duration(120) } }
  }

  MouseArea {
    anchors.fill: parent
    onClicked: root.picked()
  }

  PlainText {
    anchors.left: parent.left
    anchors.leftMargin: Style.space(8)
    anchors.right: controls.left
    anchors.rightMargin: Style.space(8)
    anchors.verticalCenter: parent.verticalCenter
    text: root.title
    color: root.foreground
    font.family: root.fontFamily
    font.pixelSize: Style.font.body
    elide: Text.ElideRight
  }

  RowLayout {
    id: controls
    anchors.right: parent.right
    anchors.rightMargin: Style.space(4)
    anchors.verticalCenter: parent.verticalCenter
    width: implicitWidth
    height: implicitHeight
    spacing: Style.space(2)

    PanelActionButton {
      iconText: "−"
      enabled: root.canDecrease
      foreground: root.foreground
      fontFamily: root.fontFamily
      hasCursor: root.selected
      onClicked: root.decrease()
    }

    PlainText {
      id: valueLabel
      Layout.alignment: Qt.AlignVCenter
      Layout.preferredWidth: Math.max(Style.space(112), implicitWidth)
      horizontalAlignment: Text.AlignHCenter
      text: root.valueText
      color: root.foreground
      font.family: root.fontFamily
      font.pixelSize: Style.font.body
    }

    PanelActionButton {
      iconText: "+"
      enabled: root.canIncrease
      foreground: root.foreground
      fontFamily: root.fontFamily
      hasCursor: root.selected
      onClicked: root.increase()
    }
  }
}
