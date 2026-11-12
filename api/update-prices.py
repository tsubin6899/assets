import json
import re
from concurrent.futures import ThreadPoolExecutor, wait
from http.server import BaseHTTPRequestHandler

from update_prices import bot_exchange_rates, now_iso, open_exchange_rates, quote


class handler(BaseHTTPRequestHandler):
    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            if not 0 < length <= 65536:
                raise ValueError()
            request = json.loads(self.rfile.read(length))
            symbols = set()
            for market in ("TW", "US"):
                rows = request.get(market.lower(), [])
                if not isinstance(rows, list) or len(rows) > 100:
                    raise ValueError()
                for row in rows:
                    code = str(row.get("code", "")).strip().upper()
                    if not re.fullmatch(r"[A-Z0-9][A-Z0-9.^=-]{0,23}", code):
                        raise ValueError()
                    symbols.add((market, code))
        except (ValueError, TypeError, AttributeError):
            return self.send_json(400, {"error": "報價清單格式不正確或超過上限"})

        pool = ThreadPoolExecutor(max_workers=8)
        official = pool.submit(bot_exchange_rates)
        backup = pool.submit(open_exchange_rates)
        jobs = {pool.submit(quote, code, market): (market, code) for market, code in sorted(symbols)}
        done, _ = wait([official, backup, *jobs], timeout=18)
        pool.shutdown(wait=False, cancel_futures=True)
        prices, errors, rates = {}, [], {}
        for future, (market, code) in jobs.items():
            try:
                if future not in done:
                    raise TimeoutError()
                prices[f"{market}:{code}"] = future.result()
            except Exception:
                errors.append({"market": market, "symbol": code, "error": "報價暫時無法取得，保留上次價格"})
        sources = []
        for future, name in ((backup, "open.er-api.com"), (official, "Bank of Taiwan")):
            if future in done:
                try:
                    result = future.result()
                except Exception:
                    continue
                if result:
                    rates.update(result)
                    sources.append(name)
        if not prices and not rates:
            return self.send_json(503, {"error": "即時報價來源暫時無法使用"})
        timestamp = now_iso()
        self.send_json(200, {
            "prices": {"generatedAt": timestamp, "prices": prices, "errors": errors},
            "rates": {"generatedAt": timestamp, "rates": rates, "source": " + ".join(sources)} if rates else {},
        })
