#!/usr/bin/env python3
"""Double-click launcher: serve this checkout on an OS-assigned local port."""
import functools
import webbrowser
from http.server import ThreadingHTTPServer
from serve import Handler, ROOT

server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=ROOT))
server.daemon_threads = True
url = f'http://127.0.0.1:{server.server_port}/index.html'
print(f'试玩入口：{url}\n关闭此终端或按 Ctrl+C 停止试玩服务器。', flush=True)
webbrowser.open(url)
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    server.server_close()
