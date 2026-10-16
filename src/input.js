// Input manager.
//
// Design rule: every action is tracked independently and nothing here ever
// cancels an unrelated action. Gameplay may decide that sprinting lowers the
// weapon; input never decides it.
//
// Held actions are latched booleans derived from three independent sources
// (keyboard, mouse buttons, on-screen buttons) OR'd together, so a key and a
// touch button can drive the same action without fighting.
//
// One-shot actions (jump, reload, weapon switch, pause) go into an edge queue
// that the game drains once per frame, so a tap between frames is never lost
// and never repeats.
//
// The bug this replaces: mouse button state was keyed off `pointerId`, and every
// mouse button shares one pointerId. Releasing the first button cleared the
// tracked id, so the second button's release matched nothing and its action
// stayed latched on forever.

const STICK_RADIUS = 62;
const STICK_DEAD = 5;

// action -> list of KeyboardEvent.code that drive it
const KEYMAP = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  crouch: ['ControlLeft', 'ControlRight', 'KeyC'],
  fire: ['Space'],
  interact: ['KeyE'],
};

// mouse button index -> action
const MOUSEMAP = { 0: 'fire', 2: 'aim' };

const HELD_ACTIONS = ['forward', 'back', 'left', 'right', 'sprint', 'crouch', 'fire', 'aim', 'interact'];

export class Input {
  constructor(canvas) {
    this.canvas = canvas;

    // --- independent sources ---
    this.keys = new Set();           // KeyboardEvent.code currently down
    this.mouseButtons = new Set();   // MouseEvent.button currently down
    this.touch = {};                 // action -> bool, from on-screen buttons
    for (const a of HELD_ACTIONS) this.touch[a] = false;

    // --- derived, rebuilt every take() ---
    this.held = {};
    for (const a of HELD_ACTIONS) this.held[a] = false;

    // --- one-shot edge queue ---
    this.queue = { jump: 0, reload: 0, pause: 0, inspect: 0, switchTo: null };

    // --- look / stick ---
    this.dx = 0; this.dy = 0;
    this.lookId = null; this.lx = 0; this.ly = 0;
    this.stickId = null;
    this.stickOx = 0; this.stickOy = 0;
    this.stickX = 0; this.stickY = 0;
    this.stickActive = false;
    this.stickX01 = 0; this.stickY01 = 0;

    this.pointerLocked = false;
    this.wantPointerLock = false;
    this.swallowMove = false;
    this.invertY = false;
    this.enabled = true;

    this._bind();
  }

  get halfWidth() { return (window.innerWidth || 800) * 0.42; }

  // Compatibility shims so callers can still poke single flags.
  get firing() { return this.held.fire || this.touch.fire; }
  set firing(v) { this.touch.fire = !!v; }
  get ads() { return this.held.aim || this.touch.aim; }
  set ads(v) { this.touch.aim = !!v; }
  get crouch() { return this.held.crouch || this.touch.crouch; }
  set crouch(v) { this.touch.crouch = !!v; }
  set jumpQueued(v) { if (v) this.queue.jump++; }
  set reloadQueued(v) { if (v) this.queue.reload++; }
  set switchQueued(v) { if (v) this.queue.switchTo = v; }

  // Pointer lock can only be granted from a user gesture. Starting or resuming
  // the game happens inside a button click, which is one -- so ask there, and
  // the player never has to click the world before the mouse turns the view.
  requestLock() {
    const c = this.canvas;
    if (this.pointerLocked || !this.wantPointerLock || !c.requestPointerLock) return;
    try {
      const p = c.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch (_) { /* the unlocked fallback covers it */ }
  }

  _bind() {
    const c = this.canvas;
    const opt = { passive: false };

    // ---------------- keyboard ----------------
    window.addEventListener('keydown', (e) => {
      // Esc must work even when gameplay input is disabled, or a paused game
      // cannot be unpaused from the keyboard.
      if (e.code === 'Escape') { this.queue.pause++; return; }
      if (!this.enabled) return;
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      // Track the physical key even on auto-repeat; only edges are filtered.
      const wasDown = this.keys.has(e.code);
      this.keys.add(e.code);
      if (wasDown || e.repeat) return;
      if (e.code === 'Space') this.queue.jump++;
      if (e.code === 'KeyR') this.queue.reload++;
      if (e.code === 'KeyI') this.queue.inspect++;
      if (e.code === 'Digit1') this.queue.switchTo = 'rifle';
      if (e.code === 'Digit2') this.queue.switchTo = 'smg';
      if (e.code === 'Digit3') this.queue.switchTo = 'shotgun';
      if (e.code === 'Digit4') this.queue.switchTo = 'sniper';
    });
    // Never gated on `enabled`: a key released while paused must still clear.
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));

