#!/usr/bin/env python3
"""Local static server with cache-busting headers (Safari caches plain http.server aggressively)."""

from __future__ import annotations

import argparse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class ArfHandler(SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        path = self.path.split("?", 1)[0].lower()
        if path.endswith((".html", ".htm", ".js", ".mjs", ".css", ".json", ".pdf")):
            self.send_header("Cache-Control", "no-store, must-revalidate")
            self.send_header("Pragma", "no-cache")
        super().end_headers()

    def log_message(self, format: str, *args) -> None:
        return


def main() -> None:
    p = argparse.ArgumentParser(description="Serve ARF app with no-store cache headers")
    p.add_argument("-p", "--port", type=int, default=8080)
    p.add_argument("-b", "--bind", default="127.0.0.1")
    args = p.parse_args()
    httpd = ThreadingHTTPServer((args.bind, args.port), ArfHandler)
    print(f"Serving http://{args.bind}:{args.port}/  (Cache-Control: no-store for html/js/css/json/pdf)")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
