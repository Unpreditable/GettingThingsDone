# Custom… always shows (TODO #41)

## Why

The row menu's and the drop menu's Custom… item used to show only when Kalendae could open its
calendar, so a reader without Kalendae never learned the item exists. Custom… now always shows,
and a click that Kalendae cannot serve leads the reader to fixing that.

## Decided

- Kalendae 1.7.0, the first release whose `pickDate` honours `allowed`, is the minimum for both
  menus, so every Custom… click behaves the same.
- Custom… shows in the row menu always, and in the drop menu whenever the bucket offers it
  (`offersCustom`, unchanged).

| Kalendae | Custom… opens |
|---|---|
| Not installed | Install popup → `obsidian://show-plugin?id=kalendae` |
| Older than 1.7.0, on or off | Update popup → the same page, which also offers Enable |
| 1.7.0 or later, off | Enable popup → `enablePluginAndSave`, then the calendar for this click |
| 1.7.0 or later, on, no API | Notice: Kalendae didn't load |
| 1.7.0 or later, on | The calendar |

- Every popup has Cancel. For a drop, Cancel or leaving for the plugin page counts as no day
  picked, as closing the calendar does.

## Approaches

- **Read the version** from the loaded plugin's manifest, else `app.plugins.manifests` (present
  even while Kalendae is off). Chosen.
- **Probe for `pickDate`**: cannot tell whether `allowed` is honoured, so cannot enforce 1.7.0.

## Left to the builder

- `src/integrations/Kalendae.ts` returns the state above; unit-tested.
- The popup is a small Obsidian `Modal`.
- The drop menu's "day outside the bucket" notice stays as a safety net.
- New strings in `en.json` only.
