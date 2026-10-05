"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const NAV = [
  { href: "/persons", label: "人物" },
  { href: "/cases", label: "案例" },
  { href: "/companies", label: "公司" },
  { href: "/policies", label: "政策" },
  { href: "/about", label: "收录标准" },
];

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-30 border-b border-neutral-200/80 bg-white/95 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4">
        <Link href="/" className="flex shrink-0 items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-neutral-900 text-[11px] font-bold tracking-tight text-white">
            FDE
          </span>
          <span className="text-[15px] font-semibold tracking-tight">中国 FDE 名录</span>
        </Link>

        {/* 桌面导航 */}
        <nav className="hidden items-center gap-1 text-sm md:flex">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`rounded-lg px-3 py-1.5 transition-colors ${
                pathname === n.href
                  ? "bg-neutral-100 font-medium text-neutral-950"
                  : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-950"
              }`}
            >
              {n.label}
            </Link>
          ))}
          <Link
            href="/nominate"
            className="ml-2 rounded-lg bg-neutral-900 px-3.5 py-1.5 font-medium text-white transition-colors hover:bg-neutral-700"
          >
            自荐上榜
          </Link>
        </nav>

        {/* 移动端汉堡按钮 */}
        <button
          className="flex h-9 w-9 flex-col items-center justify-center gap-1 rounded-lg border border-neutral-200 md:hidden"
          aria-label="菜单"
          onClick={() => setOpen(!open)}
        >
          <span className={`h-0.5 w-4 bg-neutral-700 transition-transform ${open ? "translate-y-[3px] rotate-45" : ""}`} />
          <span className={`h-0.5 w-4 bg-neutral-700 transition-transform ${open ? "-translate-y-[3px] -rotate-45" : ""}`} />
        </button>
      </div>

      {/* 移动端菜单 */}
      {open && (
        <nav className="border-t border-neutral-100 bg-white px-4 py-3 md:hidden">
          <div className="grid grid-cols-2 gap-2">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                onClick={() => setOpen(false)}
                className="rounded-lg bg-neutral-50 px-3 py-2 text-sm text-neutral-700"
              >
                {n.label}
              </Link>
            ))}
            <Link
              href="/nominate"
              onClick={() => setOpen(false)}
              className="col-span-2 rounded-lg bg-neutral-900 px-3 py-2 text-center text-sm font-medium text-white"
            >
              自荐上榜
            </Link>
          </div>
        </nav>
      )}
    </header>
  );
}
