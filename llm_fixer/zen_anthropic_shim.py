#!/usr/bin/env python3
"""HTTP shim that adapts Claude Code requests to the OpenCode Zen endpoint.

Claude Code sends the SDK-only body fields such as context_management.
The OpenCode Zen upstream validates request bodies strictly and rejects
unknown fields with HTTP 400 "Extra inputs are not permitted". This shim
removes the unsupported top-level fields, then forwards the request to Zen
and relays the response back unchanged, including SSE streaming.

Usage:
    zen_anthropic_shim.py <port-file>

Environment:
    ZEN_SHIM_UPSTREAM    base URL to forward to (default https://opencode.ai/zen)
    ZEN_SHIM_STRIP_KEYS  comma-separated top-level body keys to remove
                         (default context_management)
"""

import http.client
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

_upstream = urlparse(os.environ.get("ZEN_SHIM_UPSTREAM", "https://opencode.ai/zen"))
UPSTREAM_HOST = _upstream.hostname or "opencode.ai"
UPSTREAM_PORT = _upstream.port or (443 if _upstream.scheme == "https" else 80)
UPSTREAM_SCHEME = _upstream.scheme
# Path component of the upstream base (for example /zen), prepended to the
# incoming request path so /v1/messages lands on /zen/v1/messages.
UPSTREAM_PATH = (_upstream.path or "").rstrip("/")

STRIP_KEYS = [k.strip() for k in
              os.environ.get("ZEN_SHIM_STRIP_KEYS",
                             "context_management").split(",") if k.strip()]

# Headers that must not be forwarded verbatim.
HOP_BY_HOP = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailer", "transfer-encoding", "upgrade", "content-length",
    "content-encoding", "host",
}


def strip_unsupported(body: dict) -> dict:
    """Remove the top-level fields the Zen upstream rejects."""
    if not STRIP_KEYS:
        return body
    out = dict(body)
    for key in STRIP_KEYS:
        out.pop(key, None)
    return out


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _relay(self, method: str):
        try:
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length) if length else b""

            # Rewrite only the Anthropic messages endpoint.
            if method == "POST" and "/v1/messages" in self.path:
                try:
                    raw = json.dumps(strip_unsupported(json.loads(raw))).encode()
                except (json.JSONDecodeError, TypeError):
                    pass  # forward as-is; the upstream will produce the error

            headers = {}
            for k, v in self.headers.items():
                if k.lower() in HOP_BY_HOP:
                    continue
                if k.lower() == "accept-encoding":
                    continue
                headers[k] = v
            headers["Accept-Encoding"] = "identity"
            headers["Host"] = UPSTREAM_HOST
            zen_key = os.environ.get("OPENCODE_ZEN_API_KEY", "").strip()
            if zen_key:
                headers["x-api-key"] = zen_key

            if UPSTREAM_SCHEME == "https":
                conn = http.client.HTTPSConnection(UPSTREAM_HOST, UPSTREAM_PORT, timeout=900)
            else:
                conn = http.client.HTTPConnection(UPSTREAM_HOST, UPSTREAM_PORT, timeout=900)
            try:
                conn.request(method, UPSTREAM_PATH + self.path, body=raw, headers=headers)
                resp = conn.getresponse()
            except OSError as e:
                self.send_response(502)
                self.send_header("Content-Type", "text/plain")
                payload = f"shim upstream error: {e}".encode()
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
                self.wfile.flush()
                return

            self.send_response(resp.status)
            for k, v in resp.getheaders():
                if k.lower() in HOP_BY_HOP:
                    continue
                self.send_header(k, v)
            self.send_header("Transfer-Encoding", "chunked")
            self.end_headers()

            try:
                while True:
                    chunk = resp.read(65536)
                    if not chunk:
                        break
                    self.wfile.write(f"{len(chunk):x}\r\n".encode() + chunk + b"\r\n")
                    self.wfile.flush()
                self.wfile.write(b"0\r\n\r\n")
                self.wfile.flush()
            finally:
                conn.close()
        except (BrokenPipeError, ConnectionError, OSError):
            pass  # client went away; nothing to relay

    def do_GET(self):
        self._relay("GET")

    def do_POST(self):
        self._relay("POST")

    def do_DELETE(self):
        self._relay("DELETE")

    def log_message(self, *args):
        pass


def main() -> None:
    port_file = sys.argv[1] if len(sys.argv) > 1 else "port"
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    Path(port_file).write_text(str(server.server_address[1]))
    server.serve_forever()


if __name__ == "__main__":
    main()