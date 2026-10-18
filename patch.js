(() => {
  "use strict";

  // Google Flow Region Unlock Patch
  // Intercepts batchexecute response for rpcids=cPZSdc and sets field 30 to true
  const ORIGIN = "https://flow.google.com";
  const PATH = "/_/AiSandboxAngularFrontend/data/batchexecute";
  const RPC = "cPZSdc";
  const FIELD = 30;
  const STATUS = "__flowRegionHelper_v1";

  function isTarget(input, base = ORIGIN) {
    try {
      const url = new URL(input, base);
      return url.origin === ORIGIN && url.pathname === PATH &&
        url.searchParams.get("rpcids") === RPC;
    } catch {
      return false;
    }
  }

  function patchBatch(source) {
    if (typeof source !== "string" || source.length > 4_000_000) {
      throw new Error("Unexpected response size or type");
    }
    const lines = source.split("\n");
    const matches = [];
    for (let index = 0; index < lines.length; index++) {
      if (!lines[index].startsWith("[[")) continue;
      let frame;
      try { frame = JSON.parse(lines[index]); } catch { continue; }
      if (!Array.isArray(frame)) continue;
      for (const row of frame) {
        if (Array.isArray(row) && row[0] === "wrb.fr" && row[1] === RPC) {
          matches.push({index, frame, row});
        }
      }
    }
    if (matches.length !== 1) throw new Error("Expected one config response");
    const {index, frame, row} = matches[0];
    if (typeof row[2] !== "string") throw new Error("Unexpected config encoding");
    const config = JSON.parse(row[2]);
    if (!Array.isArray(config) || config.length < 32 ||
        (config[FIELD] !== null && typeof config[FIELD] !== "boolean")) {
      throw new Error("Unexpected config schema");
    }
    const before = config[FIELD];
    if (before === true) return {body: source, changed: false};

    const oldLine = lines[index].replace(/\r$/, "");
    const lengthLine = lines[index - 1];
    if (typeof lengthLine !== "string" || !/^\d+\r?$/.test(lengthLine)) {
      throw new Error("Missing frame length");
    }
    const oldLength = Number(lengthLine);
    const measures = [text => new TextEncoder().encode(text).length, text => text.length];
    const measure = measures.find(fn => [0, 1, 2].includes(oldLength - fn(oldLine)));
    if (!measure) throw new Error("Unexpected frame length");

    config[FIELD] = true;
    row[2] = JSON.stringify(config);
    const newLine = JSON.stringify(frame);
    lines[index - 1] = String(oldLength + measure(newLine) - measure(oldLine)) +
      (lengthLine.endsWith("\r") ? "\r" : "");
    lines[index] = newLine + (lines[index].endsWith("\r") ? "\r" : "");
    return {body: lines.join("\n"), changed: true};
  }

  if (typeof module === "object" && module.exports) {
    module.exports = {isTarget, patchBatch};
    return;
  }
  if (location.origin !== ORIGIN || Object.hasOwn(window, STATUS)) return;

  const diagnostic = {state: "waiting", changed: 0, matched: 0, detail: ""};
  try {
    Object.defineProperty(window, STATUS, {value: diagnostic, configurable: true, writable: true});
    Object.defineProperty(window, "__unlockFlow_v1", {value: diagnostic, configurable: true, writable: true});
    Object.defineProperty(window, "__flowLocalDiagnostic", {value: diagnostic, configurable: true, writable: true});
  } catch (e) {
    window[STATUS] = diagnostic;
    window.__unlockFlow_v1 = diagnostic;
    window.__flowLocalDiagnostic = diagnostic;
  }

  function transform(source) {
    diagnostic.matched++;
    try {
      const result = patchBatch(source);
      diagnostic.state = result.changed ? "patched" : "already-allowed";
      diagnostic.changed += Number(result.changed);
      diagnostic.detail = "";
      return result.body;
    } catch (error) {
      diagnostic.state = "schema-mismatch";
      diagnostic.detail = String(error.message).slice(0, 120);
      return source;
    }
  }

  const requests = new WeakMap();
  const prototype = XMLHttpRequest.prototype;
  const originalOpen = prototype.open;
  const originalSend = prototype.send;
  prototype.open = function(method, url, ...rest) {
    requests.delete(this);
    const result = Reflect.apply(originalOpen, this, [method, url, ...rest]);
    if (isTarget(url, location.href)) requests.set(this, {done: false});
    return result;
  };
  prototype.send = function(...args) {
    const state = requests.get(this);
    if (state) Object.assign(state, {done: false, body: undefined});
    return Reflect.apply(originalSend, this, args);
  };
  for (const name of ["responseText", "response"]) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
    if (!descriptor?.get || !descriptor.configurable) continue;
    Object.defineProperty(prototype, name, {
      ...descriptor,
      get() {
        const original = Reflect.apply(descriptor.get, this, []);
        const state = requests.get(this);
        if (!state || typeof original !== "string" ||
            (this.responseType !== "" && this.responseType !== "text")) return original;
        if (this.readyState === 3 && this.status >= 200 && this.status < 300) return "";
        if (this.readyState !== 4) return original;
        if (this.status < 200 || this.status >= 300) {
          diagnostic.state = "server-error";
          diagnostic.detail = "HTTP " + this.status;
          return original;
        }
        if (!state.done) {
          state.body = transform(original);
          state.done = true;
        }
        return state.body;
      }
    });
  }

  if (typeof window.fetch === "function") {
    const originalFetch = window.fetch;
    function withMetadata(response, original) {
      const nativeClone = response.clone;
      Object.defineProperties(response, {
        url: {value: original.url},
        redirected: {value: original.redirected},
        type: {value: original.type},
        clone: {value() { return withMetadata(nativeClone.call(this), original); }}
      });
      return response;
    }
    window.fetch = async function(input, init) {
      const response = await Reflect.apply(originalFetch, this, [input, init]);
      const url = typeof input === "string" || input instanceof URL ? input : input?.url;
      if (!isTarget(url, location.href)) return response;
      if (!response.ok) {
        diagnostic.state = "server-error";
        diagnostic.detail = "HTTP " + response.status;
        return response;
      }
      try {
        const original = await response.clone().text();
        const body = transform(original);
        if (body === original) return response;
        const headers = new Headers(response.headers);
        headers.delete("content-length");
        headers.delete("content-encoding");
        return withMetadata(new Response(body, {
          status: response.status, statusText: response.statusText, headers
        }), response);
      } catch {
        diagnostic.state = "read-error";
        diagnostic.detail = "Could not read the config response";
        return response;
      }
    };
  }
})();
