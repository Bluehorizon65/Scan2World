import pytest
from fastapi.testclient import TestClient

from s2w_common.app import create_app
from s2w_common.storage import resolve_key


@pytest.fixture(autouse=True)
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("SERVICE_TOKEN", "secret")
    return tmp_path


@pytest.mark.parametrize("key", ["../x", "/etc/passwd", "a/../../b", "", "a\x00b", "a//b"])
def test_resolve_key_rejects_traversal(key):
    with pytest.raises(ValueError):
        resolve_key(key)


def test_resolve_key_resolves_under_data_dir(env):
    assert resolve_key("projects/p/a.jpg") == env / "projects/p/a.jpg"


def _client():
    app = create_app("test")

    @app.get("/thing")
    def thing():
        return {"ok": True}

    return TestClient(app)


def test_health_requires_no_token():
    r = _client().get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "service": "test"}


def test_other_routes_require_token():
    c = _client()
    assert c.get("/thing").status_code == 401
    assert c.get("/thing", headers={"X-Service-Token": "wrong"}).status_code == 401
    assert c.get("/thing", headers={"X-Service-Token": "secret"}).json() == {"ok": True}


def test_errors_are_structured_without_traceback():
    app = create_app("test")

    @app.get("/boom")
    def boom():
        raise RuntimeError("/secret/internal/path exploded")

    r = TestClient(app, raise_server_exceptions=False).get("/boom", headers={"X-Service-Token": "secret"})
    assert r.status_code == 500
    assert r.json() == {"error": {"code": "internal_error", "message": "Internal processing error"}}
