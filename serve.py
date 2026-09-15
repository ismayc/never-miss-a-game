#!/usr/bin/env python3
"""Serve the preferences form on this machine, with a button that runs the tool.

    python3 serve.py              # serves this folder on 127.0.0.1, opens the form
    python3 serve.py --no-browser --port 8765

The form (`preferences-editor.html`) works from a double-click already: it opens
`preferences.json` through the browser's file picker and writes it back. What a
page opened from disk cannot do is run a program. Served from here, the same
page shows one more button, "Read this week's schedules", which POSTs to /read;
this script runs `node read-schedules.mjs` and hands the output back to the page.
That is the whole idea: a small HTML page as the front end over a command-line
tool, so the command is never typed by hand.

Nothing about the agent changes. It still reads `preferences.json` and runs the
tool itself; this server is for the person, not the agent, and is never on when
the agent runs unattended.

Loopback only. The page may choose the time zone and the number of days; both
are checked before they reach the command line, and nothing else from the page
reaches it. Stdlib only. Ctrl-C to stop.
"""
import argparse
import http.server
import json
import os
import re
import socketserver
import subprocess
import sys
import time
import urllib.parse
import webbrowser

HERE = os.path.dirname(os.path.abspath(__file__))
PAGE = 'preferences-editor.html'
PORTS = range(8765, 8775)

#: IANA zone names look like Area/City, with underscores, hyphens, plus signs and
#: digits allowed in the parts (America/Phoenix, America/Argentina/Buenos_Aires,
#: Etc/GMT+5). Anything else is refused rather than passed to the command line.
ZONE = re.compile(r'^[A-Za-z_]+(?:/[A-Za-z0-9_+\-]+){1,2}$')


def read_schedules(tz=None, days=7):
    """Run the tool exactly as the policy does, plus --all so every game shows."""
    cmd = ['node', os.path.join(HERE, 'read-schedules.mjs'), '--days', str(days)]
    if tz:
        cmd += ['--tz', tz]
    cmd += ['--prefs', os.path.join(HERE, 'preferences.json'), '--all']
    t0 = time.time()
    r = subprocess.run(cmd, cwd=HERE, capture_output=True, text=True, timeout=60)
    return {'ok': r.returncode == 0, 'output': r.stdout, 'error': r.stderr.strip(),
            'seconds': round(time.time() - t0, 2), 'command': ' '.join(
                'read-schedules.mjs' if c.endswith('read-schedules.mjs')
                else 'preferences.json' if c.endswith('preferences.json') else c
                for c in cmd)}


def handler_for(log):
    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=HERE, **k)

        def end_headers(self):
            self.send_header('Cache-Control', 'no-store')
            super().end_headers()

        def _json(self, obj, code=200):
            blob = json.dumps(obj).encode('utf-8')
            self.send_response(code)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(blob)))
            self.end_headers()
            self.wfile.write(blob)

        def do_POST(self):
            if self.path.split('?')[0] != '/read':
                self.send_error(404)
                return
            try:
                n = int(self.headers.get('Content-Length', 0))
                data = json.loads(self.rfile.read(n).decode('utf-8') or '{}')
                tz = (data.get('tz') or '').strip() or None
                if tz and not ZONE.match(tz):
                    raise ValueError('not a time zone name: %r' % tz)
                days = int(data.get('days') or 7)
                if not 1 <= days <= 31:
                    raise ValueError('days must be 1 to 31, got %d' % days)
                out = read_schedules(tz, days)
                log('  read: %s in %.2fs%s' % ('ok' if out['ok'] else 'FAILED',
                                               out['seconds'],
                                               '' if out['ok'] else ' ' + out['error'][:200]))
                self._json(out)
            except Exception as exc:                        # report, do not die
                log('  READ FAILED: %s' % exc)
                self._json({'ok': False, 'error': str(exc)}, 500)

        def log_message(self, *a):
            pass

    return Handler


def serve(port=None, open_browser=True):
    log = lambda m: print(m, flush=True)               # noqa: E731
    httpd = None
    for p in ([port] if port else PORTS):
        try:
            socketserver.TCPServer.allow_reuse_address = True
            httpd = socketserver.TCPServer(('127.0.0.1', p), handler_for(log))
            port = p
            break
        except OSError:
            continue
    if httpd is None:
        sys.exit('no free port in %d-%d' % (PORTS[0], PORTS[-1]))
    url = 'http://127.0.0.1:%d/%s' % (port, urllib.parse.quote(PAGE))
    log('serving %s' % HERE)
    log('    %s' % url)
    log('The form now has a "Read this week\'s schedules" button. Ctrl-C to stop.')
    if open_browser:
        try:
            webbrowser.open(url)
        except Exception:
            pass
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\nstopped')
    finally:
        httpd.server_close()


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--port', type=int, default=None,
                    help='pin the port (default: first free in %d-%d)' % (PORTS[0], PORTS[-1]))
    ap.add_argument('--no-browser', action='store_true', help='do not open a tab')
    a = ap.parse_args(argv)
    serve(port=a.port, open_browser=not a.no_browser)


if __name__ == '__main__':
    main()
