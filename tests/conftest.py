import json
import os
import subprocess
import sys

import pytest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DATA = os.path.join(ROOT, "tests", ".data")
sys.path.insert(0, os.path.join(ROOT, "tests", "fixtures"))


def pytest_sessionstart(session):
    """Gera os dados sintéticos se ainda não existirem."""
    if not os.path.isfile(os.path.join(DATA, "manifest.json")):
        subprocess.check_call([sys.executable, os.path.join(ROOT, "tests", "fixtures", "make_fixtures.py"), DATA])


@pytest.fixture(scope="session")
def data_dir():
    return DATA


@pytest.fixture(scope="session")
def manifest():
    with open(os.path.join(DATA, "manifest.json")) as f:
        return json.load(f)