    // ---------------- mouse buttons ----------------
    // Keyed by button index, never by pointerId. Every mouse button shares one
    // pointerId, which is what broke the previous implementation.
    c.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      this.mouseButtons.add(e.button);
      // Mouse look only exists under pointer lock, so the lock has to be
      // requested from a real gesture. If the browser refuses it, the
      // drag-look fallback in the mousemove handler keeps the game aimable.
      this.requestLock();
    }, opt);
    const releaseButton = (e) => { this.mouseButtons.delete(e.button); };
    window.addEventListener('mouseup', releaseButton);
    c.addEventListener('contextmenu', (e) => e.preventDefault());

    // ---------------- pointer: look drag and the movement stick ----------------
    c.addEventListener('pointerdown', (e) => {
      if (!this.enabled || e.pointerType === 'mouse') return;
      e.preventDefault();
      if (e.clientX < this.halfWidth && this.stickId === null) {
        this.stickId = e.pointerId;
        this.stickOx = this.stickX = e.clientX;
        this.stickOy = this.stickY = e.clientY;
        this.stickActive = true;
      } else if (this.lookId === null) {
        this.lookId = e.pointerId;
        this.lx = e.clientX; this.ly = e.clientY;
      }
      c.setPointerCapture?.(e.pointerId);
    }, opt);

    c.addEventListener('pointermove', (e) => {
      if (!this.enabled) return;
      if (e.pointerId === this.stickId) {
        e.preventDefault();
        this.stickX = e.clientX; this.stickY = e.clientY;
        let ox = e.clientX - this.stickOx, oy = e.clientY - this.stickOy;
        const d = Math.hypot(ox, oy);
        // Drag past the ring and the origin follows, so the stick never caps
        // out silently under the thumb.
        if (d > STICK_RADIUS) {
          const pull = d - STICK_RADIUS;
          this.stickOx += (ox / d) * pull;
          this.stickOy += (oy / d) * pull;
          ox = (ox / d) * STICK_RADIUS; oy = (oy / d) * STICK_RADIUS;
        }
        this.stickX01 = Math.abs(ox) < STICK_DEAD ? 0 : ox / STICK_RADIUS;
        this.stickY01 = Math.abs(oy) < STICK_DEAD ? 0 : oy / STICK_RADIUS;
        return;
      }
      if (e.pointerId !== this.lookId) return;
      if (this.pointerLocked) return;          // locked look comes from mousemove
      e.preventDefault();
      this.dx += e.clientX - this.lx;
      this.dy += e.clientY - this.ly;
      this.lx = e.clientX; this.ly = e.clientY;
    }, opt);

    const endPointer = (e) => {
      if (e.pointerId === this.stickId) {
        this.stickId = null;
        this.stickActive = false;
        this.stickX01 = 0; this.stickY01 = 0;
      }
      if (e.pointerId === this.lookId) this.lookId = null;
    };
    c.addEventListener('pointerup', endPointer, opt);
    c.addEventListener('pointercancel', endPointer, opt);

    // ---------------- pointer lock look ----------------
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === c;
      // Losing the lock means the buttons will never report their release.
      if (this.pointerLocked && !locked) this.mouseButtons.clear();
      this.pointerLocked = locked;
      // The first move after the lock engages carries the jump from the old
      // cursor position and would snap the view.
      this.swallowMove = true;
    });
    document.addEventListener('mousemove', (e) => {
      // Moving the mouse aims, with nothing held down. `enabled` is the gate:
      // it is false in menus and while paused, so a cursor crossing a menu can
      // never turn the camera. This runs locked or not, so the view still aims
      // on a browser that refuses pointer lock.
      if (!this.enabled) return;
      if (this.swallowMove) { this.swallowMove = false; return; }
      this.dx += e.movementX;
      this.dy += e.movementY;
    });
    c.addEventListener('wheel', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      this.queue.switchTo = e.deltaY > 0 ? 'next' : 'prev';
    }, opt);

    // Focus loss would otherwise leave keys and buttons latched down.
    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.releaseAll();
    });
  }

  releaseAll() {
    this.keys.clear();
    this.mouseButtons.clear();
    for (const a of HELD_ACTIONS) this.touch[a] = false;
    this.stickId = null;
    this.stickActive = false;
    this.stickX01 = 0; this.stickY01 = 0;
    this.lookId = null;
    this.dx = 0; this.dy = 0;
    document.querySelectorAll('.pad.down').forEach((el) => el.classList.remove('down'));
  }

  // ---------------- on-screen buttons ----------------
  // Each button owns one action and touches nothing else.
  bindHold(el, action) {
    if (!el) return;
    const on = (e) => { e.preventDefault(); e.stopPropagation(); this.touch[action] = true; el.classList.add('down'); };
    const off = (e) => { e.preventDefault(); e.stopPropagation(); this.touch[action] = false; el.classList.remove('down'); };
    el.addEventListener('pointerdown', on);
    el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off);
    el.addEventListener('pointerleave', off);
  }

  bindToggle(el, action) {
    if (!el) return;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      this.touch[action] = !this.touch[action];
      el.classList.toggle('down', this.touch[action]);
    });
  }

  bindTap(el, fn) {
    if (!el) return;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      el.classList.add('down');
      fn();
    });
    const off = () => el.classList.remove('down');
    el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off);
  }

  anyKeyOf(list) {
    for (const code of list) if (this.keys.has(code)) return true;
    return false;
  }

  // Rebuilds every held action from all sources, then drains the edge queue.
  take() {
    for (const a of HELD_ACTIONS) {
      const byKey = KEYMAP[a] ? this.anyKeyOf(KEYMAP[a]) : false;
      this.held[a] = byKey || this.touch[a];
    }
    for (const [btn, action] of Object.entries(MOUSEMAP)) {
      if (this.mouseButtons.has(Number(btn))) this.held[action] = true;
    }

    // Movement: keyboard wins when pressed, otherwise the stick. Both are
    // read every frame; neither disables the other.
    let moveX = this.stickX01, moveY = this.stickY01;
    const kx = (this.held.right ? 1 : 0) - (this.held.left ? 1 : 0);
    const ky = (this.held.back ? 1 : 0) - (this.held.forward ? 1 : 0);
    if (kx || ky) {
      const m = Math.hypot(kx, ky) || 1;
      moveX = kx / m; moveY = ky / m;
    }

    // Sprint from the keyboard modifier, or from pushing the stick to its edge.
    const stickSprint = Math.hypot(this.stickX01, this.stickY01) > 0.9;
    const sprint = this.held.sprint || (stickSprint && !this.keys.size);

    const r = {
      dx: this.dx,
      dy: this.dy * (this.invertY ? -1 : 1),
      moveX, moveY,
      firing: this.held.fire,
      ads: this.held.aim,
      sprint,
      crouch: this.held.crouch,
      interact: this.held.interact,
      jump: this.queue.jump > 0,
      reload: this.queue.reload > 0,
      inspect: this.queue.inspect > 0,
      switchTo: this.queue.switchTo,
      pause: this.queue.pause > 0,
    };

    this.dx = 0; this.dy = 0;
    this.queue.jump = 0;
    this.queue.reload = 0;
    this.queue.pause = 0;
    this.queue.inspect = 0;
    this.queue.switchTo = null;
    return r;
  }

  reset() {
    this.releaseAll();
    this.queue.jump = 0;
    this.queue.reload = 0;
    this.queue.pause = 0;
    this.queue.switchTo = null;
  }

  // ---------------- diagnostics ----------------
  // Snapshot of every independent source, for the stress test.
  debugState() {
    return {
      keys: [...this.keys],
      mouseButtons: [...this.mouseButtons],
      touch: { ...this.touch },
      held: { ...this.held },
      queue: { ...this.queue },
      stick: [this.stickX01, this.stickY01],
    };
  }
}
