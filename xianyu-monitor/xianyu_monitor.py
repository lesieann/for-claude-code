"""閒魚撿漏監控：定時搜尋關鍵字，出現符合條件的新商品就通知，必要時自動下單到「待付款」。

付款一律由你在手機上完成，本程式不會碰付款流程，也不會處理驗證碼。

用法：
    python xianyu_monitor.py --login     # 第一次使用：開瀏覽器讓你登入閒魚
    python xianyu_monitor.py             # 開始監控
    python xianyu_monitor.py --test-notify
"""

from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import json
import random
import re
import sys
import tomllib
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

from playwright.async_api import BrowserContext, Page, async_playwright

BASE_DIR = Path(__file__).resolve().parent
PROFILE_DIR = BASE_DIR / "browser-profile"
STATE_FILE = BASE_DIR / "state.json"
HOME_URL = "https://www.goofish.com/"
SEARCH_URL = "https://www.goofish.com/search?q={q}"
ITEM_URL = "https://www.goofish.com/item?id={id}"

# 頁面出現這些字，視為被風控攔下，暫停等你手動處理
BLOCK_MARKERS = ["非法访问", "请完成验证", "滑动验证", "拖动滑块", "访问被拒绝"]


def log(msg: str) -> None:
    print(f"[{dt.datetime.now():%H:%M:%S}] {msg}", flush=True)


# ---------------------------------------------------------------- 設定與狀態


@dataclass
class Watch:
    keyword: str
    max_price: float | None = None
    min_price: float | None = None
    include: list[str] = field(default_factory=list)  # 標題必須全部包含
    exclude: list[str] = field(default_factory=list)  # 標題包含任一個就略過
    action: str = "open"  # notify / open / order
    order_max_price: float | None = None  # action=order 時，超過這個價格只開頁面不下單

    def match(self, item: "Item") -> bool:
        title = item.title.lower()
        if item.price is None:
            return False
        if self.max_price is not None and item.price > self.max_price:
            return False
        if self.min_price is not None and item.price < self.min_price:
            return False
        if any(w.lower() not in title for w in self.include):
            return False
        if any(w.lower() in title for w in self.exclude):
            return False
        return True


@dataclass
class Config:
    watches: list[Watch]
    interval_min: int = 90
    interval_max: int = 150
    max_orders_per_day: int = 3
    browser_channel: str = "chrome"
    buy_button_texts: list[str] = field(default_factory=lambda: ["立即购买"])
    submit_button_texts: list[str] = field(default_factory=lambda: ["提交订单", "确认购买", "确认下单"])
    notify: dict = field(default_factory=dict)

    @classmethod
    def load(cls, path: Path) -> "Config":
        raw = tomllib.loads(path.read_text(encoding="utf-8"))
        watches = [Watch(**w) for w in raw.pop("watch", [])]
        if not watches:
            sys.exit("設定檔裡沒有任何 [[watch]]")
        for w in watches:
            if w.action not in ("notify", "open", "order"):
                sys.exit(f"「{w.keyword}」的 action 只能是 notify / open / order")
            if w.action == "order" and w.max_price is None and w.order_max_price is None:
                sys.exit(f"「{w.keyword}」設了自動下單，必須設定 max_price 或 order_max_price")
        return cls(watches=watches, **raw)


class State:
    """記錄看過的商品與每日下單數，避免重複通知。"""

    def __init__(self, path: Path):
        self.path = path
        data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
        self.seen: dict[str, list[str]] = data.get("seen", {})
        self.orders: dict[str, int] = data.get("orders", {})

    def save(self) -> None:
        for k, ids in self.seen.items():
            self.seen[k] = ids[-3000:]
        self.path.write_text(json.dumps({"seen": self.seen, "orders": self.orders}, ensure_ascii=False), encoding="utf-8")

    def orders_today(self) -> int:
        return self.orders.get(dt.date.today().isoformat(), 0)

    def add_order(self) -> None:
        today = dt.date.today().isoformat()
        self.orders = {today: self.orders.get(today, 0) + 1}


