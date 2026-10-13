# Nanoleaf

Steuere deine **Nanoleaf**-Lichtpanels aus Gladys Assistant, **im lokalen
Netzwerk**, über die Nanoleaf-OpenAPI: Ein/Aus, Helligkeit, Farbe,
Farbtemperatur, Effekte und die **Touch-Gesten** der Panels als
Szenen-Auslöser. Keine Cloud, kein Konto.

> **Ohne die Hardware entwickelt: Rückmeldungen willkommen.** Die Integration
> wurde mit den von Nanoleaf dokumentierten Antworten gebaut und getestet,
> nicht mit echten Panels. Melde, was funktioniert und was nicht, in den
> [Issues](https://github.com/guim31/gladys-nanoleaf/issues) (Developed
> without the hardware: feedback welcome).

Diese Integration steht in keiner Verbindung zu Nanoleaf.

## Voraussetzungen

- Gladys Assistant **5.1.0** oder neuer.
- Panels mit einem WLAN-Controller, der die Nanoleaf-OpenAPI spricht: **Light
  Panels** (Aurora), **Canvas**, **Shapes** (Sechsecke, Dreiecke,
  Mini-Dreiecke), **Elements** und **Lines**, im selben Netzwerk wie Gladys.
- Die Panels zuerst in der Nanoleaf-App eingerichtet (WLAN).
- **Nanoleaf Essentials**-Lampen und -Streifen (Matter / Thread) sprechen die
  OpenAPI nicht: Füge sie über Matter zu Gladys hinzu.

## Installation und Kopplung

1. Öffne in Gladys **Integrationen** → **Von GitHub installieren** und gib
   `https://github.com/guim31/gladys-nanoleaf` ein (oder installiere
   **Nanoleaf** aus dem Katalog, sobald es dort steht).
2. Öffne den Tab **Konfiguration** der Integration. Panels im selben Netzwerk
   wie Gladys werden automatisch gefunden (mDNS, und SSDP für die alten Light
   Panels). Werden deine nicht gefunden, gib ihre IP-Adresse unter
   **IP-Adressen der Nanoleaf-Controller** ein (mehrere Adressen: durch Kommas
   getrennt).
3. Halte an den Panels **die Ein-/Aus-Taste 5 bis 7 Sekunden gedrückt**, bis
   die Lichter blinken, und klicke dann **innerhalb von 30 Sekunden** im Tab
   Konfiguration auf **Koppeln**. Die Meldung unter der Schaltfläche nennt die
   gekoppelten Panels. Um nur eine Adresse zu koppeln, gib sie in das Feld
   **IP-Adresse (optional)** der Schaltfläche ein.
4. Öffne den Tab **Entdecken** und füge das Gerät hinzu.

**Sprache der Gerätenamen**: die Sprache der Funktionsnamen neuer Geräte
(standardmäßig Französisch). Gladys behält die Namen, die beim Hinzufügen
vergeben wurden.

Das Kopplungstoken liegt im Volume `/data` der Integration, nie in der
Konfiguration oder in den Protokollen.

## Das Gerät

Ein Gerät pro Controller (ein Satz Panels), mit diesen Funktionen:

| Funktion           | Was sie macht                                                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------------- |
| **Licht**          | Ein / Aus.                                                                                               |
| **Helligkeit**     | 0 bis 100 %. 0 schaltet die Panels aus.                                                                  |
| **Farbe**          | Jede Farbe (Farbton und Sättigung). Nicht bei Elements, die nur Weiß zeigen.                             |
| **Farbtemperatur** | Das Weiß, in Kelvin, im Bereich des Controllers (bei den meisten 1200-6500 K).                           |
| **Effekt**         | Die Effekte **dieses** Controllers, wie in der Nanoleaf-App. **Keiner**: zurück zur Farbe oder zum Weiß. |
| **Verbunden**      | Nur lesen: Der Controller antwortet. Ohne Strom werden die Panels auch als aus angezeigt.                |

Eine Helligkeit, eine Farbe oder ein Weiß schaltet die Panels auch ein, wie
bei den anderen Gladys-Lampen. Eine Änderung in der Nanoleaf-App, über die
Tasten oder durch einen Nanoleaf-Zeitplan erscheint in Gladys innerhalb einer
Sekunde. Ein neuer, in der App erstellter Effekt kommt innerhalb einer Minute
in die Liste **Effekt**.

## Widget

Füge das Widget **Nanoleaf** zu einem Dashboard hinzu und wähle die Panels in
seinen Einstellungen. Es zeigt:

- die Helligkeit, live;
- **Licht** (ein oder aus), **Effekt** (der laufende Effekt, die Farbe oder
  das Weiß) und bei Touch-Panels **Letzte Geste** mit der Panel-Nummer;
- bis zu vier **Lieblingseffekte** als Schaltflächen (der laufende trägt
  einen Haken). Gib ihre Namen unter **Lieblingseffekte** ein, durch Kommas
  getrennt; leer werden die ersten drei Effekte der Liste gezeigt;
- mit drei oder weniger Favoriten eine Schaltfläche **Einschalten** /
  **Ausschalten**.

## Szenen-Auslöser

**Geste auf einem Nanoleaf**: ein Tippen oder Wischen auf Touch-Panels
(Canvas, Shapes, Elements). Filter, alle optional:

- **Nanoleaf**: die Panels; leer für alle;
- **Geste**: **Einfaches Tippen**, **Doppeltippen**, **Nach oben wischen**,
  **Nach unten wischen**, **Nach links wischen**, **Nach rechts wischen**;
  leer für alle Gesten;
