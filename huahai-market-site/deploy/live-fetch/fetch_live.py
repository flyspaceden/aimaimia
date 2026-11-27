#!/usr/bin/env python3
"""官网服务器：从物联网服务器内网取回农贸市场公开数据文件（数据契约 v1），校验通过才原子替换。

只用标准库，兼容 Python 3.6。校验不过或取不到时保留旧文件；取消公开的塘的曲线文件会被删除。
用法：fetch_live.py --source http://<内网地址>/market-live/v1/ --host market-live.internal --dest /var/www/huahai-market-live/v1
"""
import argparse
import datetime
import json
import os
import re
import sys
import urllib.request

INDEX_MAX = 262144
POND_MAX = 1048576
TIMEOUT = 10
# 与网页 src/live.ts 的判断保持一致：整串匹配、只认 ASCII 数字（re.fullmatch + re.ASCII）。
ISO = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", re.ASCII)
BASE_CODE = re.compile(r"[a-z0-9]{1,12}", re.ASCII)
POND_CODE = re.compile(r"[a-z0-9]{1,12}-[a-z0-9]{1,12}", re.ASCII)
READING_KEY = re.compile(r"r[0-9]{1,3}", re.ASCII)
POND_FILE = re.compile(r"pond-[a-z0-9]{1,12}-[a-z0-9]{1,12}\.json", re.ASCII)
RANGES = {"24h": 300, "7d": 200, "30d": 200}


def _need(ok, what):
    if not ok:
        raise ValueError(what)


def _keys(obj, keys, what):
    _need(isinstance(obj, dict) and set(obj) == set(keys), what + " 的键不符合契约")


def _code(value, pattern, what):
    _need(isinstance(value, str) and pattern.fullmatch(value) is not None, what + " 不对")
    return value


def _text(value, low, high, what):
    _need(isinstance(value, str) and low <= len(value) <= high, what + " 长度或类型不对")
    try:
        value.encode("utf-8")
    except UnicodeEncodeError:
        raise ValueError(what + " 含非法字符")
    return value


def _number(value, what):
    _need(isinstance(value, (int, float)) and not isinstance(value, bool), what + " 不是数字")
    try:
        as_float = float(value)
    except OverflowError:
        raise ValueError(what + " 超出范围")
    _need(as_float == as_float and as_float not in (float("inf"), float("-inf")), what + " 不是有限数字")
    return value


def _time(value, what):
    _need(isinstance(value, str) and ISO.fullmatch(value) is not None, what + " 时间格式不对")
    try:
        datetime.datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ")
    except ValueError:
        raise ValueError(what + " 不是有效时间")
    return value


def _list(value, low, high, what):
    _need(isinstance(value, list) and low <= len(value) <= high, what + " 数量不对")
    return value


def _coord(value, limit, what):
    if value is None:
        return None
    _need(abs(_number(value, what)) <= limit, what + " 超出范围")
    return value


def clean_index(raw):
    _keys(raw, ("schema", "generated_at", "company", "bases"), "index")
    _need(raw["schema"] == 1 and not isinstance(raw["schema"], bool), "schema 不是 1")
    _time(raw["generated_at"], "generated_at")
    _keys(raw["company"], ("name",), "company")
    _text(raw["company"]["name"], 1, 60, "company.name")
    seen_base, seen_pond = set(), set()
    for base in _list(raw["bases"], 0, 20, "bases"):
        _keys(base, ("code", "name", "province", "city", "district", "address", "lat", "lng", "ponds"), "base")
        _code(base["code"], BASE_CODE, "基地代号")
        _need(base["code"] not in seen_base, "基地代号重复")
        seen_base.add(base["code"])
        _text(base["name"], 1, 60, "base.name")
        for key in ("province", "city", "district"):
            _text(base[key], 0, 30, "base." + key)
        _text(base["address"], 0, 120, "base.address")
        _coord(base["lat"], 90, "lat")
        _coord(base["lng"], 180, "lng")
        for pond in _list(base["ponds"], 1, 50, "ponds"):
            _keys(pond, ("code", "name", "area_value", "area_unit", "readings"), "pond")
            _code(pond["code"], POND_CODE, "塘代号")
            _need(pond["code"] not in seen_pond, "塘代号重复")
            seen_pond.add(pond["code"])
            _text(pond["name"], 1, 60, "pond.name")
            if pond["area_value"] is not None:
                _need(_number(pond["area_value"], "area_value") > 0, "面积须大于 0")
            _text(pond["area_unit"], 0, 10, "area_unit")
            keys = set()
            for reading in _list(pond["readings"], 0, 24, "readings"):
                _keys(reading, ("key", "label", "metric_name", "unit", "value", "observed_at"), "reading")
                _code(reading["key"], READING_KEY, "读数 key")
                _need(reading["key"] not in keys, "读数 key 重复")
                keys.add(reading["key"])
                _text(reading["label"], 1, 40, "label")
                _text(reading["metric_name"], 1, 20, "metric_name")
                _text(reading["unit"], 0, 12, "unit")
                _need((reading["value"] is None) == (reading["observed_at"] is None), "数值与时间须同时为空")
                if reading["value"] is not None:
                    _number(reading["value"], "value")
                    _time(reading["observed_at"], "observed_at")
    return raw