# ---------------------------------------------------------------- 解析商品


@dataclass
class Item:
    id: str
    title: str
    price: float | None
    area: str = ""

    @property
    def url(self) -> str:
        return ITEM_URL.format(id=self.id)


def parse_price(value) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, list):  # 例如 [{"text": "¥"}, {"text": "1999"}]
        value = "".join(str(p.get("text", "")) if isinstance(p, dict) else str(p) for p in value)
    m = re.search(r"(\d+(?:\.\d+)?)\s*(万)?", str(value).replace(",", ""))
    if not m:
        return None
    return float(m.group(1)) * (10000 if m.group(2) else 1)


def items_from_api(payload) -> list[Item]:
    """從搜尋 API 的 JSON 裡找商品。結構可能改版，所以用遞迴找含 itemId 的節點。"""
    found: dict[str, Item] = {}

    def walk(node):
        if isinstance(node, dict):
            ex = node.get("exContent")
            if isinstance(ex, dict) and ex.get("itemId"):
                args = (node.get("clickParam") or {}).get("args") or {}
                price = parse_price(ex.get("price")) or parse_price(args.get("price"))
                iid = str(ex["itemId"])
                found[iid] = Item(iid, str(ex.get("title") or ex.get("detailParams", {}).get("title", "")), price, str(ex.get("area", "")))
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(payload)
    return list(found.values())


def items_from_dom(links: list[dict]) -> list[Item]:
    found: dict[str, Item] = {}
    for link in links:
        m = re.search(r"[?&]id=(\d+)", link.get("href", ""))
        if not m:
            continue
        text = link.get("text", "")
        pm = re.search(r"¥\s*(\d+(?:\.\d+)?)\s*(万)?", text)
        price = float(pm.group(1)) * (10000 if pm.group(2) else 1) if pm else None
        title = next((ln.strip() for ln in text.splitlines() if len(ln.strip()) > 4), text.strip()[:60])
        found.setdefault(m.group(1), Item(m.group(1), title, price))
    return list(found.values())


def parse_jsonp(text: str):
    text = text.strip()
    if text.startswith("{"):
        return json.loads(text)
    m = re.match(r"^[\w.$]+\((.*)\)\s*;?$", text, re.S)
    return json.loads(m.group(1)) if m else None


# ---------------------------------------------------------------- 通知


def _post(url: str, data: bytes | None = None, headers: dict | None = None) -> None:
    req = urllib.request.Request(url, data=data, headers=headers or {})
    urllib.request.urlopen(req, timeout=10).read()


def notify(cfg: Config, title: str, body: str, url: str = "") -> None:
    log(f"🔔 {title}｜{body} {url}")
    print("\a", end="", flush=True)
    n = cfg.notify
    try:
        if n.get("ntfy_topic"):
            server = n.get("ntfy_server", "https://ntfy.sh").rstrip("/")
            headers = {"Title": urllib.parse.quote(title), "Priority": "high"}
            if url:
                headers["Click"] = url
            _post(f"{server}/{n['ntfy_topic']}", body.encode("utf-8"), headers)
        if n.get("telegram_token") and n.get("telegram_chat_id"):
            data = urllib.parse.urlencode({"chat_id": n["telegram_chat_id"], "text": f"{title}\n{body}\n{url}"}).encode()
            _post(f"https://api.telegram.org/bot{n['telegram_token']}/sendMessage", data)
        if n.get("bark_key"):
            server = n.get("bark_server", "https://api.day.app").rstrip("/")
            q = urllib.parse.urlencode({"url": url, "level": "timeSensitive"}) if url else ""
            _post(f"{server}/{n['bark_key']}/{urllib.parse.quote(title)}/{urllib.parse.quote(body)}?{q}")
    except Exception as e:  # 通知失敗不影響監控
        log(f"通知送出失敗：{e}")


# ---------------------------------------------------------------- 瀏覽器操作


