/* ==========================================================================
   virtual.js — virtualized list with variable row heights.

   Only the bubbles actually on screen exist in the DOM (plus a safety margin
   above and below). Real heights are measured after painting and kept in a
   Fenwick tree, which gives the offset of any message in O(log n): that way
   even 200,000 messages scroll smoothly and "jump to 12 March" is instant.
   ========================================================================== */
(function (global) {
  'use strict';

  /** Fenwick tree over heights: prefix sums and lookup by offset. */
  class Fenwick {
    constructor(values) {
      const n = values.length;
      this.n = n;
      this.h = Float64Array.from(values);
      const t = new Float64Array(n + 1);
      for (let i = 0; i < n; i++) t[i + 1] = values[i];
      for (let i = 1; i <= n; i++) {          // O(n) build
        const j = i + (i & -i);
        if (j <= n) t[j] += t[i];
      }
      this.t = t;
      this.pow = 1;
      while (this.pow * 2 <= n) this.pow *= 2;
    }
    set(i, v) {
      const d = v - this.h[i];
      if (!d) return;
      this.h[i] = v;
      for (let k = i + 1; k <= this.n; k += k & -k) this.t[k] += d;
    }
    get(i) { return this.h[i]; }
    /** Sum of the heights of items [0, i). */
    prefix(i) {
      let s = 0;
      for (let k = i; k > 0; k -= k & -k) s += this.t[k];
      return s;
    }
    total() { return this.prefix(this.n); }
    /** Index of the first item whose end goes past `target`. */
    search(target) {
      let pos = 0, rem = target;
      for (let pw = this.pow; pw > 0; pw >>= 1) {
        const nx = pos + pw;
        if (nx <= this.n && this.t[nx] <= rem) { rem -= this.t[nx]; pos = nx; }
      }
      return Math.min(pos, this.n - 1);
    }
  }

  class VirtualList {
    /**
     * @param {object} o
     *  scroller  element with overflow scroll
     *  inner     positioned container inside the scroller
     *  count     number of rows
     *  estimate  (i) => guessed height, used before the row is measured
     *  render    (i) => HTMLElement
     *  overscan  extra pixels painted above and below (default 900)
     */
    constructor(o) {
      this.scroller = o.scroller;
      this.inner = o.inner;
      this.estimate = o.estimate;
      this.renderRow = o.render;
      this.overscan = o.overscan || 900;
      this.velocity = 0;          // signed px per millisecond
      this._lastTop = 0;
      this._lastAt = 0;
      this.onRange = o.onRange || null;
      this.rendered = new Map();
      this.pinBottom = true;      // only holds until the first manual scroll
      this.userScrolling = false;
      this.setCount(o.count);

      // Writing scrollTop fires a 'scroll' event. So as not to mistake our own
      // moves for the user's, we remember the exact position we just set: the
      // event reporting that value is ours, any other one is not.
      // (A time window wouldn't work: it would keep feeding itself.)
      this._progTop = null;
      this._onScroll = () => {
        // Rewriting scrollTop while the user scrolls makes the code fight the
        // browser's inertia: on Safari the page looks pinned and flickers. So
        // while a scroll is under way we stop touching the position, and height
        // corrections above the viewport wait until the scrolling stops.
        const st = this.scroller.scrollTop;
        const now = performance.now();
        const dt = now - this._lastAt;
        // On WebKit scroll events arrive late during inertial scrolling:
        // knowing how fast we're going lets us paint ahead in the direction of
        // travel, so the bare background never shows.
        if (dt > 0 && dt < 400) {
          const v = (st - this._lastTop) / dt;
          this.velocity = this.velocity * 0.4 + v * 0.6;
        }
        this._lastTop = st;
        this._lastAt = now;

        const ours = this._progTop !== null && Math.abs(st - this._progTop) <= 1;
        this._progTop = null;
        if (!ours) {
          this.pinBottom = false;
          this.userScrolling = true;
          clearTimeout(this._idle);
          this._idle = setTimeout(() => {
          this.userScrolling = false;
          this.velocity = 0;
          this.remeasureVisible();     // finger off the screen: check everything again
          this.update();
        }, 140);
        }
        this.schedule();
      };
      this.scroller.addEventListener('scroll', this._onScroll, { passive: true });
      this._onResize = () => { this.resetHeights(); this.update(); };
      global.addEventListener('resize', this._onResize);
    }

    setCount(n) {
      this.count = n;
      const est = new Float64Array(n);
      for (let i = 0; i < n; i++) est[i] = this.estimate(i);
      this.fen = new Fenwick(est);
      // Rows already measured: reading offsetHeight again forces the browser to
      // recompute layout, and that is the heaviest cost in every frame. Once
      // measured a row doesn't change any more, until the width changes or a
      // media file arrives — and in those cases we mark it for measuring again.
      this.measured = new Uint8Array(n);
      this.clear();
      this.applyHeight();
    }

    /** Heights depend on the width: after a resize they have to be redone. */
    resetHeights() {
      for (let i = 0; i < this.count; i++) this.fen.set(i, this.estimate(i));
      this.measured.fill(0);
      this.clear();
    }

    /** Mark the on-screen rows for remeasuring (media just loaded, etc). */
    remeasureVisible() {
      for (const i of this.rendered.keys()) this.measured[i] = 0;
    }

    clear() {
      for (const el of this.rendered.values()) el.remove();
      this.rendered.clear();
    }

    applyHeight() {
      const h = this.fen.total();
      if (h !== this._appliedHeight) {          // writing the style for nothing isn't free
        this._appliedHeight = h;
        this.inner.style.height = h + 'px';
      }
    }

    /** Move the viewport without the move being read as a manual gesture. */
    jump(v) {
      // the browser clamps the value to the maximum scroll available: read the
      // resulting position back, otherwise our own event would look like a user
      // gesture and would release the pin to the bottom
      this.scroller.scrollTop = Math.max(0, Math.round(v));
      this._progTop = this.scroller.scrollTop;
    }

    schedule() {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => { this._raf = 0; this.update(); });
    }

    /** Paint the visible window and realign positions once rows are measured. */
    update() {
      if (!this.count) { this.applyHeight(); return; }
      const s = this.scroller;
      // safety margin: fixed on both sides, widened ahead of us in proportion
      // to the speed (up to a little more than two screenfuls).
      const lead = Math.min(Math.abs(this.velocity) * 320, 2600);
      const up = this.overscan + (this.velocity < 0 ? lead : 0);
      const down = this.overscan + (this.velocity > 0 ? lead : 0);
      const top = Math.max(0, s.scrollTop - up);
      const bottom = s.scrollTop + s.clientHeight + down;

      let first = this.fen.search(top);
      let last = this.fen.search(Math.min(bottom, Math.max(0, this.fen.total() - 1)));
      last = Math.min(this.count - 1, last + 1);

      for (const [i, el] of this.rendered) {
        if (i < first || i > last) { el.remove(); this.rendered.delete(i); }
      }
      const frag = document.createDocumentFragment();
      for (let i = first; i <= last; i++) {
        if (this.rendered.has(i)) continue;
        const el = this.renderRow(i);
        el.dataset.i = i;
        el.style.position = 'absolute';
        el.style.top = '0px';
        el.style.transform = 'translateY(' + this.fen.prefix(i) + 'px)';
        this.rendered.set(i, el);
        frag.appendChild(el);
      }
      if (frag.childNodes.length) this.inner.appendChild(frag);

      // Measure: real heights correct the estimates. The new heights are
      // collected first and applied afterwards in index order, so the prefix
      // sums stay consistent while the scroll compensation is computed.
      const anchorTop = s.scrollTop;
      const anchorIdx = this.fen.search(anchorTop);
      const changes = [];
      for (const [i, el] of this.rendered) {
        if (this.measured[i]) continue;                    // already known
        // above the viewport, with a scroll under way: defer it (see _onScroll)
        if (this.userScrolling && i < anchorIdx) continue;
        const h = el.offsetHeight;
        this.measured[i] = 1;
        if (Math.abs(h - this.fen.get(i)) > 0.5) changes.push([i, h]);
      }
      if (changes.length) {
        changes.sort((a, b) => a[0] - b[0]);
        let shift = 0;
        for (const [i, h] of changes) {
          if (i < anchorIdx) shift += h - this.fen.get(i);
          this.fen.set(i, h);
        }
        for (const [i, el] of this.rendered) {
          el.style.transform = 'translateY(' + this.fen.prefix(i) + 'px)';
        }
        this.applyHeight();
        if (this.pinBottom) this.jump(this.fen.total());
        else if (shift) this.jump(anchorTop + shift);
        this.schedule();                       // second pass to settle
      } else {
        this.applyHeight();
        if (this.pinBottom) {
          const target = Math.max(0, this.fen.total() - s.clientHeight);
          if (Math.abs(s.scrollTop - target) > 1) this.jump(target);
        }
      }

      if (this.onRange) this.onRange(first, last);
    }

    offsetOf(i) { return this.fen.prefix(i); }

    /** Bring a message into view; `align` = 'center' | 'start'. */
    scrollToIndex(i, align) {
      i = Math.max(0, Math.min(this.count - 1, i));
      this.pinBottom = false;
      this.userScrolling = false;          // here the corrections are needed at once
      clearTimeout(this._idle);
      const go = (n) => {
        const off = this.fen.prefix(i);
        const target = align === 'start'
          ? off - 8
          : off - Math.max(0, (this.scroller.clientHeight - this.fen.get(i)) / 2);
        this.jump(target);
        this.update();
        if (n > 0) requestAnimationFrame(() => go(n - 1));
      };
      go(3);       // estimates sharpen with every pass: 3 are enough to get there
    }

    scrollToBottom() {
      this.pinBottom = true;
      this.userScrolling = false;
      this.jump(this.fen.total());
      this.update();
    }

    /** Repaint a row already on screen (e.g. after a media file has loaded). */
    invalidate(i) {
      const el = this.rendered.get(i);
      if (!el) return;
      el.remove();
      this.rendered.delete(i);
      this.measured[i] = 0;
      this.schedule();
    }

    destroy() {
      clearTimeout(this._idle);
      this.scroller.removeEventListener('scroll', this._onScroll);
      global.removeEventListener('resize', this._onResize);
      this.clear();
    }
  }

  global.Virtual = { VirtualList, Fenwick };
})(window);
