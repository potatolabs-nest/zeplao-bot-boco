// The part of a view that is the same for both of them: where the data comes from, what
// colours to wear, how big to be, and when to tell the app it is ready.
//
// A view is not a session. It is opened by a tap on something in a message and handed that
// thing's `data`; nothing it does reaches the bot, and nothing reaches it later but the same
// data again. So the whole conversation with the app is: here I am, this is my size, close me.
//
// Nothing about how the page was opened can be read when this script runs. On the phone the
// app has written it in before the page starts, but on the web it arrives in the frame's first
// message, after the page has loaded — and until then Zeplao.mode still says 'session'. So a
// view waits for Zeplao.onData, which is called once the app has said, whenever that is, and
// reads the theme then.
//
// Opened as a plain file in a browser, there is no Zeplao — zeplao.js is written into the
// bundle by the platform at upload and is not in this folder. Then a view draws its sample
// instead, so it can be looked at and worked on without uploading anything.
(function () {
  const z = window.Zeplao;

  // Inside the app: a frame around the page on the web, the app's handler on a phone. A page
  // with a host is never shown the sample, however long the host takes — a made-up card
  // where the tapped word should be is worse than a moment of "Đang mở…".
  const hosted = Boolean(z) && (window.parent !== window || Boolean(window.flutter_inappwebview));

  // How long a page with no host waits for somebody to say hello before drawing its sample.
  // Long enough for a preview page that greets the frame on load.
  const SAMPLE_AFTER = 1000;

  // Whether the app has handed over this view's data. Until it has, there is no theme to wear,
  // no size worth asking for, and nobody to tell it is ready.
  let live = false;

  // A canvas context is the one thing in a browser that will turn any CSS colour — a name,
  // hsl(), #abc — into numbers. The theme is whatever the app sends, and what it sends is not
  // this page's to assume the spelling of.
  const probe = document.createElement('canvas').getContext('2d');

  function rgb(color) {
    if (typeof color !== 'string' || !color.trim() || !probe) return null;
    probe.fillStyle = '#010203';
    probe.fillStyle = color;
    const out = String(probe.fillStyle);
    if (out === '#010203' && !/^#0?10?20?3$/i.test(color.trim())) return null;
    if (out[0] === '#') {
      return [1, 3, 5].map((i) => parseInt(out.slice(i, i + 2), 16));
    }
    const parts = out.match(/[\d.]+/g);
    return parts && parts.length >= 3 ? parts.slice(0, 3).map(Number) : null;
  }

  const css = (c) => `rgb(${c.map((v) => Math.round(v)).join(', ')})`;
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  const luminance = (c) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;

  const TOKENS = ['--bg', '--text', '--muted', '--line', '--tint', '--primary'];
  let worn = '';

  /**
   * Wears the app's colours, or the stylesheet's own when the app sent none that can be read.
   *
   * Only background, text and primary are promised. The in-between shades — the muted grey,
   * the hairline, the tint behind a formula — are mixed from those two here rather than hoped
   * for, so a room with a theme nobody designed this page for still reads as one thing.
   *
   * Read when the app speaks, never at load: on the web the theme comes in the same message
   * as the data. Returns whether anything changed, so a canvas knows when to draw again.
   */
  function applyTheme() {
    const theme = (live && z.theme) || {};
    const bg = rgb(theme.background);
    const text = rgb(theme.text);
    const primary = rgb(theme.primary);
    const style = document.documentElement.style;

    const next = JSON.stringify([bg, text, primary]);
    if (next === worn) return false;
    worn = next;

    TOKENS.forEach((token) => style.removeProperty(token));
    style.removeProperty('color-scheme');

    if (bg && text) {
      style.setProperty('--bg', css(bg));
      style.setProperty('--text', css(text));
      style.setProperty('--muted', css(mix(text, bg, 0.42)));
      style.setProperty('--line', css(mix(text, bg, 0.86)));
      style.setProperty('--tint', css(mix(bg, text, 0.05)));
      style.setProperty('color-scheme', luminance(bg) < 0.5 ? 'dark' : 'light');
    }
    if (primary) style.setProperty('--primary', css(primary));
    return true;
  }

  let asked = '';
  let keptWidth = 0;

  /**
   * Asks the frame to be as tall as `element`, at the width it was first given.
   *
   * Only when that size has changed since the last time it asked. The frame answering a
   * request changes the page, which may run this again — and asking for the size it already
   * has is how a view ends up resizing itself for ever.
   *
   * The width is measured once and then kept. The box the app draws round a frame is wider
   * than the frame by its border, so a page that asks for the width it now has is given a
   * frame two pixels narrower, measures that, asks again — and walks itself down to the
   * narrowest card there is, a word to a line.
   */
  function fit(element) {
    if (!live || typeof z.setSize !== 'function' || !element) return;
    if (!keptWidth) keptWidth = Math.ceil(document.documentElement.clientWidth || element.offsetWidth);
    const width = keptWidth;
    const height = Math.ceil(element.getBoundingClientRect().height);
    if (!width || !height) return;
    const next = `${width}x${height}`;
    if (next === asked) return;
    asked = next;
    z.setSize(width, height);
  }

  /**
   * Starts a view: waits for the app's data, draws it, and says it is ready.
   *
   * `render(data, why)` is called with valid data, or with `null` and why not — `'waiting'`
   * while nothing has arrived, `'invalid'` when something did and it was not what this view
   * draws. A view should never throw on a stranger's shape of data, and never show a blank
   * frame that looks like it is still loading when it has in fact given up.
   */
  function start({ sample, valid, render, retheme }) {
    applyTheme();

    let told = false;
    const show = (data) => {
      if (valid(data)) render(data, null);
      else render(null, 'invalid');
    };

    if (z && typeof z.onData === 'function') {
      // At once on a phone, or when the web frame's hello lands — both are the same here.
      z.onData((data) => {
        const first = !live;
        told = true;
        live = true;
        applyTheme();
        show(data);
        if (first && typeof z.ready === 'function') z.ready();
      });

      // The app may send its theme again while the view is open.
      window.addEventListener('message', () => {
        if (live && applyTheme() && typeof retheme === 'function') retheme();
      });
    }

    if (told) return;

    // No bridge at all: a file opened straight from the folder, and nobody can ever say hello.
    if (!z) {
      show(sample);
      return;
    }

    render(null, 'waiting');
    if (hosted) return;

    // A bridge but nobody around it — zeplao.js copied beside the pages and one of them opened
    // on its own. A moment for a hello first, and the sample if none comes.
    setTimeout(() => {
      if (!told) show(sample);
    }, SAMPLE_AFTER);
  }

  function close() {
    if (live && typeof z.close === 'function') z.close();
  }

  // Escape closes, the way it closes anything else that opened on top of a conversation.
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });

  window.TermView = {
    get live() { return live; },
    start,
    fit,
    close,
  };
})();
