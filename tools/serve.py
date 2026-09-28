#!/usr/bin/env python3
"""Threading static server for the game.

`python -m http.server` is single-threaded. One stalled keep-alive connection —
which is exactly what a force-killed headless browser leaves behind — blocks the
whole server, so the *next* page load hangs forever on the loading screen with
the progress bar stuck at 1%. This version handles every request on its own
thread, and sends no-store headers so a refresh always gets the current build
instead of a stale cached module.

Usage:  python3 tools/serve.py [port]        (default port 8765)
"""
import functools
import os
import sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # never let the browser reuse a stale module across edits
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, *args):
        pass          # keep the task output clean


Handler.extensions_map['.js'] = 'text/javascript'
Handler.extensions_map['.mjs'] = 'text/javascript'
Handler.extensions_map['.wasm'] = 'application/wasm'

if __name__ == '__main__':
    srv = ThreadingHTTPServer(('127.0.0.1', PORT),
                              functools.partial(Handler, directory=ROOT))
    srv.daemon_threads = True
    print(f'serving {ROOT} at http://127.0.0.1:{PORT}/index.html', flush=True)
    srv.serve_forever()