- **Panel-Nummer**: nur für Tippen (Wischen gilt für die ganze Anordnung).
  Tippe auf das Panel und lies seine Nummer in der Zeile **Letzte Geste** des
  Widgets ab. Die Nummern vergibt der Controller, und sie ändern sich, wenn die
  Panels neu angeordnet werden.

Die Szene kann die Geste (`single_tap`, `double_tap`, `swipe_up`…) und die
Panel-Nummer als Variablen verwenden.

## Szenen-Aktionen

- **Nanoleaf-Effekt starten**: ein Effekt über seinen Namen, wie in der
  Nanoleaf-App geschrieben (Groß- und Kleinschreibung egal), mit optionaler
  Helligkeit. Der Name des gestarteten Effekts steht den folgenden Aktionen
  zur Verfügung. Ein unbekannter Name lässt die Aktion scheitern und listet
  die Effekte auf.
- **Farbe auf einem Nanoleaf zeigen**: eine Farbe aus der Liste oder
  **Andere Farbe** im Format `#RRGGBB`, für eine Anzahl Sekunden (1 bis 3600),
  mit optionaler Helligkeit; danach zeigen die Panels wieder, was sie vorher
  zeigten (Effekt, Farbe oder Weiß, Helligkeit, ein oder aus). Ein Befehl an
  die Panels in der Zwischenzeit bricht die Rückkehr ab. Nicht bei Elements.

Ein, Aus, Helligkeit, Farbe, Weiß und die Effektliste gibt es auch als die
üblichen Geräte-Aktionen von Gladys.

## Schaltflächen der Konfiguration

- **Koppeln**: siehe _Installation und Kopplung_.
- **Nanoleaf-Controller suchen**: sucht erneut und listet die gekoppelten
  Controller (erreichbar oder nicht) und die noch zu koppelnden auf.

## Szenen-Beispiele

- **Doppeltippen schaltet das Wohnzimmer aus**: Auslöser _Geste auf einem
  Nanoleaf_, Geste _Doppeltippen_; Aktion: Wohnzimmerlichter ausschalten.
- **Ein Panel als Türklingel-Licht**: Wenn es klingelt, _Farbe auf einem
  Nanoleaf zeigen_, Blau, 20 Sekunden, Helligkeit 100 %.
- **Wischen für die Abendstimmung**: _Geste auf einem Nanoleaf_, Geste _Nach
  unten wischen_; Aktionen: _Nanoleaf-Effekt starten_ „Northern Lights“ mit
  30 %, und die anderen Lichter dimmen.
- **Sonnenuntergang**: bei Sonnenuntergang _Nanoleaf-Effekt starten_
  „Sundown“.

## Aktualisierung und Netzwerknutzung

- Jeder Controller hält **eine offene Verbindung** zum Ereignisstrom der
  Integration (`/events` der Nanoleaf-OpenAPI): Änderungen und Gesten kommen
  sofort an.
- Jeder Controller wird außerdem **einmal pro Minute gelesen** (einige
  Kilobyte), um der Effektliste zu folgen und einen verschwundenen Controller
  zu bemerken.
- Das Netzwerk wird **alle 15 Minuten durchsucht** (über Gladys), um einer
  geänderten Adresse zu folgen.
- Alles bleibt im lokalen Netzwerk: Port 16021 der Controller, keine Cloud.
  Die OpenAPI veröffentlicht kein Kontingent; die Integration bleibt weit
  unter dem, was die Nanoleaf-App macht.

## Fehlerbehebung

- **„Kein Nanoleaf im Kopplungsmodus“**: Halte die Ein-/Aus-Taste länger (5
  bis 7 Sekunden, bis die Lichter blinken) und klicke dann sofort auf
  **Koppeln**: Das Kopplungsfenster dauert 30 Sekunden.
- **„Kein Nanoleaf gefunden“**: Prüfe, ob die Panels im selben Netzwerk wie
  Gladys sind (kein Gastnetz), und gib dann ihre IP-Adresse ein (in der
  Nanoleaf-App oder in deinem Router angezeigt).
- **„Ein Nanoleaf lehnt sein Zugriffstoken ab“**: Der Controller wurde
  zurückgesetzt oder seine Tokens gelöscht. Kopple ihn erneut: Das Gerät
  behält seine Funktionen und seinen Verlauf.
- **Das Gerät bleibt „antwortet nicht“**: Der Controller ist ohne Strom, oder
  seine Adresse hat sich geändert und die Suche hat ihn nicht gefunden.
  Klicke auf **Nanoleaf-Controller suchen** oder gib die neue Adresse ein.
- **Eine Geste bewirkt nichts**: Nur Canvas, Shapes und Elements haben Touch;
  prüfe, ob Touch in der Nanoleaf-App nicht ausgeschaltet ist und ob das
  Gerät im Auslöser gewählt (oder leer gelassen) ist.
- Mehr Details in den Protokollen der Integration mit `LOG_LEVEL=debug`.

## Grenzen

- Ohne die Hardware entwickelt: Die Antworten der Controller stammen aus der
  Nanoleaf-Dokumentation.
- Die Nanoleaf **Essentials** (Matter / Thread), das **4D / Screen
  Mirror**-Kit und das **Skylight** werden nicht abgedeckt.
- Der Musikmodus **Rhythm**, Szenen und Zeitpläne der Nanoleaf-App, die
  Anordnung und Farben pro Panel sind nicht verfügbar.
- Die Berührung jedes einzelnen Panels (Echtzeitstrom) braucht einen UDP-Port,
  den der Gladys-Container nicht öffnen kann: Nur die Gesten sind verfügbar.
- Effekte, deren Name mit einem Leerzeichen beginnt oder endet, werden aus der
  Liste ausgelassen.
- Die Rückkehr nach **Farbe auf einem Nanoleaf zeigen** übersteht keinen
  Neustart der Integration während der Wartezeit.
