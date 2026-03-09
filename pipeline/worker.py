from __future__ import annotations

import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

from .logging_utils import configure_logging
from .main import build_pipeline
from .settings import load_settings


class _HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        if self.path not in {"/health", "/"}:
            self.send_response(404)
            self.end_headers()
            return

        payload = {
            "status": "ok",
            "service": "swejobs-pipeline-worker",
            "timestamp": time.time(),
        }
        data = json.dumps(payload).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, format: str, *args) -> None:  # noqa: A003
        return


def start_health_server(port: int) -> HTTPServer:
    server = HTTPServer(("0.0.0.0", port), _HealthHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


def main() -> None:
    settings = load_settings()
    configure_logging(settings.log_level)
    pipeline, _ = build_pipeline()

    try:
        # Respect App Service port env if set.
        port = int(os.getenv("WEBSITES_PORT", os.getenv("PORT", "8000")))
    except ValueError:
        port = 8000

    start_health_server(port)
    pipeline.run_poll_forever()


if __name__ == "__main__":
    main()