async def is_blocked(page: Page) -> bool:
    if "punish" in page.url or "captcha" in page.url:
        return True
    try:
        text = await page.inner_text("body", timeout=3000)
    except Exception:
        return False
    return any(m in text for m in BLOCK_MARKERS)


async def wait_until_unblocked(cfg: Config, page: Page) -> None:
    notify(cfg, "閒魚監控暫停", "出現驗證或風控頁，請到電腦上的瀏覽器手動處理")
    while await is_blocked(page):
        await asyncio.sleep(15)
    log("已解除，繼續監控")


async def search(page: Page, keyword: str) -> list[Item]:
    api_items: list[Item] = []

    async def on_response(resp):
        if "idlemtopsearch" not in resp.url and "search" not in resp.url.split("?")[0].lower():
            return
        try:
            payload = parse_jsonp(await resp.text())
        except Exception:
            return
        if payload:
            api_items.extend(items_from_api(payload))

    page.on("response", on_response)
    try:
        await page.goto(SEARCH_URL.format(q=urllib.parse.quote(keyword)), wait_until="domcontentloaded", timeout=45000)
        try:
            await page.wait_for_load_state("networkidle", timeout=15000)
        except Exception:
            pass
        await page.wait_for_timeout(1500)
        links = await page.eval_on_selector_all(
            'a[href*="item?id="]', "els => els.map(a => ({href: a.href, text: a.innerText}))"
        )
    finally:
        page.remove_listener("response", on_response)

    merged = {i.id: i for i in items_from_dom(links)}
    merged.update({i.id: i for i in api_items if i.price is not None})  # API 的價格較準確
    return list(merged.values())


async def click_first(page: Page, texts: list[str], timeout: int = 8000) -> bool:
    for t in texts:
        loc = page.get_by_text(t, exact=True).first
        try:
            await loc.wait_for(state="visible", timeout=timeout)
            await loc.click()
            return True
        except Exception:
            continue
    return False


async def place_order(cfg: Config, ctx: BrowserContext, item: Item) -> bool:
    """開商品頁 → 立即購買 → 提交訂單，停在付款前。失敗時保留頁面讓你手動接手。"""
    page = await ctx.new_page()
    await page.goto(item.url, wait_until="domcontentloaded")
    await page.bring_to_front()
    pages_before = set(ctx.pages)
    if not await click_first(page, cfg.buy_button_texts):
        log("找不到購買按鈕（可能已售出，或需要先選規格），請手動處理")
        return False
    await page.wait_for_timeout(2500)
    new_pages = [p for p in ctx.pages if p not in pages_before]
    order_page = new_pages[-1] if new_pages else page
    await order_page.bring_to_front()
    if not await click_first(order_page, cfg.submit_button_texts, timeout=12000):
        log("找不到提交訂單按鈕，請在瀏覽器裡手動完成")
        return False
    await order_page.wait_for_timeout(3000)
    return True


async def handle_hit(cfg: Config, state: State, ctx: BrowserContext, watch: Watch, item: Item) -> None:
    price = f"¥{item.price:g}"
    body = f"{item.title[:40]}  {price} {item.area}".strip()
    action = watch.action
    cap = watch.order_max_price if watch.order_max_price is not None else watch.max_price
    if action == "order":
        if state.orders_today() >= cfg.max_orders_per_day:
            log(f"今天已自動下單 {state.orders_today()} 次，達上限，改為只開頁面")
            action = "open"
        elif cap is not None and item.price > cap:
            action = "open"

    if action == "order":
        notify(cfg, f"【{watch.keyword}】自動下單中", body, item.url)
        if await place_order(cfg, ctx, item):
            state.add_order()
            state.save()
            notify(cfg, "已下單，請用手機付款", f"{body}\n到閒魚 App →「我的」→「我买到的」→「待付款」", item.url)
        else:
            notify(cfg, "自動下單沒成功，請手動處理", body, item.url)
    elif action == "open":
        page = await ctx.new_page()
        await page.goto(item.url, wait_until="domcontentloaded")
        notify(cfg, f"【{watch.keyword}】發現新商品", body, item.url)
    else:
        notify(cfg, f"【{watch.keyword}】發現新商品", body, item.url)


