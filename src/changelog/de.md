## Unreleased

#### Neu
- Sehen, was du geschafft hast: Klicke in der Seitenleiste auf 🏆, um die heute, gestern, diese oder letzte Woche erledigten Aufgaben zu sehen, mit einem Diagramm über 10 Wochen.
- Fälligkeits- und geplantes Datum einer Aufgabe lassen sich über ihr Kontextmenü ändern.
- Ein Befehl **Aufgabe erledigt umschalten**, neben denen für „in Bearbeitung“ und „abgebrochen“.
- Aufgaben, die noch nicht beginnen können oder auf eine andere Aufgabe warten, werden abgeblendet.
- Liest die Felder von Tasks im Dataview-Format.

## 0.2.7

- Keine Änderungen. 0.2.6 wurde neu veröffentlicht, um ein Problem in Obsidians Veröffentlichungsprüfung zu umgehen.

## 0.2.6

#### Neu
- **Globaler Aufgabenfilter**: Ein Kontrollkästchen zählt nur als Aufgabe, wenn es einen der angegebenen Texte enthält, wie im Tasks-Plugin. Optionen schließen Unteraufgaben ein und blenden den Filtertext im Panel aus.
- **In Bearbeitung und abgebrochen**: Editor-Befehle und Kontextmenüeinträge markieren eine Aufgabe als in Bearbeitung oder abgebrochen. Erneutes Ausführen setzt sie wieder auf offen.

#### Behoben
- Aufgaben aus Notizen mit Windows-Zeilenenden fehlten im Panel.
- „Abbrechen“ im Bearbeitungsdialog von Tasks löschte die Zeile der Aufgabe.
- „Zu überprüfen“ verlor eine gerade abgehakte Aufgabe, und ausgeblendete Aufgaben kehrten zurück.
- Die Suche ließ eine Kategorie stehen, obwohl alle Treffer darin ausgeblendet waren.

## 0.2.5

#### Neu
- **Links aus dem Panel öffnen**: Klicke auf einen Link in einer Aufgabe, um ihn zu öffnen.

#### Behoben
- #Überschriften in Wikilinks und #Fragmente in URLs fehlten im Aufgabentext im Panel.

## 0.2.4

#### Neu
- **Aufgabe bearbeiten**: Öffne eine Aufgabe über das Kontextmenü im Bearbeitungsdialog des Tasks-Plugins.
- **Zur Aufgabe springen**: Beim Öffnen einer Aufgabe wird ihre Zeile zentriert, der Cursor daraufgesetzt und die Zeile kurz hervorgehoben.
- Jeder Kontextmenüeintrag hat ein Symbol, wenn native Menüs unter Einstellungen → Darstellung ausgeschaltet sind.

## 0.2.3

#### Neu
- **Mehr Kontrollkästchen-Status**: In Bearbeitung `[/]`, weitergeleitet `[>]` und geplant `[<]` erscheinen als offene Aufgaben, abgebrochen `[-]` zählt als erledigt.
- Das Panel zeigt die Symbole deines Themes für diese Status.

## 0.2.2

#### Neu
- **Erster Tag der Woche**: Wähle ihn in den Einstellungen, und „Diese Woche“ und „Nächste Woche“ richten sich danach.
- **Ausnahmen beim Durchsuchen des ganzen Vaults**: Überspringe ausgewählte Ordner und Dateien. Die Ordner- und Dateilisten sind zu einer zusammengefasst.

#### Behoben
- Eigene Einstellungsabschnitte in Obsidian 1.13 und neuer werden wieder richtig angezeigt. Der Abschnitt „Getting Things Done“ heißt jetzt „Allgemein“.
- Einer Unteraufgabe, deren übergeordnete Aufgabe nicht sichtbar ist, fehlte das ↖︎-Abzeichen. Der Tooltip nennt jetzt die übergeordnete Aufgabe.

## 0.2.1

#### Neu
- **Aufgabendatum**: Ordne Aufgaben nach Fälligkeitsdatum, geplantem Datum, dem früheren von beiden oder keinem zu.
- **Nach Datum sortierte Kategorien**: Aufgaben werden innerhalb einer Kategorie nach Datum sortiert, Aufgaben ohne Datum zuletzt. Eine per Drag & Drop geordnete Kategorie behält deine Reihenfolge.
- **Anheften und lösen**: Hefte eine Aufgabe an eine Kategorie an oder löse sie, damit sie wieder ihren Daten folgt.
- Getrennte Markierungen für „überfällig“ und „falsch einsortiert“, im Popover erklärt.
- **Regel „Alles (Auffangregel)“**: Erfasst jede datierte Aufgabe, die keine Kategorie darüber genommen hat. „Irgendwann / Vielleicht“ hat sie standardmäßig.
- Symbole folgen Obsidian und deinem Theme.

