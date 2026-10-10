"""gunicorn.conf.py reads its ports defensively: a Kubernetes service link fails with its cause named."""

import pathlib
import runpy

import pytest

CONF = pathlib.Path(__file__).resolve().parents[1] / "gunicorn.conf.py"


def test_default_ports(monkeypatch):
    monkeypatch.delenv("PLIEGO_PORT", raising=False)
    monkeypatch.delenv("PLIEGO_METRICS_PORT", raising=False)
    conf = runpy.run_path(str(CONF))
    assert conf["bind"] == ["0.0.0.0:8000", "0.0.0.0:9090"]


def test_service_link_names_the_cause(monkeypatch):
    # What Kubernetes injected on the first deploy for the Service `pliego` (enableServiceLinks defaulted to true).
    monkeypatch.setenv("PLIEGO_PORT", "tcp://10.43.108.14:80")
    with pytest.raises(SystemExit, match="service link"):
        runpy.run_path(str(CONF))
