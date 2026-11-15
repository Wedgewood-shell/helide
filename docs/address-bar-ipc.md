# The address bar socket

With **Synergy mode** on (Settings → Appearance → Layout), Helide serves a Unix
socket that lets other programs follow and drive each window's address bar:
which page it shows, how far the page has loaded, what you type into the address
bar and its suggestions. Programs can also navigate, reload, stop, and go back
or forward.

It is meant for desktop widgets (a Quickshell bar, a launcher, a script bound to
a key), not for automation. For automation, see
[agent access](../README.md#let-ai-agents-control-helide).

- [Overview](#overview)
- [How it works](#how-it-works)
- [Protocol](#protocol)
- [Standing in for the address bar](#standing-in-for-the-address-bar)
- [Talking to it](#talking-to-it)
- [Tests](#tests)

## Overview

| | |
| --- | --- |
| **Path** | `$XDG_RUNTIME_DIR/helide-address-bar.sock` (usually `/run/user/1000/helide-address-bar.sock`) |
| **Format** | One JSON object per line, UTF-8, in both directions |
| **When it exists** | While at least one window of a profile with Synergy mode is open. It is removed when Synergy mode is turned off or the browser quits. |
| **Who can connect** | Only your user. The socket is created with mode 0600, and connections from other users are refused. Anything running as you can use it. |
| **What it reports** | Every normal window, incognito ones included (marked `incognito`), each with the page in its current tab. |
| **What it can't do** | Read pages, cookies, passwords or history. It can't run scripts in pages or open `javascript:` URLs. |
| **Only one browser** | Only one Helide serves the socket. If another Helide (another profile directory) already does, the second one leaves it alone. |

A minimal session, with `>` for what the client sends and `<` for what Helide
answers:

```text
> {"id":1,"cmd":"list"}
< {"id":1,"ok":true,"windows":[{"event":"state","window":1234,"focused":true,"url":"https://example.com/","title":"Example Domain","loading":false,"progress":1.0,"can_go_back":false,"can_go_forward":false}]}
> {"id":2,"cmd":"navigate","text":"wayland protocols"}
< {"id":2,"ok":true,"url":"https://duckduckgo.com/?q=wayland+protocols"}
```

The search URL depends on your default search engine.

## How it works

Each browser window is a *source*. A window with Synergy mode registers itself
with the socket server when the mode turns on, and unregisters when the mode
turns off or the window closes. The first registration creates the socket and
the last one removes it. So turning on Synergy mode is all it takes, and
nothing listens while no window uses it.

A source watches four things and tells the server whenever they change:

- **The tab strip**, for which tab is current. Switching tabs moves the source
  to the new tab.
- **The current tab's page**: navigations starting and finishing, the title,
  and loading. The load fraction is the same value that drives the loading bar
  under the address bar. A source keeps the highest value seen during a load,
  because Chromium briefly reports 0 as a new page starts, which the loading bar
  ignores too.
- **The window's address bar**: its suggestion engine reports a new list as
  you type, and the source passes each one on.
- **The window's focus**, so clients know which window you are in.

The server sends every change to the clients that have subscribed, as a
`state` or `suggestions` event. Clients that haven't subscribed get only
answers to their own requests.

Requests run on the browser's main thread, where the windows live, as if you
did the same thing yourself:

- `navigate` with `text` decides whether the text is a URL or a search
  exactly like typing it in the address bar and pressing Enter.
- `reload`, `stop`, `back` and `forward` run the browser commands behind the
  toolbar buttons and the shortcuts.
- `complete` starts a separate suggestion engine for the profile, so asking
  for suggestions never opens or changes anything in the browser's window.

The socket's input and output run on a background thread, so a slow client
can't make the browser stutter. Each connection is read in lines of up to 64
KiB and written in order. A client that stops reading while 4 MiB are waiting
for it is disconnected rather than buffered without end.

## Protocol

A request is an object with a `cmd`. It may have an `id` (any JSON value),
which the reply repeats. A reply has `"ok": true` with the result, or
`"ok": false` with an `error`. Messages that Helide sends without being asked
have an `event` instead of `ok`.

A request may name a window with `"window": <id>`. The id comes from `list` or
from any event. Without one, the request goes to the focused window, or else
the first one.

### Requests

| `cmd` | Fields | Reply |
| --- | --- | --- |
| `hello` | | `version`: the protocol version, now 1 |
| `list` | | `windows`: a [state](#state) for each window |
| `subscribe` | | Then [`state`](#state), [`suggestions`](#suggestions) and [`closed`](#closed) events as things change. It starts with the state of every window. |
| `unsubscribe` | | Stops the events |
| `navigate` | Either `text`: what you would type in the address bar (a URL, or words to search for), or `url`: opened exactly as given | `url`: where it went |
| `reload` | | |
| `reload_bypassing_cache` | | Like Shift+reload |
| `stop` | | `"ok": false` if the page isn't loading |
| `back`, `forward` | | `"ok": false` if there is nothing to go to |
| `new_tab` | | Opens a new tab in the window, as Ctrl+T does |
| `close_tab` | | Closes the window's current tab, as Ctrl+W does |
| `register_address_bar` | | Makes this connection a [stand-in for the address bar](#standing-in-for-the-address-bar) |
| `unregister_address_bar` | | |
| `address_bar_open` | `open`: true or false. The window comes from `window`, as for other requests. | Says whether the stand-in's editor is open for that window. Needs `register_address_bar` first. |
| `complete` | `text` | Then [`suggestions`](#suggestions) events with this request's `id`, until one has `"done": true`. A new `complete` from the same connection replaces the previous one. |

Errors:

| `error` | Meaning |
| --- | --- |
| `not a JSON object` | The line is not JSON, or not an object. The connection stays open. |
| `missing cmd` | The object has no `cmd` |
| `unknown cmd` | `cmd` names no request |
| `no such window` | `window` names no window on the socket |
| `missing url or text`, `missing text` | A field the request needs is missing |
| `not a URL that can be opened` | An invalid URL, or a `javascript:` URL |
| `not available now` | The command can't run now, for example `back` on the first page |
| `no tab` | The window has no current tab yet |
| `missing open` | `address_bar_open` without `open` |
| `not registered as an address bar` | `address_bar_open` without `register_address_bar` first |

### Events

#### `state`

Sent on subscribing, and whenever a window's current tab, page, title, loading
state or focus changes. `list` returns the same objects.

```json
{"event":"state","window":1234,"focused":true,"incognito":false,"tab":3,
 "url":"https://example.com/","title":"Example Domain",
 "loading":true,"progress":0.42,"can_go_back":true,"can_go_forward":false}
```

| Field | |
| --- | --- |
| `window` | The window's id, stable while it is open |
| `focused` | Whether it is the focused window |
| `incognito` | Whether it is an incognito window |
| `tab` | A number that changes whenever another tab becomes the window's current one (switching tabs, a new tab, closing one). Compare it with the last one to tell a tab switch from a navigation. |
| `url` | The URL the address bar shows |
| `title` | The tab's title |
| `loading` | Whether the page is loading |
| `progress` | How much of the page has loaded, from 0 to 1, as the loading bar shows it. It only grows during a load, and is 1 when the page isn't loading. |
| `can_go_back`, `can_go_forward` | Whether `back` and `forward` would do something |

Progress changes arrive as they happen, often several per second while a page
loads. A client that only wants to show a bar can redraw on each one.

#### `suggestions`

A list of up to 12 address bar suggestions, best first.

- `"source": "address_bar"`: for what is being typed into that window's address
  bar. Sent to subscribers each time the list changes.
- `"source": "query"`: the answer to a `complete` request, with the request's
  `id`. Several may arrive as slower sources (such as the search engine's
  suggestions) answer. The last has `"done": true`.

```json
{"event":"suggestions","source":"address_bar","window":1234,"input":"exa",
 "done":false,"suggestions":[
   {"contents":"example.com","description":"Example Domain",
    "url":"https://example.com/","fill":"example.com",
    "type":"history-url","default":true}]}
```

| Field | |
| --- | --- |
| `contents` | The suggestion's main text, as the address bar shows it |
| `description` | Its second line: a page title, or the search engine's name |
| `url` | Where choosing it goes |
| `fill` | What the address bar would contain with it selected. `{"cmd":"navigate","text":<fill>}` opens a suggestion as choosing it would. |
| `type` | What kind of suggestion it is, such as `search-what-you-typed`, `search-suggest`, `history-url`, `url-what-you-typed` or `bookmark-title` |
| `default` | Whether Enter would open it |

#### `closed`

A window closed, or left the socket because Synergy mode was turned off.

```json
{"event":"closed","window":1234}
```

#### `focus_address_bar`

Sent only to [stand-ins for the address bar](#standing-in-for-the-address-bar),
when the window would focus its address bar but hides it. It has the fields of
a [`state`](#state) event, and a `reason`:

- `shortcut`: Ctrl+L, or another command that focuses the address bar
- `new_tab`: a new tab page opened, whose address bar would have focus

```json
{"event":"focus_address_bar","reason":"new_tab","window":1234,"focused":true,
 "url":"chrome://newtab/","title":"New Tab","loading":false,"progress":1,
 "can_go_back":false,"can_go_forward":false}
```

## Standing in for the address bar

With **Hide the address bar while the window is focused** on, the browser's
address bar shows only while another window has focus. A program that draws its
own address bar (a Quickshell island, say) can take its place:

1. **Register.** Send `register_address_bar` after connecting. A connection
   stops being a stand-in when it closes or sends `unregister_address_bar`.
2. **Open when asked.** When the window would focus its hidden address bar,
   every stand-in gets a [`focus_address_bar`](#focus_address_bar) event. Open
   your editor for that `window`.
3. **Say when your editor is open.** Opening it takes the keyboard from the
   browser, so the window loses focus. Without help the browser would then
   show its own address bar, because another window has focus. Send
   `{"cmd":"address_bar_open","open":true,"window":<id>}` when your editor
   opens and `open: false` when it closes. While it is open, the browser keeps
   its address bar hidden. Send it also for a click on your editor that wasn't
   asked for.

Helide gives you some slack so there is no flash while you do this:

- After it sends `focus_address_bar`, its address bar stays hidden for up to
  1.5 seconds, waiting for `address_bar_open`.
- When the window loses focus while a stand-in is registered, it waits a
  quarter of a second before showing its own, in case focus went to the
  stand-in.
- After `open: false` (Escape in your editor), it waits up to 0.6 seconds for
  the keyboard to come back to the window before showing its own, so it
  doesn't flash while the compositor moves focus back.

Shortcuts typed into your editor reach your program, not the browser. Pass on
the ones that should still work with `new_tab` and `close_tab`. After
`new_tab`, the new tab page sends `focus_address_bar` again, so your editor can
start over for it. When the window's `tab` changes while your editor is open
(the user switched tabs some other way), its address is out of date; closing
the editor gives the keyboard back to the page.

If your editor closes with `open: false` and another window has focus, the
browser's address bar slides in. If the stand-in disconnects, any editor it had
open counts as closed.

Not for every focus: only Ctrl+L and the like, and a new tab page. Other times
the browser focuses its address bar (restoring focus after a dialog) don't ask
for a stand-in, as the user didn't ask for the address bar. **Ctrl+Shift+L**
always shows the browser's own address bar.

## Talking to it

Any language that can open a Unix socket works. Send a line, read lines.

### Shell

With `socat` (`pacman -S socat`; or `nc -U` from `openbsd-netcat`), and `jq`
for the last example:

```sh
sock=$XDG_RUNTIME_DIR/helide-address-bar.sock

# One request, one reply.
echo '{"cmd":"list"}' | socat - UNIX-CONNECT:$sock

# Open something in the focused window, as if typed.
echo '{"cmd":"navigate","text":"wayland protocols"}' | socat - UNIX-CONNECT:$sock

# Reload, or stop a load.
echo '{"cmd":"reload"}' | socat - UNIX-CONNECT:$sock
echo '{"cmd":"stop"}' | socat - UNIX-CONNECT:$sock

# Follow everything; the subscription lasts while the connection does.
(echo '{"cmd":"subscribe"}'; cat) | socat - UNIX-CONNECT:$sock

# The focused window's load progress, as a percentage, with jq.
(echo '{"cmd":"subscribe"}'; cat) | socat - UNIX-CONNECT:$sock |
  jq --unbuffered -r 'select(.event == "state" and .focused) | "\(.progress * 100 | floor)% \(.title)"'
```

`socat` closes the connection when its input ends, so one-shot requests need
nothing more. For a subscription, keep the input open (here with `cat`).

### Python

```python
import json, os, socket

path = os.path.join(os.environ["XDG_RUNTIME_DIR"], "helide-address-bar.sock")
sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
sock.connect(path)
lines = sock.makefile("r", encoding="utf-8")

def send(**request):
    sock.sendall((json.dumps(request) + "\n").encode())

send(id=1, cmd="complete", text="rust borrow")
for line in lines:
    message = json.loads(line)
    # Lists arrive as the suggestions come in; the last one is complete.
    if message.get("event") == "suggestions" and message.get("id") == 1 and message["done"]:
        for suggestion in message["suggestions"]:
            print(suggestion["type"], suggestion["contents"])
        break
```

### Node.js

```js
import { connect } from 'node:net';
import { createInterface } from 'node:readline';

const socket = connect(`${process.env.XDG_RUNTIME_DIR}/helide-address-bar.sock`);
createInterface({ input: socket }).on('line', line => {
  const message = JSON.parse(line);
  if (message.event === 'state' && message.focused) {
    console.log(message.loading ? `${Math.round(message.progress * 100)}%` : 'done', message.url);
  }
});
socket.write(JSON.stringify({ cmd: 'subscribe' }) + '\n');
```

### Quickshell

`Socket` from `Quickshell.Io` connects to the path, and a `SplitParser` hands
over one line at a time. Writes are queued until `flush()`.

```qml
import QtQuick
import Quickshell
import Quickshell.Io

Item {
    property var focusedWindow: ({})
    property var suggestions: []

    Socket {
        id: helide
        path: Quickshell.env("XDG_RUNTIME_DIR") + "/helide-address-bar.sock"
        connected: true
        onConnectedChanged: if (connected) {
            write('{"cmd":"subscribe"}\n')
            flush()
        }
        parser: SplitParser {
            onRead: line => {
                const message = JSON.parse(line)
                if (message.event === "state" && message.focused)
                    focusedWindow = message
                else if (message.event === "suggestions")
                    suggestions = message.suggestions
            }
        }
    }

    function open(text) {
        helide.write(JSON.stringify({ cmd: "navigate", text: text }) + "\n")
        helide.flush()
    }
}
```

Quickshell doesn't reconnect by itself. To pick the socket up after the browser
starts, set `connected` again, for example from a `Timer` while it is false.

### A stand-in, in Quickshell

```qml
Socket {
    id: helide
    path: Quickshell.env("XDG_RUNTIME_DIR") + "/helide-address-bar.sock"
    connected: true
    property bool editorOpen: false
    property int windowId: 0

    function send(message) { write(JSON.stringify(message) + "\n"); flush() }
    onEditorOpenChanged: send({ cmd: "address_bar_open", open: editorOpen, window: windowId })
    onConnectedChanged: if (connected) {
        send({ cmd: "subscribe" })
        send({ cmd: "register_address_bar" })
    }
    parser: SplitParser {
        onRead: line => {
            const message = JSON.parse(line)
            if (message.event === "focus_address_bar") {
                helide.windowId = message.window
                openMyAddressEditor(message.url)   // sets helide.editorOpen = true
            }
        }
    }
}
```

### Robust clients

- **The socket comes and goes** with Synergy mode and with the browser.
  Retry the connection (every few seconds is plenty) instead of giving up.
- **Use `id`** to match replies to requests. Events may arrive between a
  request and its reply.
- **Ignore unknown fields and events.** New ones may be added; `version`
  changes only when existing ones change meaning.

## Tests

`node scripts/test-address-bar-ipc.mjs` runs Helide against the fake Wayland
compositor in `tests/fake-wayland-compositor`, with a temporary profile and a
temporary `XDG_RUNTIME_DIR`.

It covers:

- listing windows and their state
- the progress fraction of a page that loads slowly from a local server
- navigating by URL and by typed text
- back, forward, reload and stop
- refusing `javascript:` URLs
- `complete`
- errors for bad requests
- the socket appearing with Synergy mode and going away without it
- standing in for the address bar: `focus_address_bar` on Ctrl+L, the native
  address bar staying hidden while the stand-in's editor is open, no flash when
  focus moves to the stand-in, and showing again when focus goes elsewhere
  (these are in `scripts/test-synergy-mode.mjs`, since they need the window)

The `address_bar` suggestions (what you type in the browser itself) are not
covered, because the test can't type into the browser's own interface. They
come from the same suggestion engine that `complete` uses.
