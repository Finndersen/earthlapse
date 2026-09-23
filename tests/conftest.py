"""Suite-wide guard for CLAUDE.md's "no live API calls or large downloads in tests": any attempt
to open a non-loopback socket fails the test. Proxy variables are cleared too, since a loopback
proxy would otherwise carry a live request past the check. Fakes (httpx.MockTransport, stubbed fetchers) never
reach a socket, so they are unaffected."""

from __future__ import annotations

import socket
from collections.abc import Iterator

import pytest

_LOOPBACK = {"127.0.0.1", "::1", "localhost"}
_PROXY_VARS = ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy")


@pytest.fixture(autouse=True)
def _no_network(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    real_connect = socket.socket.connect

    def guarded_connect(self: socket.socket, address: object) -> None:
        host = address[0] if isinstance(address, tuple) else address
        if self.family in (socket.AF_INET, socket.AF_INET6) and host not in _LOOPBACK:
            raise RuntimeError(f"test attempted a live network connection to {address!r}")
        return real_connect(self, address)

    for name in _PROXY_VARS:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(socket.socket, "connect", guarded_connect)
    yield
