// tests/harness/dom-mock.js
// Lightweight, zero-dependency DOM simulator and google.script.run bridge

class MockClassList {
  constructor(element) {
    this.element = element;
    this.classes = new Set();
  }
  _syncFromClassName() {
    this.classes.clear();
    const str = this.element.className || '';
    str.split(/\s+/).filter(Boolean).forEach(c => this.classes.add(c));
  }
  _syncToClassName() {
    this.element.className = Array.from(this.classes).join(' ');
  }
  add(...names) {
    this._syncFromClassName();
    names.forEach(n => this.classes.add(n));
    this._syncToClassName();
  }
  remove(...names) {
    this._syncFromClassName();
    names.forEach(n => this.classes.delete(n));
    this._syncToClassName();
  }
  contains(name) {
    this._syncFromClassName();
    return this.classes.has(name);
  }
  toggle(name, force) {
    this._syncFromClassName();
    let has = this.classes.has(name);
    if (force !== undefined) {
      if (force) this.classes.add(name);
      else this.classes.delete(name);
    } else {
      if (has) this.classes.delete(name);
      else this.classes.add(name);
    }
    this._syncToClassName();
    return this.classes.has(name);
  }
}

class MockElement {
  constructor(tagName = 'div', doc = null) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = doc;
    this.attributes = new Map();
    this.style = {};
    this.children = [];
    this.parentNode = null;
    this.listeners = new Map();
    this.classList = new MockClassList(this);
    this._value = '';
    this._checked = false;
    this._disabled = false;
    this._innerHTML = '';
  }

  get id() { return this.getAttribute('id') || ''; }
  set id(val) { this.setAttribute('id', val); }

  get className() { return this.getAttribute('class') || ''; }
  set className(val) { this.setAttribute('class', val); }

  get value() { return this._value; }
  set value(v) { this._value = String(v != null ? v : ''); }

  get checked() { return !!this._checked; }
  set checked(c) { this._checked = !!c; }

  get disabled() { return !!this._disabled; }
  set disabled(d) { this._disabled = !!d; }

  get innerHTML() { return this._innerHTML; }
  set innerHTML(html) {
    this._innerHTML = String(html != null ? html : '');
    this.children = []; // Clear parsed children on raw HTML assignment
  }

  get textContent() {
    if (this.children.length === 0) return this._innerHTML.replace(/<[^>]+>/g, '');
    return this.children.map(c => c.textContent).join('');
  }
  set textContent(txt) {
    this._innerHTML = String(txt != null ? txt : '');
    this.children = [];
  }

  getAttribute(name) {
    return this.attributes.has(name.toLowerCase()) ? this.attributes.get(name.toLowerCase()) : null;
  }

  setAttribute(name, val) {
    this.attributes.set(name.toLowerCase(), String(val));
  }

  removeAttribute(name) {
    this.attributes.delete(name.toLowerCase());
  }

  hasAttribute(name) {
    return this.attributes.has(name.toLowerCase());
  }

  appendChild(child) {
    if (child.parentNode) {
      child.parentNode.removeChild(child);
    }
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentNode = null;
    }
    return child;
  }

  addEventListener(event, handler) {
    const ev = String(event).toLowerCase();
    if (!this.listeners.has(ev)) this.listeners.set(ev, []);
    this.listeners.get(ev).push(handler);
  }

  removeEventListener(event, handler) {
    const ev = String(event).toLowerCase();
    if (this.listeners.has(ev)) {
      const list = this.listeners.get(ev);
      const idx = list.indexOf(handler);
      if (idx !== -1) list.splice(idx, 1);
    }
  }

  dispatchEvent(event) {
    const evType = typeof event === 'string' ? event.toLowerCase() : String(event && event.type || '').toLowerCase();
    const handlers = this.listeners.get(evType) || [];
    const eventObj = typeof event === 'object' ? event : { type: evType, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    for (const h of handlers) {
      h.call(this, eventObj);
    }
    return !eventObj.defaultPrevented;
  }

  click() {
    this.dispatchEvent('click');
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const results = [];
    const sel = selector.trim();

    function matchNode(node) {
      if (!node) return;
      if (sel.startsWith('#')) {
        if (node.id === sel.slice(1)) results.push(node);
      } else if (sel.startsWith('.')) {
        if (node.classList.contains(sel.slice(1))) results.push(node);
      } else if (sel.includes('[') && sel.includes(']')) {
        const attrMatch = sel.match(/\[([a-zA-Z0-9_-]+)(?:=["']?([^"'\]]+)["']?)?\]/);
        if (attrMatch) {
          const attr = attrMatch[1];
          const expectedVal = attrMatch[2];
          if (node.hasAttribute(attr)) {
            if (expectedVal === undefined || node.getAttribute(attr) === expectedVal) {
              results.push(node);
            }
          }
        }
      } else if (node.tagName && node.tagName.toLowerCase() === sel.toLowerCase()) {
        results.push(node);
      }

      for (const child of node.children) {
        matchNode(child);
      }
    }

    for (const child of this.children) {
      matchNode(child);
    }
    return results;
  }
}

