# Cadence

Drink and food reminders for the Omarchy bar. Log what you had and that clock starts over. Cadence keeps the words and the time. It does not count calories.

When a clock reaches its interval, the bar shows how long it has been overdue, a notification names the last thing you logged, and a diner bell rings twice. The reminder repeats until you log the next drink or meal. Do Not Disturb hides the notification and keeps the bell quiet.

A drink defaults to every 2 hours, food to every 4 hours, and the repeat to every 30 minutes. Change those from the panel.

## Install

```bash
omarchy plugin add https://github.com/noconelikesnowcone/cadence.git --enable
```

The manifest places it at the center end of the bar, beside the clock. Move it later with:

```bash
omarchy bar move giaodn.cadence --section right
```

Sections: `left`, `centerBegin`, `centerEnd`, `tray`, `right`.

Update an installed copy with:

```bash
omarchy plugin update giaodn.cadence
```
