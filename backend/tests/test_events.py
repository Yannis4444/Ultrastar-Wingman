from typing import cast

from fastapi import WebSocket
from fastapi.testclient import TestClient

from ultrastar_wingman.app import create_app
from ultrastar_wingman.config import BootstrapSettings
from ultrastar_wingman.events import EventBus, SettingChanged


class FakeSocket:
    """Minimal stand-in for a WebSocket; `dead` makes every send fail."""

    def __init__(self, dead: bool = False) -> None:
        self.dead = dead
        self.sent: list[dict[str, object]] = []

    async def accept(self) -> None:
        return None

    async def send_json(self, message: dict[str, object]) -> None:
        if self.dead:
            raise RuntimeError("socket is gone")
        self.sent.append(message)


async def test_broadcast_reaches_every_connection() -> None:
    bus = EventBus()
    sockets = [FakeSocket(), FakeSocket()]
    for socket in sockets:
        await bus.connect(cast(WebSocket, socket))

    await bus.broadcast(SettingChanged(key="usdb.username", value="singer"))

    expected = {"event": "setting.changed", "key": "usdb.username", "value": "singer"}
    assert [socket.sent for socket in sockets] == [[expected], [expected]]


async def test_a_dead_socket_is_dropped_without_breaking_the_broadcast() -> None:
    bus = EventBus()
    dead, alive = FakeSocket(dead=True), FakeSocket()
    await bus.connect(cast(WebSocket, dead))
    await bus.connect(cast(WebSocket, alive))

    await bus.broadcast(SettingChanged(key="usdb.username", value="singer"))

    assert len(alive.sent) == 1
    assert bus.connection_count == 1

    # The dead socket is gone for good, the live one keeps receiving.
    await bus.broadcast(SettingChanged(key="usdb.username", value="other"))
    assert len(alive.sent) == 2


async def test_disconnect_removes_the_connection() -> None:
    bus = EventBus()
    socket = FakeSocket()
    await bus.connect(cast(WebSocket, socket))
    bus.disconnect(cast(WebSocket, socket))
    assert bus.connection_count == 0


def test_websocket_endpoint_delivers_events(bootstrap_settings: BootstrapSettings) -> None:
    # TestClient (sync) instead of httpx: it is the only websocket client in the dependency set.
    app = create_app(bootstrap_settings)
    with TestClient(app) as client, client.websocket_connect("/api/v1/ws") as websocket:
        assert websocket.receive_json()["event"] == "server.ready"

        # A client message must be ignored, not crash the endpoint.
        websocket.send_text("hello?")

        response = client.patch("/api/v1/settings/usdb.username", json={"value": "singer"})
        assert response.status_code == 200
        # The startup library scan may report in between; skip whatever it sends.
        message = websocket.receive_json()
        while message["event"].startswith("songs."):
            message = websocket.receive_json()
        assert message == {
            "event": "setting.changed",
            "key": "usdb.username",
            "value": "singer",
        }
