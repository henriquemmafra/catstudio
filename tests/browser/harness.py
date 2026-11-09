"""Utilitários para os testes de navegador: sobe o CatStudio headless (Xvfb) e controla o Chrome."""
from __future__ import annotations
import os, shutil, socket, subprocess, sys, time, signal, contextlib

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DATA = os.path.join(ROOT, "tests", ".data")
OUT = os.path.join(ROOT, "tests", ".out")
PY = os.environ.get("CATSTUDIO_PYTHON", sys.executable)
CHROME = os.environ.get("CHROME") or ("/usr/bin/google-chrome" if os.path.exists("/usr/bin/google-chrome") else None)


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@contextlib.contextmanager
def server(*extra, port=None):
    port = port or free_port()
    os.makedirs(OUT, exist_ok=True)
    log = open(os.path.join(OUT, f"server-{port}.log"), "w")
    cmd = [PY, "-m", "catstudio", "--port", str(port), "--no-browser", "--verbose", *extra]
    if os.name != "nt" and shutil.which("xvfb-run") and not os.environ.get("DISPLAY"):
        cmd = ["xvfb-run", "-a", "-s", "-screen 0 1920x1200x24", *cmd]      # Linux sem tela
    kw = {"start_new_session": True} if os.name != "nt" else {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP}
    p = subprocess.Popen(cmd, stdout=log, stderr=subprocess.STDOUT, **kw)
    try:
        t0 = time.time()
        while time.time() - t0 < 120:
            with contextlib.suppress(OSError):
                socket.create_connection(("127.0.0.1", port), timeout=1).close()
                break
            if p.poll() is not None:
                raise RuntimeError("servidor encerrou: ver " + log.name)
            time.sleep(0.5)
        yield f"http://127.0.0.1:{port}/"
    finally:
        if os.name == "nt":
            p.terminate()
        else:
            os.killpg(p.pid, signal.SIGTERM)
        with contextlib.suppress(Exception):
            p.wait(10)
        log.close()


def wait_state(page, expr, timeout=60000):
    page.wait_for_function(f"() => {{ try {{ const s = window.trame.state; return !!({expr}); }} catch (e) {{ return false; }} }}",
                           timeout=timeout)


def state(page, key):
    return page.evaluate(f"() => window.trame.state.get('{key}')")
