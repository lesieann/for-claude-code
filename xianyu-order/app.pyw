"""閒魚下單工具的視窗介面。雙擊「開始.bat」開啟，不需要打指令。"""

from __future__ import annotations

import asyncio
import queue
import sys
import threading
import tkinter as tk
from pathlib import Path
from tkinter import messagebox, scrolledtext

sys.path.insert(0, str(Path(__file__).resolve().parent))
import xianyu_order as core  # noqa: E402

LIST_FILE = core.BASE_DIR / "orders.txt"
HINT = ("# 每行一個商品：先貼網址（或閒魚分享的整段文字），最後空一格寫價格\n"
        "# 要選規格的，中間加「規格:白色/128G」（文字要和商品頁上一模一樣）\n"
        "# 例：https://www.goofish.com/item?id=123456789 1099\n"
        "# 例：https://www.goofish.com/item?id=987654321 規格:黑色/256G 2300\n")


class QueueWriter:
    """把 print／log 的輸出轉到視窗裡。"""

    def __init__(self, q: queue.Queue):
        self.q = q

    def write(self, text: str) -> None:
        if text and text != "\a":
            self.q.put(text)

    def flush(self) -> None:
        pass


class App:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.q: queue.Queue = queue.Queue()
        self.confirm = threading.Event()
        self.stop = threading.Event()
        self.busy = False

        root.title("閒魚下單工具")
        root.geometry("760x660")
        font = ("Microsoft JhengHei UI", 11)

        tk.Label(root, text="① 第一次使用先按「登入閒魚」　② 貼上商品網址和價格　③ 按「核對並下單」",
                 font=font, anchor="w").pack(fill="x", padx=12, pady=(12, 4))

        self.orders = scrolledtext.ScrolledText(root, height=9, font=("Consolas", 11))
        self.orders.pack(fill="x", padx=12)
        self.orders.insert("1.0", LIST_FILE.read_text(encoding="utf-8") if LIST_FILE.exists() else HINT)

        opts = tk.Frame(root)
        opts.pack(fill="x", padx=12, pady=6)
        tk.Label(opts, text="開始時間", font=font).pack(side="left")
        self.start_time = tk.Entry(opts, width=14, font=font)
        self.start_time.pack(side="left", padx=(4, 4))
        tk.Label(opts, text="（例 20:00，留空＝馬上）", font=font, fg="#666").pack(side="left")

        opts2 = tk.Frame(root)
        opts2.pack(fill="x", padx=12)
        self.watch = tk.BooleanVar(value=False)
        tk.Checkbutton(opts2, text="價格還沒到時，每 60 秒自動重查，降到就下單", variable=self.watch,
                       font=font).pack(side="left")

        btns = tk.Frame(root)
        btns.pack(fill="x", padx=12, pady=4)
        self.buttons = [
            tk.Button(btns, text="登入閒魚", font=font, width=12, command=self.do_login),
            tk.Button(btns, text="只核對不下單", font=font, width=12, command=lambda: self.do_run(True)),
            tk.Button(btns, text="核對並下單", font=font, width=12, bg="#ffe14d", command=lambda: self.do_run(False)),
        ]
        for b in self.buttons:
            b.pack(side="left", padx=(0, 8))
        self.done_btn = tk.Button(btns, text="完成／關閉瀏覽器", font=font, state="disabled", command=self.on_done)
        self.done_btn.pack(side="right")

        tk.Label(root, text="進度", font=font, anchor="w").pack(fill="x", padx=12, pady=(8, 0))
        self.log = scrolledtext.ScrolledText(root, font=("Microsoft JhengHei UI", 10), state="disabled")
        self.log.pack(fill="both", expand=True, padx=12, pady=(0, 12))

        sys.stdout = sys.stderr = QueueWriter(self.q)
        root.after(100, self.pump)
        root.protocol("WM_DELETE_WINDOW", self.on_close)

    # ---- 背景執行 ----

    def pump(self) -> None:
        while not self.q.empty():
            self.log.configure(state="normal")
            self.log.insert("end", self.q.get())
            self.log.see("end")
            self.log.configure(state="disabled")
        self.root.after(100, self.pump)

    def start(self, coro_factory) -> None:
        if self.busy:
            return
        self.busy = True
        self.confirm.clear()
        self.stop.clear()
        for b in self.buttons:
            b.configure(state="disabled")
        self.done_btn.configure(state="normal")

        def worker():
            try:
                asyncio.run(coro_factory())
            except Exception as e:
                core.log(f"發生錯誤：{e}")
            finally:
                self.root.after(0, self.finish)

        threading.Thread(target=worker, daemon=True).start()

    def finish(self) -> None:
        self.busy = False
        for b in self.buttons:
            b.configure(state="normal")
        self.done_btn.configure(state="disabled", text="完成／關閉瀏覽器")

    async def wait_user(self) -> None:
        self.root.after(0, lambda: self.done_btn.configure(text="完成／關閉瀏覽器 ←"))
        await asyncio.to_thread(self.confirm.wait)

    def on_done(self) -> None:
        self.stop.set()
        self.confirm.set()

    def on_close(self) -> None:
        if self.busy and not messagebox.askyesno("閒魚下單工具", "還在執行中，確定要關閉嗎？"):
            return
        self.root.destroy()

    # ---- 按鈕 ----

    def do_login(self) -> None:
        cfg = core.Config.load(core.BASE_DIR / "config.toml")
        core.log("正在開啟瀏覽器……登入好後，按右邊的「完成／關閉瀏覽器」")
        self.start(lambda: core.login(cfg, wait_user=self.wait_user))

    def do_run(self, check_only: bool) -> None:
        text = self.orders.get("1.0", "end")
        orders = []
        for line in text.splitlines():
            try:
                if o := core.parse_order_line(line):
                    orders.append(o)
            except ValueError as e:
                messagebox.showerror("格式不對", str(e))
                return
        if not orders:
            messagebox.showinfo("閒魚下單工具", "請先貼上商品網址和價格，一行一個，價格寫在最後。")
            return
        try:
            start_at = core.parse_start_time(self.start_time.get())
        except ValueError as e:
            messagebox.showerror("時間格式不對", str(e))
            return
        when = f"在 {start_at:%m/%d %H:%M:%S} " if start_at else ""
        if not check_only and not messagebox.askyesno(
            "確認下單", f"共 {len(orders)} 件商品，{when}核對通過就會直接下單，確定嗎？"
        ):
            return
        LIST_FILE.write_text(text.strip() + "\n", encoding="utf-8")
        cfg = core.Config.load(core.BASE_DIR / "config.toml")
        watch = 60 if self.watch.get() else None
        core.log(f"開始處理 {len(orders)} 件商品……")
        self.start(lambda: core.run(cfg, orders, check_only, watch,
                                    wait_user=self.wait_user, stopped=self.stop.is_set, start_at=start_at))


if __name__ == "__main__":
    root = tk.Tk()
    App(root)
    root.mainloop()