async def open_context(p, cfg: Config) -> BrowserContext:
    kwargs = dict(headless=False, locale="zh-CN", viewport={"width": 1300, "height": 850})
    try:
        return await p.chromium.launch_persistent_context(PROFILE_DIR, channel=cfg.browser_channel, **kwargs)
    except Exception as e:
        log(f"無法用 {cfg.browser_channel} 開啟（{e.__class__.__name__}），改用 Playwright 內建 Chromium")
        return await p.chromium.launch_persistent_context(PROFILE_DIR, **kwargs)


# ---------------------------------------------------------------- 主流程


async def login(cfg: Config) -> None:
    async with async_playwright() as p:
        ctx = await open_context(p, cfg)
        page = ctx.pages[0] if ctx.pages else await ctx.new_page()
        await page.goto(HOME_URL)
        print("請在開啟的瀏覽器裡登入閒魚（建議用手機 App 掃碼），登入完成後回到這裡按 Enter。")
        await asyncio.to_thread(input)
        await ctx.close()
        print("登入狀態已保存在 browser-profile 資料夾。")


async def monitor(cfg: Config) -> None:
    state = State(STATE_FILE)
    async with async_playwright() as p:
        ctx = await open_context(p, cfg)
        page = ctx.pages[0] if ctx.pages else await ctx.new_page()
        log(f"開始監控 {len(cfg.watches)} 個關鍵字，Ctrl+C 結束")
        while True:
            for watch in cfg.watches:
                key = watch.keyword
                try:
                    items = await search(page, key)
                except Exception as e:
                    log(f"「{key}」搜尋失敗：{e}")
                    continue
                if await is_blocked(page):
                    await wait_until_unblocked(cfg, page)
                    continue
                if not items:
                    log(f"「{key}」沒抓到任何商品，可能沒登入或頁面改版")
                    continue

                first_time = key not in state.seen
                seen = set(state.seen.setdefault(key, []))
                new_items = [i for i in items if i.id not in seen]
                state.seen[key].extend(i.id for i in new_items)
                state.save()
                if first_time:
                    log(f"「{key}」首次執行，記下目前 {len(items)} 件為基準，之後只通知新上架")
                    continue

                hits = [i for i in new_items if watch.match(i)]
                log(f"「{key}」共 {len(items)} 件，新出現 {len(new_items)} 件，符合條件 {len(hits)} 件")
                for item in sorted(hits, key=lambda i: i.price):
                    await handle_hit(cfg, state, ctx, watch, item)
                await asyncio.sleep(random.uniform(5, 15))

            wait = random.uniform(cfg.interval_min, cfg.interval_max)
            log(f"本輪結束，{wait:.0f} 秒後再查")
            await asyncio.sleep(wait)


def main() -> None:
    ap = argparse.ArgumentParser(description="閒魚撿漏監控")
    ap.add_argument("-c", "--config", default=str(BASE_DIR / "config.toml"))
    ap.add_argument("--login", action="store_true", help="開瀏覽器登入閒魚")
    ap.add_argument("--test-notify", action="store_true", help="送一則測試通知")
    args = ap.parse_args()

    path = Path(args.config)
    if not path.exists():
        sys.exit(f"找不到設定檔 {path}，請先複製 config.example.toml 成 config.toml 再修改")
    cfg = Config.load(path)
    if cfg.interval_min < 30:
        sys.exit("interval_min 請不要小於 30 秒，太頻繁容易被風控")

    if args.test_notify:
        notify(cfg, "閒魚監控測試", "收到這則就代表通知設定正確", HOME_URL)
    elif args.login:
        asyncio.run(login(cfg))
    else:
        try:
            asyncio.run(monitor(cfg))
        except KeyboardInterrupt:
            log("已停止")


if __name__ == "__main__":
    main()
