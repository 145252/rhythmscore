#!/usr/bin/env python3
"""RhythmScore 激活码生成器(作者专用 GUI)
用法: python scripts/license_studio.py
粘贴用户机器码(可多行),点「生成激活码」,自动输出并复制。
"""
import base64
import os
import sys
import tkinter as tk
from tkinter import messagebox, scrolledtext

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

PRIV = os.environ.get(
    'RS_LICENSE_PRIV',
    os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'build', 'license_private.pem'),
)


def find_priv() -> str:
    """打包成 .app 后从 Resources 读私钥;开发时从项目 build 读"""
    # 1) PyInstaller 打包:Resources/license_private.pem(与脚本同级上两级)
    bundled = os.path.join(os.path.dirname(sys.executable), '..', 'Resources', 'license_private.pem')
    if os.path.exists(bundled):
        return os.path.abspath(bundled)
    # 2) 开发环境:scripts/../build/license_private.pem
    return os.path.abspath(PRIV)


def sign_machine(machine: str, priv: object) -> str:
    sig = priv.sign(machine.strip().encode('utf-8'), padding.PKCS1v15(), hashes.SHA256())
    return base64.b64encode(sig).decode()


def main() -> None:
    priv_path = find_priv()
    if not os.path.exists(priv_path):
        root = tk.Tk()
        root.withdraw()
        messagebox.showerror('缺少私钥', f'找不到私钥文件:\n{priv_path}\n请先运行 node scripts/gen_keys.js 生成密钥对。')
        root.destroy()
        return

    with open(priv_path, 'rb') as f:
        priv = serialization.load_pem_private_key(f.read(), password=None)

    win = tk.Tk()
    win.title('RhythmScore 激活码生成器')
    win.geometry('560x480')
    win.configure(bg='#f4f5f7')

    tk.Label(win, text='粘贴用户机器码(每行一个,支持批量):', anchor='w', bg='#f4f5f7', font=('PingFang SC', 12)).pack(fill='x', padx=14, pady=(14, 4))

    inp = scrolledtext.ScrolledText(win, height=6, font=('Menlo', 11))
    inp.pack(fill='x', padx=14)

    def do_generate() -> None:
        lines = [ln.strip() for ln in inp.get('1.0', 'end').splitlines() if ln.strip()]
        if not lines:
            messagebox.showwarning('提示', '请先粘贴机器码')
            return
        rows = []
        keys = []
        for m in lines:
            try:
                k = sign_machine(m, priv)
                rows.append(f'{m}\t→\t{k}')
                keys.append(k)
            except Exception as e:  # noqa: BLE001
                rows.append(f'{m}\t→\t[生成失败: {e}]')
        out.delete('1.0', 'end')
        out.insert('1.0', '\n'.join(rows))
        # 只复制激活码本身(不含机器码),避免粘贴出错
        win.clipboard_clear()
        win.clipboard_append('\n'.join(keys))
        status.set(f'已生成 {len(keys)} 个激活码,【激活码】已复制(粘贴到软件时只贴激活码)')

    def do_copy() -> None:
        txt = out.get('1.0', 'end').strip()
        if txt:
            # 只复制每行的激活码(最后一个 \t 之后)
            keys = [ln.rsplit('\t', 1)[-1].strip() for ln in txt.splitlines() if ln.strip()]
            win.clipboard_clear()
            win.clipboard_append('\n'.join(keys))
            status.set(f'已复制 {len(keys)} 个激活码')

    btns = tk.Frame(win, bg='#f4f5f7')
    btns.pack(fill='x', padx=14, pady=8)
    tk.Button(btns, text='生成激活码', command=do_generate, bg='#378add', fg='white',
              activebackground='#2e7bc9', activeforeground='white', relief='flat', padx=16, pady=6,
              font=('PingFang SC', 12)).pack(side='left')
    tk.Button(btns, text='复制全部', command=do_copy, bg='#eef1f5', relief='flat', padx=12, pady=6,
              font=('PingFang SC', 12)).pack(side='left', padx=8)

    tk.Label(win, text='生成结果(机器码 → 激活码):', anchor='w', bg='#f4f5f7', font=('PingFang SC', 12)).pack(fill='x', padx=14)

    out = scrolledtext.ScrolledText(win, height=10, font=('Menlo', 11), bg='#ffffff')
    out.pack(fill='both', expand=True, padx=14, pady=(4, 8))

    status = tk.StringVar(value='就绪')
    tk.Label(win, textvariable=status, anchor='w', bg='#f4f5f7', fg='#666', font=('PingFang SC', 10)).pack(fill='x', padx=14, pady=(0, 10))

    win.mainloop()


if __name__ == '__main__':
    main()