#### Behoben
- Notizen, die nach dem Start von Obsidian hinzukamen, erschienen erst nach einem Neustart.

## 0.2.0

#### Neu
- **Dauerhafte Reihenfolge**: Deine Drag-&-Drop-Reihenfolge übersteht Dateiänderungen, Umbenennungen, Ordnerverschiebungen und Neustarts.
- **Erledigen über das Tasks-Plugin**: Wiederkehrende Aufgaben bekommen ihr nächstes Vorkommen, und ✅-Daten folgen den Regeln von Tasks.
- Erledigte Aufgaben bleiben im Panel, bis du neu lädst.
- **Felder des Tasks-Plugins**: Priorität, Wiederholung, Daten und Aktionen bei Erledigung erscheinen als Abzeichen und im Hover-Popover, mit Einstellungen, welche angezeigt werden.
- **Markierungen für „überfällig“ und „falsch einsortiert“** und eine Fälligkeitszeile im Popover.
- Ein Symbol in der Seitenleiste öffnet das Panel.

#### Behoben
- Eine gezogene Aufgabe landete an der falschen Stelle in einer anderen Kategorie, und Unteraufgaben lösten sich von ihrer übergeordneten Aufgabe.
- Beim Neuladen oder Aktualisieren öffnete sich ein zweites Panel, und Kategorien wechselten um Mitternacht nicht.
- Metadaten des Tasks-Plugins gerieten in den Aufgabentext, und Tooltips erschienen beim Ziehen.
- Das Plugin fragt nach, bevor es den GitHub-Link für Feedback öffnet.

## 0.1.9

#### Neu
- Jeder Suchbereich (ganzer Vault, Ordner, Dateien) merkt sich seine eigene Liste.
- Ein Hinweis, wenn keine Ordner oder Dateien zum Durchsuchen ausgewählt sind.
- Die Verhaltenseinstellungen erscheinen in Obsidians Einstellungssuche (Obsidian 1.13 und neuer).
- Ein Dankesbanner in den Einstellungen mit einem Link für Feedback und Ideen.

#### Behoben
- Blockverweise (^abc123) gingen verloren, wenn die Kategorie einer Aufgabe geschrieben wurde.
- Veraltete Aufgaben nach einer Änderung des Suchbereichs, und das Feierbild erschien manchmal nicht.
- Der Hinweis zur Sprachänderung erschien bei der Erstinstallation.

## 0.1.8

#### Behoben
- Bei einer Aufgabe in einer Notiz, die weiter oben bearbeitet wurde, öffnete sich die falsche Zeile.

## 0.1.7

#### Neu
- **12 Sprachen**, passend zur Sprache von Obsidian.
- Beim Öffnen einer Aufgabe wird der bereits offene Tab ihrer Notiz verwendet.
- Der Aufgabentext füllt die ganze Zeile; Schnellverschiebe-Schaltflächen erscheinen beim Darüberfahren.

## 0.1.6

#### Neu
- Beim Darüberfahren über eine Aufgabe werden ihre Notiz und Zeilennummer angezeigt.

## 0.1.5

#### Neu
- **Suche**: Filtere das Panel während der Eingabe.
- Release-Builds sind signiert, sodass du prüfen kannst, dass sie aus dem offiziellen Quellcode stammen.

## 0.1.4

#### Behoben
- Aufgaben unter einfachen Aufzählungspunkten erschienen als Unteraufgaben einer fremden Aufgabe.

## 0.1.3

#### Neu
- Der Aufgabentext zeigt Fett, Kursiv, Durchgestrichen, Code, Hervorhebungen und Links wie in deinen Notizen.

## 0.1.2

#### Neu
- Erledigte Aufgaben haben eine Schaltfläche zum Ausblenden, und **Alle ausblenden** in der Kopfzeile entfernt sie auf einmal.

## 0.1.1

#### Neu
- Wikilinks im Aufgabentext werden im Panel dargestellt.
- Die Zähler in der Statusleiste sind anklickbar.

#### Behoben
- Tooltips bei erledigten Aufgaben, und Verschiebungen, die an veralteten Aufgabendaten scheiterten.

## 0.1.0

#### Neu
- Das GTD-Panel: Aufgaben aus deinem Vault, gruppiert in Heute, Diese Woche, Irgendwann und mehr.
- Aufgaben mit einem Klick oder per Drag & Drop verschieben.
- Unteraufgaben folgen ihrer übergeordneten Aufgabe.
- Aktuelle Aufgabenzähler pro Kategorie in der Statusleiste.
- Feieranimationen, wenn du eine Aufgabe erledigst.
- Eine kompakte Ansicht.
- Die Kategorie wird als Inline-Tag (#gtd/today) oder als Dataview-Inline-Feld gespeichert.
