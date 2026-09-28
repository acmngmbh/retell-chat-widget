# Retell Chat Widget

Einbettbares Text-Chat-Widget für Retell Chat Agents. Eine JS-Datei, die du auf jeder Seite einbinden kannst.

## 1. Vorbereiten

1. Im [Retell-Dashboard](https://dashboard.retellai.com) einen **Chat Agent** anlegen.
2. Unter **Keys → Public Keys** einen Public Key erzeugen (nicht den geheimen API-Key).
3. Beim Public Key die Domain eintragen, z. B. `localhost` und später `deine-domain.de`.
Die gebaute Datei liegt im Repo unter `dist/retell-chat-widget.js` und wird über jsDelivr ausgeliefert.

## 2. Einbinden

Script auf jeder Seite einfügen (am Ende von `<body>` oder in `<head>`):

```html
<script
  src="https://cdn.jsdelivr.net/gh/acmngmbh/retell-chat-widget@main/dist/retell-chat-widget.js"
  data-public-key="DEIN_PUBLIC_KEY"
  data-agent-id="DEINE_CHAT_AGENT_ID"
  data-title="Hilfe"
  data-fab-text="Chat öffnen"
  data-welcome-message="Hallo! Wobei kann ich helfen?"
></script>
```

Danach erscheint unten rechts der Button. Ein Klick öffnet den Chat.

Die Einbindeseite braucht ein Viewport-Meta, sonst rechnet iOS mit ~980px Breite und der Chat scrollt horizontal:

```html
<meta name="viewport" content="width=device-width, initial-scale=1" />
```

## 3. Button-Text und Design

| Attribut | JS-Option | Bedeutung |
| --- | --- | --- |
| `data-fab-text` | `fabText` oder `buttonText` | Text auf dem runden Button. Default: `Chat öffnen`. Leer = nur Icon. |
| `data-title` | `title` | Titel in der Chat-Leiste |
| `data-subtitle` | `subtitle` | Untertitel |
| `data-welcome-message` | `welcomeMessage` | Erste Bot-Nachricht, solange keine Vorschläge gesetzt sind |
| `data-empty-text` | `emptyText` | Text in der Mitte des leeren Chats |
| `data-quick-replies` | `quickReplies` | Vorschlags-Buttons. Strings mit `\|`, oder JSON mit `{ "label", "message", "dynamicVariables" }` |
| `data-placeholder` | `placeholder` | Placeholder im Eingabefeld |
| `data-color` | `colors.primary` | Akzentfarbe, z. B. `#1f4ed8` |
| `data-position` | `position` | `bottom-right` (Default) oder `bottom-left` |
| `data-hide-launcher` | `hideLauncher` | `true` = kein Button, nur per Script öffnen |

Beispiel nur Icon, ohne Text:

```html
<script
  src="https://cdn.jsdelivr.net/gh/acmngmbh/retell-chat-widget@main/dist/retell-chat-widget.js"
  data-public-key="…"
  data-agent-id="…"
  data-fab-text=""
></script>
```

## 4. Per JavaScript steuern

```html
<script src="https://cdn.jsdelivr.net/gh/acmngmbh/retell-chat-widget@main/dist/retell-chat-widget.js"></script>
<script>
  RetellChat.init({
    publicKey: "DEIN_PUBLIC_KEY",
    agentId: "DEINE_CHAT_AGENT_ID",
    title: "Hilfe",
    fabText: "Frage stellen",
    emptyText: "Wobei kann ich helfen?",
    quickReplies: [
      {
        label: "Termin",
        message: "Ich möchte einen Termin vereinbaren.",
        dynamicVariables: { topic: "appointment" },
      },
      "Preise",
    ],
    colors: { primary: "#1f4ed8" },
  });

  // Chat öffnen
  RetellChat.open();

  // Öffnen und sofort eine Nachricht senden
  RetellChat.open({ message: "Ich will einen Termin für Produkt X" });

  // Öffnen und Text nur vorausfüllen
  RetellChat.open({ draft: "Ich interessiere mich für…" });

  // Unsichtbaren Seitenkontext mitgeben
  RetellChat.open({
    message: "Erzähl mir mehr dazu",
    context: "Produkt: Premium-Tarif",
    dynamicVariables: { product: "premium" },
  });

  // Nur Variablen übergeben und den Agent zuerst sprechen lassen
  // (Retell-Agent muss auf „AI speaks first“ stehen)
  RetellChat.open({
    start: true,
    dynamicVariables: { plan: "premium" },
  });

  RetellChat.close();
  RetellChat.toggle();
  RetellChat.reset(); // neues Gespräch
</script>
```

### Buttons auf der Seite

```html
<button data-retell-open>Chat öffnen</button>
<button data-retell-open data-retell-message="Hilfe zum Checkout">Checkout-Hilfe</button>
<button data-retell-open data-retell-draft="Ich habe eine Frage zu…">Frage vorbereiten</button>
<button
  data-retell-open
  data-retell-start
  data-retell-dynamic='{"plan":"premium"}'
>
  Premium-Hilfe
</button>
```

Deep-Link: `https://deine-seite.de/?retell=open&retell_q=Termin%20buchen`

## 5. API-Kurzüberblick

| Methode | Zweck |
| --- | --- |
| `RetellChat.init(config)` | Widget starten |
| `RetellChat.open(options?)` | Öffnen, optional mit Text, Variablen oder `start: true` |
| `RetellChat.close()` | Schließen |
| `RetellChat.toggle()` | Umschalten |
| `RetellChat.send(text)` | Nachricht senden |
| `RetellChat.reset()` | Session löschen |
| `RetellChat.destroy()` | Widget entfernen |
| `RetellChat.on(event, fn)` | `ready`, `open`, `close`, `message`, `error`, `reset` |

## Verhalten

- **Navigation:** Verlauf und Offen-Zustand bleiben über Seitenwechsel erhalten (`localStorage`).
- **Mobile:** Unter 640px öffnet der Chat fullscreen. Host-Seite muss `width=device-width` setzen.
- **reCAPTCHA:** Wenn am Public Key aktiv, Google-Script einbinden und `data-recaptcha-key` setzen.
- **AI speaks first:** `start: true` oder `data-retell-start` / `data-retell-dynamic` legt die Session an und holt die erste Agent-Nachricht. Läuft schon ein Gespräch, öffnet der Button nur den Chat. Für einen neuen Kontext vorher `RetellChat.reset()`.
- **Leerer Chat:** `emptyText` steht in der Mitte. `quickReplies` sind Buttons darunter. Ein Klick sendet `message` (bei einem String den Button-Text) als erste User-Nachricht. `dynamicVariables` am Button werden mit denen aus `init` gemischt und gehen in denselben Create-Chat; gleiche Keys überschreibt der Button. Danach verschwinden Text und Buttons. Läuft schon eine Session, nimmt Retell keine neuen Variablen mehr an — vorher `RetellChat.reset()`.

## Lokal testen

```bash
npm install
npm run dev
```

Demo: [http://127.0.0.1:5173/demo/index.html](http://127.0.0.1:5173/demo/index.html)
