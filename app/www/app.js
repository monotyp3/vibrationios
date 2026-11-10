/*
 * Haptic Link - frontend
 *
 * Phone A: touchstart sends "d" (down), touchend sends "u" (up), each with a
 *          timestamp from the sender's clock.
 * Phone B: replays those down/up events with the SAME spacing the sender
 *          used, so a 0.1 s tap feels like 0.1 s and a 3-tap rhythm keeps
 *          its rhythm even if network delay wobbles a bit.
 */
(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------
  const DEFAULT_SERVER = '';     // optional: put your relay URL here, e.g. 'https://haptic-relay.onrender.com'
  const JITTER_BUFFER_MS = 40;   // small fixed delay that absorbs network wobble so rhythm stays exact
  const REANCHOR_IDLE_MS = 1500; // after this much quiet, re-sync to the current network delay
  const MIN_BUZZ_MS = 35;        // shortest buzz people can clearly feel
  const MAX_BUZZ_MS = 10000;     // safety cap in case an "up" event is ever lost
  const PING_EVERY_MS = 2000;

  // ---------------------------------------------------------------------------
  // Capacitor plugins (loaded from vendor/capacitor.js, no bundler needed)
  // ---------------------------------------------------------------------------
  const cap = window.capacitorExports;
  const isNative = !!(cap && cap.Capacitor && cap.Capacitor.isNativePlatform());
  const HapticTouch = isNative ? cap.registerPlugin('HapticTouch') : null; // our local plugin (start/stop)
  const Haptics = isNative ? cap.registerPlugin('Haptics') : null;         // @capacitor/haptics fallback

  // ---------------------------------------------------------------------------
  // DOM
  // ---------------------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const ui = {
    connect: $('connect'), pad: $('pad'),
    server: $('server'), room: $('room'),
    joinBtn: $('joinBtn'), leaveBtn: $('leaveBtn'), connectError: $('connectError'),
    roomLabel: $('roomLabel'), peerLabel: $('peerLabel'), pingLabel: $('pingLabel'),
    tap: $('tapBtn'), incoming: $('incoming'),
  };

  const store = {
    get(k) { try { return localStorage.getItem(k) || ''; } catch { return ''; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  };

  // ---------------------------------------------------------------------------
  // Haptic output layer
  //   'touch' = HapticTouch plugin, true start/stop (best)
  //   'pulse' = @capacitor/haptics, chained short vibrations (fallback)
  //   'web'   = navigator.vibrate (Android browser testing only)
  // ---------------------------------------------------------------------------
  const haptic = {
    mode: 'none',
    pulseTimer: null,

    async init() {
      if (HapticTouch) {
        try {
          await HapticTouch.isSupported();
          this.mode = 'touch';
          return;
        } catch { /* plugin missing, fall through */ }
      }
      if (Haptics) { this.mode = 'pulse'; return; }
      if (navigator.vibrate) { this.mode = 'web'; }
    },

    on() {
      switch (this.mode) {
        case 'touch':
          HapticTouch.start({ intensity: 1.0, sharpness: 0.5 });
          break;
        case 'pulse':
          Haptics.vibrate({ duration: 120 });
          this.pulseTimer = setInterval(() => Haptics.vibrate({ duration: 120 }), 100);
          break;
        case 'web':
          navigator.vibrate(MAX_BUZZ_MS);
          break;
      }
    },

    off() {
      switch (this.mode) {
        case 'touch': HapticTouch.stop(); break;
        case 'pulse': clearInterval(this.pulseTimer); this.pulseTimer = null; break;
        case 'web': navigator.vibrate(0); break;
      }
    },

    keepAwake(enabled) {
      if (this.mode === 'touch') HapticTouch.keepAwake({ enabled });
    },
  };

  // ---------------------------------------------------------------------------
  // Receiver: turn remote down/up events into buzzes with the original timing
  // ---------------------------------------------------------------------------
  let buzzing = false;
  let buzzStartedAt = 0;
  let offTimer = null;
  let safetyTimer = null;

  function buzzOn() {
    clearTimeout(offTimer);
    if (buzzing) return;
    buzzing = true;
    buzzStartedAt = performance.now();
    haptic.on();
    ui.incoming.classList.add('on');
    safetyTimer = setTimeout(buzzOffNow, MAX_BUZZ_MS);
  }

  function buzzOff() {
    if (!buzzing) return;
    const held = performance.now() - buzzStartedAt;
    if (held < MIN_BUZZ_MS) {
      clearTimeout(offTimer);
      offTimer = setTimeout(buzzOffNow, MIN_BUZZ_MS - held);
    } else {
      buzzOffNow();
    }
  }

  function buzzOffNow() {
    clearTimeout(offTimer);
    clearTimeout(safetyTimer);
    if (!buzzing) return;
    buzzing = false;
    haptic.off();
    ui.incoming.classList.remove('on');
  }

  // Jitter buffer.
  // anchor maps the sender's clock onto ours: localTime = senderTime + anchor.
  // Every event plays at (senderTime + anchor + JITTER_BUFFER_MS), so the gaps
  // between events match the sender exactly, as long as network delay changes
  // by less than JITTER_BUFFER_MS.
  let anchor = null;
  let lastRemoteAt = 0;

  function onRemoteEvent(msg) {
    const now = performance.now();

    if (anchor === null || now - lastRemoteAt > REANCHOR_IDLE_MS) {
      anchor = now - msg.at;
    }
    lastRemoteAt = now;

    let delay = msg.at + anchor + JITTER_BUFFER_MS - now;

    // Arrived later than the buffer allows (network got slower) or way earlier
    // (network got faster): play now and re-anchor so later events line up.
    if (delay < 0 || delay > JITTER_BUFFER_MS * 3) {
      anchor = now - msg.at - JITTER_BUFFER_MS;
      delay = 0;
    }

    const run = msg.t === 'd' ? buzzOn : buzzOff;
    if (delay < 1) run(); else setTimeout(run, delay);
  }

  // ---------------------------------------------------------------------------
  // Sender: capture real touch timing on the big button
  // ---------------------------------------------------------------------------
  let socket = null;
  let pressing = false;
  let seq = 0;

  function send(type) {
    if (!socket || !socket.connected) return;
    socket.emit('h', { t: type, s: ++seq, at: Math.round(performance.now()) });
  }

  function press() {
    if (pressing) return;
    pressing = true;
    ui.tap.classList.add('down');
    send('d');
  }

  function release() {
    if (!pressing) return;
    pressing = false;
    ui.tap.classList.remove('down');
    send('u');
  }

  // touchstart / touchend are the fastest touch signals iOS gives a web view.
  ui.tap.addEventListener('touchstart', (e) => {
    e.preventDefault(); // blocks the delayed fake mouse events and long-press menu
    press();
  }, { passive: false });

  const onTouchFinish = (e) => {
    e.preventDefault();
    if (e.targetTouches.length === 0) release(); // only release when every finger is off
  };
  ui.tap.addEventListener('touchend', onTouchFinish, { passive: false });
  ui.tap.addEventListener('touchcancel', onTouchFinish, { passive: false });

  // Mouse support so you can test from a desktop browser.
  ui.tap.addEventListener('mousedown', press);
  window.addEventListener('mouseup', release);

  // If the app is backgrounded mid-press, make sure nobody is left buzzing.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { release(); buzzOffNow(); }
  });

  // ---------------------------------------------------------------------------
  // Networking
  // ---------------------------------------------------------------------------
  let joinedRoom = null;
  let wantRoom = null;
  let pingTimer = null;

  function setPeer(online) {
    ui.peerLabel.textContent = online ? 'Partner online' : 'Waiting for partner';
    ui.peerLabel.classList.toggle('ok', online);
  }

  function showPad(room) {
    ui.roomLabel.textContent = `Room ${room}`;
    ui.joinBtn.dataset.state = '';
    ui.connect.classList.add('hidden');
    ui.pad.classList.remove('hidden');
    haptic.keepAwake(true);
  }

  function showConnect(errorText = '') {
    ui.pad.classList.add('hidden');
    ui.connect.classList.remove('hidden');
    ui.connectError.textContent = errorText;
    ui.joinBtn.textContent = 'Join room';
    ui.joinBtn.dataset.state = '';
    haptic.keepAwake(false);
  }

  function joinRoom() {
    socket.emit('join', wantRoom, (res) => {
      if (!res || !res.ok) {
        disconnect();
        showConnect((res && res.error) || 'Could not join room');
        return;
      }
      joinedRoom = res.room;
      showPad(res.room);
      setPeer(res.peerOnline);
    });
  }

  function connect(serverUrl, room) {
    disconnect();
    wantRoom = room;

    socket = window.io(serverUrl, {
      transports: ['websocket'], // no long-polling, straight to a socket
      reconnectionDelay: 300,
      reconnectionDelayMax: 2000,
      timeout: 10000,
    });

    socket.on('connect', joinRoom); // also re-joins automatically after a reconnect

    socket.on('connect_error', () => {
      if (!joinedRoom) {
        ui.connectError.textContent =
          'Cannot reach the server yet, still trying. Free hosts can take up to a minute to wake up.';
      } else {
        ui.peerLabel.textContent = 'Reconnecting...';
        ui.peerLabel.classList.remove('ok');
      }
    });

    socket.on('disconnect', () => {
      buzzOffNow();
      anchor = null;
      if (joinedRoom) {
        ui.peerLabel.textContent = 'Reconnecting...';
        ui.peerLabel.classList.remove('ok');
      }
    });

    socket.on('peer', ({ online }) => {
      setPeer(online);
      if (!online) { buzzOffNow(); anchor = null; }
    });

    socket.on('h', onRemoteEvent);

    clearInterval(pingTimer);
    pingTimer = setInterval(() => {
      if (!socket || !socket.connected) return;
      const t0 = performance.now();
      socket.emit('p', () => {
        ui.pingLabel.textContent = `${Math.round(performance.now() - t0)} ms`;
      });
    }, PING_EVERY_MS);
  }

  function disconnect() {
    clearInterval(pingTimer);
    if (socket) {
      socket.removeAllListeners();
      socket.disconnect();
      socket = null;
    }
    joinedRoom = null;
    pressing = false;
    buzzOffNow();
    anchor = null;
  }

  // ---------------------------------------------------------------------------
  // Connect screen
  // ---------------------------------------------------------------------------
  ui.server.value = store.get('server') || DEFAULT_SERVER;
  ui.room.value = store.get('room');

  ui.joinBtn.addEventListener('click', () => {
    // Second tap while connecting acts as Cancel.
    if (ui.joinBtn.dataset.state === 'connecting') {
      disconnect();
      showConnect();
      return;
    }

    const server = ui.server.value.trim().replace(/\/+$/, '');
    const room = ui.room.value.trim().toUpperCase();

    if (!/^(https?|wss?):\/\/.+/i.test(server)) {
      ui.connectError.textContent = 'Enter a server URL starting with https:// (or http:// on your home Wi-Fi)';
      return;
    }
    if (!/^[A-Z0-9]{3,16}$/.test(room)) {
      ui.connectError.textContent = 'Room code must be 3 to 16 letters or numbers';
      return;
    }

    store.set('server', server);
    store.set('room', room);
    ui.connectError.textContent = '';
    ui.joinBtn.textContent = 'Connecting... (tap to cancel)';
    ui.joinBtn.dataset.state = 'connecting';
    connect(server, room);
  });

  ui.leaveBtn.addEventListener('click', () => {
    disconnect();
    showConnect();
  });

  haptic.init();
})();
