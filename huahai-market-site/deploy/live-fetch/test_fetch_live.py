"""取回脚本测试：python3 -m unittest discover -s deploy/live-fetch -p 'test_*.py'（在 huahai-market-site 目录下）。"""
import copy
import http.server
import json
import os
import pathlib
import stat
import sys
import tempfile
import threading
import unittest

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import fetch_live  # noqa: E402

FIXTURES = HERE.parent.parent / "tests" / "fixtures" / "live-v1"
INDEX = json.loads((FIXTURES / "index.json").read_text(encoding="utf-8"))
POND = json.loads((FIXTURES / "pond-yx-00.json").read_text(encoding="utf-8"))


class FetchLiveTest(unittest.TestCase):
    def setUp(self):
        self._src = tempfile.TemporaryDirectory()
        self._dest = tempfile.TemporaryDirectory()
        self.src, self.dest = pathlib.Path(self._src.name), pathlib.Path(self._dest.name)
        self.source = self.src.as_uri() + "/"
        self.put("index.json", INDEX)
        self.put("pond-yx-00.json", POND)

    def tearDown(self):
        self._src.cleanup()
        self._dest.cleanup()

    def put(self, name, payload):
        text = payload if isinstance(payload, str) else json.dumps(payload, ensure_ascii=False)
        (self.src / name).write_text(text, encoding="utf-8")

    def run_once(self):
        return fetch_live.run(self.source, str(self.dest))

    def snapshot(self):
        return {p.name: p.read_bytes() for p in self.dest.iterdir()}

    def test_ok_writes_cleaned_files(self):
        self.assertEqual(self.run_once(), 0)
        self.assertEqual(json.loads((self.dest / "index.json").read_text(encoding="utf-8")), INDEX)
        self.assertEqual(json.loads((self.dest / "pond-yx-00.json").read_text(encoding="utf-8")), POND)
        self.assertEqual(sorted(p.name for p in self.dest.iterdir()), ["index.json", "pond-yx-00.json"])
        for path in self.dest.iterdir():
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o644)

    def test_index_extra_key_rejected_keeps_old(self):
        self.assertEqual(self.run_once(), 0)
        before = self.snapshot()
        bad = copy.deepcopy(INDEX)
        bad["bases"][0]["manager"] = "张三"
        self.put("index.json", bad)
        self.assertEqual(self.run_once(), 1)
        self.assertEqual(self.snapshot(), before)

    def test_reading_extra_key_rejected(self):
        bad = copy.deepcopy(INDEX)
        bad["bases"][0]["ponds"][0]["readings"][0]["device_sn"] = "SN1"
        with self.assertRaises(ValueError):
            fetch_live.clean_index(bad)

    def test_contract_violations(self):
        def mutate(fn):
            raw = copy.deepcopy(INDEX)
            fn(raw)
            return raw
        reading = lambda raw: raw["bases"][0]["ponds"][0]["readings"][0]  # noqa: E731
        cases = [
            mutate(lambda r: r.update(schema=2)),
            mutate(lambda r: r.update(generated_at="2026-11-26T06:35:00")),
            mutate(lambda r: r["bases"][0]["ponds"][0].update(code="YX-00")),
            mutate(lambda r: reading(r).update(value="6.8")),
            mutate(lambda r: reading(r).update(observed_at=None)),
            mutate(lambda r: r["bases"][0]["ponds"][0].update(readings=[dict(reading(r), key="r%d" % i) for i in range(25)])),
            mutate(lambda r: r["bases"].append(copy.deepcopy(r["bases"][0]))),
            mutate(lambda r: reading(r).update(value=True)),
        ]
        for raw in cases:
            with self.assertRaises(ValueError):
                fetch_live.clean_index(raw)

    def test_truncated_and_oversize_index(self):
        self.assertEqual(self.run_once(), 0)
        before = self.snapshot()
        self.put("index.json", '{"schema":1,')
        self.assertEqual(self.run_once(), 1)
        self.put("index.json", " " * (fetch_live.INDEX_MAX + 1))
        self.assertEqual(self.run_once(), 1)
        self.assertEqual(self.snapshot(), before)

    def test_bad_pond_keeps_old_pond_but_updates_index(self):
        self.assertEqual(self.run_once(), 0)
        old_pond = (self.dest / "pond-yx-00.json").read_bytes()
        new_index = dict(INDEX, generated_at="2026-11-26T06:40:00Z")
        self.put("index.json", new_index)
        bad = copy.deepcopy(POND)
        first = bad["series"]["24h"][0]["points"][0][0]
        bad["series"]["24h"][0]["points"] = [[first + i, 1.0] for i in range(301)]
        self.put("pond-yx-00.json", bad)
        self.assertEqual(self.run_once(), 1)
        self.assertEqual(json.loads((self.dest / "index.json").read_text(encoding="utf-8"))["generated_at"], "2026-11-26T06:40:00Z")
        self.assertEqual((self.dest / "pond-yx-00.json").read_bytes(), old_pond)

    def test_pond_series_unknown_key_rejected(self):
        bad = copy.deepcopy(POND)
        bad["series"]["7d"][0]["key"] = "r9"
        with self.assertRaises(ValueError):
            fetch_live.clean_pond(bad, "yx-00", fetch_live.pond_keys(INDEX)["yx-00"])

    def test_pond_missing_is_reported(self):
        (self.src / "pond-yx-00.json").unlink()
        self.assertEqual(self.run_once(), 1)
        self.assertTrue((self.dest / "index.json").exists())

    def test_unpublished_pond_file_removed(self):
        (self.dest / "pond-yx-07.json").write_text("{}", encoding="utf-8")
        (self.dest / "notes.txt").write_text("x", encoding="utf-8")
        self.assertEqual(self.run_once(), 0)
        self.assertEqual(sorted(p.name for p in self.dest.iterdir()), ["index.json", "notes.txt", "pond-yx-00.json"])

    def test_dest_missing(self):
        missing = self.dest / "nope"
        self.assertEqual(fetch_live.run(self.source, str(missing)), 1)
        self.assertFalse(missing.exists())

    def test_nan_rejected(self):
        self.put("index.json", json.dumps(INDEX).replace("6.82", "NaN", 1))
        self.assertEqual(self.run_once(), 1)
        self.put("index.json", json.dumps(INDEX).replace("6.82", "Infinity", 1))
        self.assertEqual(self.run_once(), 1)

    def test_host_header_sent(self):
        hosts, root = [], self.src

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):  # noqa: N802
                hosts.append(self.headers.get("Host"))
                path = root / self.path.split("/")[-1]
                body = path.read_bytes() if path.exists() else b""
                self.send_response(200 if body else 404)
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *args):
                pass

        server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            url = "http://127.0.0.1:%d/market-live/v1/" % server.server_address[1]
            self.assertEqual(fetch_live.run(url, str(self.dest), host="market-live.internal"), 0)
        finally:
            server.shutdown()
            server.server_close()
        self.assertEqual(set(hosts), {"market-live.internal"})
        self.assertEqual(len(hosts), 2)


if __name__ == "__main__":
    unittest.main()
