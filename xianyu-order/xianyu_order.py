"""閒魚指定商品自動下單：你提供商品網址和價格，核對無誤後自動下單到「待付款」。

付款一律由你在手機上完成。本程式不碰付款流程，也不處理驗證碼。

用法：
    python xianyu_order.py --login                       # 第一次使用：登入閒魚
    python xianyu_order.py <網址> <價格>                  # 下單單一商品
    python xianyu_order.py -f orders.txt                  # 依清單逐一下單
    python xianyu_order.py -f orders.txt --check          # 只核對，不下單
    python xianyu_order.py -f orders.txt --watch 60       # 價格還不符的，每 60 秒重查，直到下單成功
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
HOME_URL = "https://www.goofish.com/"
ITEM_URL = "https://www.goofish.com/item?id={id}"

# 頁面出現這些字，視為被風控攔下，暫停等你手動處理
BLOCK_MARKERS = ["非法访问", "请完成验证", "滑动验证", "拖动滑块", "访问被拒绝"]
# 商品頁出現這些字，視為已經買不到
GONE_MARKERS = ["已售出", "已卖出", "宝贝不存在", "已下架", "商品已失效", "卖掉了"]
# 訂單確認頁的應付總額標籤
TOTAL_LABELS = r"(实付款|实付|合计|应付|总计|需付款)"


def log(msg: str) -> None:
    print(f"[{dt.datetime.now():%H:%M:%S}] {msg}", flush=True)


# ---------------------------------------------------------------- 設定


@dataclass
class Config:
    browser_channel: str = "chrome"
    max_shipping: float = 0  # 允許總額比你給的價格多出多少（運費），0 = 只接受包郵
    buy_button_texts: list[str] = field(default_factory=lambda: ["立即购买"])
    submit_button_texts: list[str] = field(default_factory=lambda: ["提交订单", "确认购买", "确认下单"])
    notify: dict = field(default_factory=dict)

    @classmethod
    def load(cls, path: Path) -> "Config":
        if not path.exists():
            return cls()
        return cls(**tomllib.loads(path.read_text(encoding="utf-8")))


@dataclass
class Order:
    url: str
    price: float
    done: bool = False


def parse_order_line(line: str) -> Order | None:
    """一行一筆：網址（或閒魚 App 分享出來的整段文字）＋ 價格，價格寫在最後。"""
    line = line.strip()
    if not line or line.startswith("#"):
        return None
    url = re.search(r"https?://[^\s，,]+", line)
    price = re.search(r"(\d+(?:\.\d+)?)\s*$", line)
    if not url or not price:
        raise ValueError(f"看不懂這一行（需要網址和價格）：{line}")
    return Order(url.group(0), float(price.group(1)))


# ---------------------------------------------------------------- 解析頁面


def parse_price(value) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    m = re.search(r"(\d+(?:\.\d+)?)\s*(万)?", str(value).replace(",", ""))
    if not m:
        return None
    return float(m.group(1)) * (10000 if m.group(2) else 1)


def parse_jsonp(text: str):
    text = text.strip()
    if text.startswith("{"):
        return json.loads(text)
    m = re.match(r"^[\w.$]+\((.*)\)\s*;?$", text, re.S)
    return json.loads(m.group(1)) if m else None


def detail_from_api(payload) -> dict:
    """從商品詳情 API 找 itemDO（價格、標題、狀態）。"""
    item = ((payload or {}).get("data") or {}).get("itemDO") or {}
    return {
        "title": item.get("title"),
        "price": parse_price(item.get("soldPrice")),
        "status": item.get("itemStatus"),  # 0 = 在售
    }


def total_from_text(text: str) -> float | None:
    m = re.search(TOTAL_LABELS + r"[^\d¥￥]{0,12}[¥￥]?\s*(\d+(?:\.\d+)?)", text)
    return float(m.group(2)) if m else None


# ---------------------------------------------------------------- 通知


def _post(url: str, data: bytes | None = None, headers: dict | None = None) -> None:
    urllib.request.urlopen(urllib.request.Request(url, data=data, headers=headers or {}), timeout=10).read()


def notify(cfg: Config, title: str, body: str, url: str = "") -> None:
    log(f"{title}｜{body} {url}".rstrip())
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
            q = urllib.parse.urlencode({"url": url}) if url else ""
            _post(f"{server}/{n['bark_key']}/{urllib.parse.quote(title)}/{urllib.parse.quote(body)}?{q}")
    except Exception as e:  # 通知失敗不影響下單
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
    notify(cfg, "閒魚下單暫停", "出現驗證或風控頁，請到電腦上的瀏覽器手動處理")
    while await is_blocked(page):
        await asyncio.sleep(10)
    log("已解除，繼續")


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


async def read_item(cfg: Config, page: Page, url: str) -> dict:
    """打開商品頁，讀出商品 ID、標題、價格、是否還能買。"""
    api: dict = {}

    async def on_response(resp):
        if "detail" not in resp.url:
            return
        try:
            info = detail_from_api(parse_jsonp(await resp.text()))
        except Exception:
            return
        if info["price"] is not None:
            api.update(info)

    page.on("response", on_response)
    try:
        await page.goto(url, wait_until="domcontentloaded", timeout=45000)
        m = re.search(r"[?&](?:id|itemId)=(\d+)", page.url)
        if m and not page.url.startswith(ITEM_URL.format(id="")):
            # 分享短網址會轉到手機版頁面，改開電腦版商品頁
            api.clear()
            await page.goto(ITEM_URL.format(id=m.group(1)), wait_until="domcontentloaded", timeout=45000)
        try:
            await page.wait_for_load_state("networkidle", timeout=15000)
        except Exception:
            pass
        await page.wait_for_timeout(1000)
        if await is_blocked(page):
            await wait_until_unblocked(cfg, page)
            return await read_item(cfg, page, url)
        text = await page.inner_text("body")
    finally:
        page.remove_listener("response", on_response)

    m = re.search(r"[?&](?:id|itemId)=(\d+)", page.url)
    price = api.get("price")
    if price is None:  # API 沒抓到，就從頁面上第一個 ¥ 金額取價格
        pm = re.search(r"[¥￥]\s*(\d+(?:\.\d+)?)\s*(万)?", text)
        price = float(pm.group(1)) * (10000 if pm.group(2) else 1) if pm else None
    gone = (api.get("status") not in (None, 0)) or any(g in text for g in GONE_MARKERS)
    title = api.get("title") or (await page.title()).replace("_闲鱼", "").strip()
    return {"id": m.group(1) if m else None, "title": title, "price": price, "gone": gone}


async def place_order(cfg: Config, ctx: BrowserContext, page: Page, order: Order) -> str:
    """在已打開的商品頁按購買，核對確認頁總額後提交訂單。回傳結果說明。"""
    pages_before = set(ctx.pages)
    if not await click_first(page, cfg.buy_button_texts):
        return "找不到「立即购买」按鈕（可能需要選規格，或賣家沒開放直接購買）"
    await page.wait_for_timeout(2500)
    new_pages = [p for p in ctx.pages if p not in pages_before]
    confirm = new_pages[-1] if new_pages else page
    await confirm.bring_to_front()
    try:
        await confirm.wait_for_load_state("networkidle", timeout=15000)
    except Exception:
        pass
    if await is_blocked(confirm):
        await wait_until_unblocked(cfg, confirm)

    total = total_from_text(await confirm.inner_text("body"))
    limit = order.price + cfg.max_shipping
    if total is None:
        return "確認頁讀不到應付總額，為了安全沒有提交，請在瀏覽器手動確認"
    if total > limit + 0.001:
        return f"確認頁總額 ¥{total:g} 超過上限 ¥{limit:g}（含運費），沒有提交"
    if not await click_first(confirm, cfg.submit_button_texts, timeout=10000):
        return "找不到「提交订单」按鈕，請在瀏覽器手動完成"
    await confirm.wait_for_timeout(3000)
    return f"OK ¥{total:g}"


async def process(cfg: Config, ctx: BrowserContext, order: Order, check_only: bool) -> bool:
    """處理一筆。回傳 True 表示已結束（下單成功或不用再試）。"""
    page = await ctx.new_page()
    info = await read_item(cfg, page, order.url)
    label = f"{info['title'][:40]}（¥{info['price']:g}）" if info["price"] is not None else info["title"][:40]

    if not info["id"]:
        log(f"✗ 不是閒魚商品頁：{order.url}")
        return True
    if info["gone"]:
        log(f"✗ 已售出或下架：{label}")
        return True
    if info["price"] is None:
        log(f"✗ 讀不到價格，請手動確認：{label}")
        return True
    if info["price"] > order.price + 0.001:
        log(f"… 價格不符：{label}，你設定 ¥{order.price:g}")
        await page.close()
        return False
    if check_only:
        log(f"✓ 核對通過（未下單）：{label}")
        await page.close()
        return True

    log(f"✓ 核對通過，下單：{label}")
    result = await place_order(cfg, ctx, page, order)
    if result.startswith("OK"):
        notify(cfg, "已下單，請用手機付款", f"{info['title'][:40]} {result[3:]}\n閒魚 App →「我的」→「我买到的」→「待付款」", ITEM_URL.format(id=info["id"]))
    else:
        notify(cfg, "下單沒完成，請手動處理", f"{info['title'][:40]}：{result}", ITEM_URL.format(id=info["id"]))
    return True


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


async def run(cfg: Config, orders: list[Order], check_only: bool, watch: int | None) -> None:
    async with async_playwright() as p:
        ctx = await open_context(p, cfg)
        while True:
            for order in [o for o in orders if not o.done]:
                try:
                    order.done = await process(cfg, ctx, order, check_only)
                except Exception as e:
                    log(f"✗ 處理失敗：{order.url}（{e}）")
                    order.done = watch is None
                await asyncio.sleep(random.uniform(2, 5))
            pending = [o for o in orders if not o.done]
            if not pending or watch is None:
                break
            log(f"還有 {len(pending)} 筆價格不符，{watch} 秒後重查（Ctrl+C 結束）")
            await asyncio.sleep(watch + random.uniform(0, watch * 0.3))
        print("全部處理完畢。瀏覽器保持開著方便你檢查，按 Enter 關閉。")
        await asyncio.to_thread(input)
        await ctx.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="閒魚指定商品自動下單")
    ap.add_argument("url", nargs="?", help="商品網址或分享文字")
    ap.add_argument("price", nargs="?", type=float, help="你接受的價格（商品價格不高於這個才下單）")
    ap.add_argument("-f", "--file", help="訂單清單檔，每行：網址 價格")
    ap.add_argument("-c", "--config", default=str(BASE_DIR / "config.toml"))
    ap.add_argument("--check", action="store_true", help="只核對網址與價格，不下單")
    ap.add_argument("--watch", type=int, metavar="秒", help="價格不符的商品每隔幾秒重查，直到符合就下單")
    ap.add_argument("--login", action="store_true", help="開瀏覽器登入閒魚")
    args = ap.parse_args()

    cfg = Config.load(Path(args.config))
    if args.login:
        asyncio.run(login(cfg))
        return

    orders: list[Order] = []
    if args.file:
        for line in Path(args.file).read_text(encoding="utf-8").splitlines():
            if o := parse_order_line(line):
                orders.append(o)
    if args.url:
        if args.price is None:
            sys.exit("請在網址後面加上價格，例如：python xianyu_order.py https://www.goofish.com/item?id=123 1099")
        orders.append(Order(args.url, args.price))
    if not orders:
        ap.print_help()
        sys.exit(1)
    if args.watch is not None and args.watch < 30:
        sys.exit("--watch 請不要小於 30 秒，太頻繁容易被風控")

    try:
        asyncio.run(run(cfg, orders, args.check, args.watch))
    except KeyboardInterrupt:
        log("已停止")


if __name__ == "__main__":
    main()