def pond_keys(index):
    return {pond["code"]: {r["key"] for r in pond["readings"]} for base in index["bases"] for pond in base["ponds"]}


def clean_pond(raw, code, keys):
    _keys(raw, ("schema", "generated_at", "pond", "series"), "pond 文件")
    _need(raw["schema"] == 1 and not isinstance(raw["schema"], bool), "schema 不是 1")
    _time(raw["generated_at"], "generated_at")
    _need(raw["pond"] == code, "pond 与文件名不符")
    _keys(raw["series"], tuple(RANGES), "series")
    for name, limit in RANGES.items():
        seen = set()
        for item in _list(raw["series"][name], 0, 24, "series." + name):
            _keys(item, ("key", "points"), "series 项")
            _need(item["key"] in keys, "曲线里出现索引没有的读数")
            _need(item["key"] not in seen, "曲线 key 重复")
            seen.add(item["key"])
            last = None
            for point in _list(item["points"], 0, limit, "points"):
                _need(isinstance(point, list) and len(point) == 2, "点格式不对")
                moment, value = point
                _need(isinstance(moment, (int, float)) and not isinstance(moment, bool)
                      and float(_number(moment, "点时间")).is_integer(), "点时间不是整数")
                _need(last is None or moment > last, "点时间未递增")
                last = moment
                _number(value, "点数值")
    return raw


def _reject_constant(name):
    raise ValueError("出现非法数值 " + name)


def fetch(url, limit, host=None):
    request = urllib.request.Request(url, headers={"Host": host} if host else {})
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        data = response.read(limit + 1)
    if len(data) > limit:
        raise ValueError("文件超过大小上限")
    return json.loads(data.decode("utf-8"), parse_constant=_reject_constant)


def write(dest, name, payload):
    target = os.path.join(dest, name)
    temp = os.path.join(dest, "." + name + ".tmp")
    try:
        with open(temp, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        os.chmod(temp, 0o644)
        os.replace(temp, target)
    finally:
        if os.path.exists(temp):
            os.remove(temp)


def log(text):
    sys.stderr.write(text + "\n")


def run(source, dest, host=None):
    if not os.path.isdir(dest):
        log("目标目录不存在：" + dest)
        return 1
    try:
        index = clean_index(fetch(source + "index.json", INDEX_MAX, host))
    except Exception as error:  # noqa: BLE001 —— 任何失败都保留旧文件
        log("index.json 未更新：" + str(error)[:200])
        return 1
    status = 0
    try:
        write(dest, "index.json", index)
    except Exception as error:  # noqa: BLE001
        log("index.json 写入失败：" + str(error)[:200])
        return 1
    listed = pond_keys(index)
    for code, keys in sorted(listed.items()):
        name = "pond-" + code + ".json"
        try:
            write(dest, name, clean_pond(fetch(source + name, POND_MAX, host), code, keys))
        except Exception as error:  # noqa: BLE001
            log(name + " 未更新：" + str(error)[:200])
            status = 1
    for name in os.listdir(dest):
        path = os.path.join(dest, name)
        if POND_FILE.fullmatch(name) and name[5:-5] not in listed and os.path.isfile(path) and not os.path.islink(path):
            os.remove(path)
    return status


def main(argv=None):
    parser = argparse.ArgumentParser(description="取回农贸市场公开数据文件")
    parser.add_argument("--source", required=True)
    parser.add_argument("--dest", required=True)
    parser.add_argument("--host", default="")
    args = parser.parse_args(argv)
    if not args.source.endswith("/") or not args.source.startswith(("http://", "https://", "file://")):
        log("--source 必须是以 / 结尾的 http(s):// 或 file:// 地址")
        return 2
    return run(args.source, args.dest, args.host or None)


if __name__ == "__main__":
    sys.exit(main())
