#!/usr/bin/env python3
"""HTTP shim that adapts Claude Code requests to the GWDG SAIA Anthropic endpoint.

Claude Code sends system or skills content as a message with role "system"
inside the `messages` array. The SAIA /v1/messages endpoint (the vLLM Anthropic
adapter) accepts only `user` and `assistant` roles in `messages` and rejects
such requests with HTTP 400. This shim moves those messages into the top-level
`system` field (the correct place per the Anthropic Messages API), then
forwards the request to SAIA and relays the response back unchanged, including
SSE streaming.

Usage:
    saia_anthropic_shim.py <port-file>
"""

import http.client
import json
import os
import sys
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

# Upstream SAIA endpoint. Override with SAIA_SHIM_UPSTREAM for testing or
# when pointing at another gateway, for example:
#   SAIA_SHIM_UPSTREAM="http://127.0.0.1:9999" saia_anthropic_shim.py port
_upstream = urlparse(os.environ.get("SAIA_SHIM_UPSTREAM", "https://chat-ai.academiccloud.de"))
UPSTREAM_HOST = _upstream.hostname or "chat-ai.academiccloud.de"
UPSTREAM_PORT = _upstream.port or (443 if _upstream.scheme == "https" else 80)
UPSTREAM_SCHEME = _upstream.scheme

# Headers that must not be forwarded verbatim.
HOP_BY_HOP = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailer", "transfer-encoding", "upgrade", "content-length",
    "content-encoding", "host",
}

# SAIA rate-limit headers -> (window, field). The ratelimit-* short forms
# describe the one-minute window; the x-ratelimit-* forms are per window.
RATE_HEADERS = {
    "x-ratelimit-limit-minute": ("minute", "limit"),
    "x-ratelimit-remaining-minute": ("minute", "remaining"),
    "x-ratelimit-limit-hour": ("hour", "limit"),
    "x-ratelimit-remaining-hour": ("hour", "remaining"),
    "x-ratelimit-limit-day": ("day", "limit"),
    "x-ratelimit-remaining-day": ("day", "remaining"),
    "ratelimit-limit": ("minute", "limit"),
    "ratelimit-remaining": ("minute", "remaining"),
    "ratelimit-reset": (None, "reset_seconds"),
}

# Snapshot file for the current quota. Set by the orchestrator via
# SAIA_SHIM_RATELIMIT_FILE; without it the shim does no rate-limit tracking.
_snapshot_path = os.environ.get("SAIA_SHIM_RATELIMIT_FILE", "")
_last_snapshot_write = 0.0


def _rate_limits(headers) -> dict:
    """Extract SAIA rate-limit headers into a small nested dict."""
    windows: dict = {"minute": {}, "hour": {}, "day": {}}
    reset = None
    for key, value in headers:
        spec = RATE_HEADERS.get(key.lower())
        if not spec:
            continue
        window, field = spec
        if window:
            try:
                windows[window][field] = int(value)
            except (TypeError, ValueError):
                pass
        else:
            try:
                reset = int(value)
            except (TypeError, ValueError):
                pass
    out = {w: windows[w] for w in ("minute", "hour", "day") if windows[w]}
    if reset is not None:
        out["reset_seconds"] = reset
    return out


def _write_rate_snapshot(status: int, headers) -> None:
    """Write the current quota to the snapshot file (throttled)."""
    global _last_snapshot_write
    if not _snapshot_path:
        return
    info = _rate_limits(headers)
    if not info:
        return
    now = time.time()
    # Keep 429s immediate; other updates at most every 5 seconds.
    if status != 429 and now - _last_snapshot_write < 5:
        return
    _last_snapshot_write = now

    data = {
        "status": status,
        "last_seen_iso": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        **info,
    }
    if status == 429:
        data["last_429_iso"] = data["last_seen_iso"]
    else:
        # Keep the most recent 429 timestamp across later snapshots so the
        # watcher can detect when the quota recovers.
        try:
            prev = json.loads(Path(_snapshot_path).read_text())
            if prev.get("last_429_iso"):
                data["last_429_iso"] = prev["last_429_iso"]
        except (OSError, json.JSONDecodeError):
            pass
    try:
        tmp = _snapshot_path + ".tmp"
        Path(tmp).write_text(json.dumps(data, indent=2))
        os.replace(tmp, _snapshot_path)
    except OSError:
        pass


def text_of(content) -> str:
    """Return the text of an Anthropic content value (string or block list)."""
    if isinstance(content, str):
        return content
    parts = []
    if isinstance(content, list):
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                parts.append(str(block.get("text", "")))
    return "\n\n".join(p for p in parts if p)


def fix_messages(body: dict) -> dict:
    """Move role:system messages into the top-level system field."""
    messages = body.get("messages") or []
    system_msgs = [m for m in messages if m.get("role") == "system"]
    if not system_msgs:
        return body
    rest = [m for m in messages if m.get("role") != "system"]

    added = "\n\n".join(text_of(m.get("content")) for m in system_msgs)
    system = body.get("system")
    if system is None:
        system = added
    elif isinstance(system, str):
        system = f"{system}\n\n{added}" if added else system
    else:  # list of content blocks
        system = list(system)
        if added:
            system.append({"type": "text", "text": added})

    out = dict(body)
    out["system"] = system
    out["messages"] = rest
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
                    raw = json.dumps(fix_messages(json.loads(raw))).encode()
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

            if UPSTREAM_SCHEME == "https":
                conn = http.client.HTTPSConnection(UPSTREAM_HOST, UPSTREAM_PORT, timeout=900)
            else:
                conn = http.client.HTTPConnection(UPSTREAM_HOST, UPSTREAM_PORT, timeout=900)
            try:
                conn.request(method, self.path, body=raw, headers=headers)
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

            # Track quota before relaying; must never break the response path.
            try:
                _write_rate_snapshot(resp.status, resp.getheaders())
            except Exception:
                pass

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