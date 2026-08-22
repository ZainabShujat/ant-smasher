/* Pointer input: normalizes mouse + touch into canvas CSS coordinates and
   reports taps to a callback. Listeners are registered once and can be
   detached with destroy(). */
(function (global) {
  'use strict';

  class Input {
    constructor(canvas, onTap) {
      this.canvas = canvas;
      this.onTap = onTap;
      this._onPointerDown = this._onPointerDown.bind(this);
      this._prevent = (e) => e.preventDefault();

      canvas.addEventListener('pointerdown', this._onPointerDown, { passive: false });
      // Stop iOS Safari from scrolling / zooming the page while playing.
      canvas.addEventListener('touchstart', this._prevent, { passive: false });
      canvas.addEventListener('touchmove', this._prevent, { passive: false });
      document.addEventListener('gesturestart', this._prevent);
      document.addEventListener('contextmenu', this._prevent);
    }

    toCanvas(clientX, clientY) {
      const r = this.canvas.getBoundingClientRect();
      return { x: clientX - r.left, y: clientY - r.top };
    }

    _onPointerDown(e) {
      e.preventDefault();
      const p = this.toCanvas(e.clientX, e.clientY);
      this.onTap(p.x, p.y, e);
    }

    destroy() {
      this.canvas.removeEventListener('pointerdown', this._onPointerDown);
      this.canvas.removeEventListener('touchstart', this._prevent);
      this.canvas.removeEventListener('touchmove', this._prevent);
      document.removeEventListener('gesturestart', this._prevent);
      document.removeEventListener('contextmenu', this._prevent);
    }
  }

  global.Input = Input;
})(window);