class MockDocument {
  constructor() {
    this.documentElement = new MockElement('html', this);
    this.head = new MockElement('head', this);
    this.body = new MockElement('body', this);
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
    this.listeners = new Map();
  }

  createElement(tag) {
    return new MockElement(tag, this);
  }

  getElementById(id) {
    const cleanId = String(id || '').replace(/^#/, '');
    function search(node) {
      if (!node) return null;
      if (node.id === cleanId) return node;
      for (const child of node.children) {
        const found = search(child);
        if (found) return found;
      }
      return null;
    }
    return search(this.documentElement);
  }

  querySelector(selector) {
    return this.documentElement.querySelector(selector);
  }

  querySelectorAll(selector) {
    return this.documentElement.querySelectorAll(selector);
  }

  addEventListener(event, handler) {
    const ev = String(event).toLowerCase();
    if (!this.listeners.has(ev)) this.listeners.set(ev, []);
    this.listeners.get(ev).push(handler);
  }

  removeEventListener(event, handler) {
    const ev = String(event).toLowerCase();
    if (this.listeners.has(ev)) {
      const list = this.listeners.get(ev);
      const idx = list.indexOf(handler);
      if (idx !== -1) list.splice(idx, 1);
    }
  }

  dispatchEvent(event) {
    const evType = typeof event === 'string' ? event.toLowerCase() : String(event && event.type || '').toLowerCase();
    const handlers = this.listeners.get(evType) || [];
    const eventObj = typeof event === 'object' ? event : { type: evType, target: this };
    for (const h of handlers) {
      h.call(this, eventObj);
    }
  }
}

class MockLocalStorage {
  constructor() {
    this.store = new Map();
  }
  getItem(k) {
    return this.store.has(String(k)) ? this.store.get(String(k)) : null;
  }
  setItem(k, v) {
    this.store.set(String(k), String(v));
  }
  removeItem(k) {
    this.store.delete(String(k));
  }
  clear() {
    this.store.clear();
  }
}

class MockWindow {
  constructor(document = null, backendContext = null) {
    this.document = document || new MockDocument();
    this.window = this;
    this.document.defaultView = this;
    this.localStorage = new MockLocalStorage();
    this.innerWidth = 1920;
    this.innerHeight = 1080;
    this.listeners = new Map();
    this.google = {
      script: {
        run: createGoogleScriptRunProxy(backendContext),
      },
    };
  }

  addEventListener(event, handler) {
    const ev = String(event).toLowerCase();
    if (!this.listeners.has(ev)) this.listeners.set(ev, []);
    this.listeners.get(ev).push(handler);
  }

  removeEventListener(event, handler) {
    const ev = String(event).toLowerCase();
    if (this.listeners.has(ev)) {
      const list = this.listeners.get(ev);
      const idx = list.indexOf(handler);
      if (idx !== -1) list.splice(idx, 1);
    }
  }

  dispatchEvent(event) {
    const evType = typeof event === 'string' ? event.toLowerCase() : String(event && event.type || '').toLowerCase();
    const handlers = this.listeners.get(evType) || [];
    const eventObj = typeof event === 'object' ? event : { type: evType, target: this };
    for (const h of handlers) {
      h.call(this, eventObj);
    }
  }
}

/**
 * Creates a google.script.run proxy that executes backend functions in VM context
 */
function createGoogleScriptRunProxy(backendContext = {}) {
  let successCb = () => {};
  let failureCb = (err) => { console.error('google.script.run uncaught error:', err); };

  const handler = {
    withSuccessHandler(cb) {
      successCb = typeof cb === 'function' ? cb : () => {};
      return proxy;
    },
    withFailureHandler(cb) {
      failureCb = typeof cb === 'function' ? cb : () => {};
      return proxy;
    },
  };

  const proxy = new Proxy(handler, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return function (...args) {
        queueMicrotask(() => {
          try {
            const fn = backendContext[prop];
            if (typeof fn !== 'function') {
              throw new Error(`Google Apps Script API function "${String(prop)}" not found`);
            }
            const res = fn(...args);
            successCb(res);
          } catch (err) {
            failureCb(err);
          }
        });
      };
    },
  });

  return proxy;
}

module.exports = {
  MockElement,
  MockDocument,
  MockWindow,
  MockLocalStorage,
  createGoogleScriptRunProxy,
};
