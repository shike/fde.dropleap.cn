import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "中国 FDE 名录 · China FDE Directory",
    template: "%s · 中国 FDE 名录",
  },
  description:
    "中国最权威的 Forward Deployed Engineer（前置部署工程师）名录：收录中国大陆一线交付的 FDE 与 AI 落地从业者。人物、案例、公司、政策，条条附证据链接，每日更新。",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "zh_CN",
    siteName: "中国 FDE 名录",
    url: SITE_URL,
    title: "中国 FDE 名录 · China FDE Directory",
    description:
      "收录中国大陆一线交付的 FDE 与 AI 落地从业者。人物、案例、公司、政策，条条附证据链接。",
  },
  twitter: {
    card: "summary",
    title: "中国 FDE 名录 · China FDE Directory",
    description: "中国最权威的前置部署工程师名录：人物、案例、公司、政策，条条附证据。",
  },
};

const NAV = [
  { href: "/persons", label: "人物" },
  { href: "/cases", label: "案例" },
  { href: "/companies", label: "公司" },
  { href: "/policies", label: "政策" },
  { href: "/about", label: "收录标准" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-neutral-50 text-neutral-900">
        <script
          dangerouslySetInnerHTML={{
            __html:
              'var _hmt = _hmt || [];(function() { var hm = document.createElement("script"); hm.src = "https://hm.baidu.com/hm.js?52e20725c30e647acc0ef06411087986"; var s = document.getElementsByTagName("script")[0]; s.parentNode.insertBefore(hm, s); })();',
          }}
        />
        <header className="sticky top-0 z-20 border-b border-neutral-200/80 bg-white/85 backdrop-blur-md">
          <div className="mx-auto flex h-14 max-w-6xl items-center gap-8 px-4">
            <Link href="/" className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-neutral-900 text-[11px] font-bold tracking-tight text-white">
                FDE
              </span>
              <span className="text-[15px] font-semibold tracking-tight">
                中国 FDE 名录
              </span>
            </Link>
            <nav className="ml-auto flex items-center gap-1 text-sm">
              {NAV.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className="rounded-lg px-3 py-1.5 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-950"
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
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">{children}</main>
        <footer className="border-t border-neutral-200/80 bg-white">
          <div className="mx-auto max-w-6xl px-4 py-10">
            <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
              <div className="max-w-xl">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-neutral-900 text-[10px] font-bold text-white">
                    FDE
                  </span>
                  <span className="text-sm font-semibold">中国 FDE 名录</span>
                </div>
                <p className="mt-3 text-xs leading-relaxed text-neutral-400">
                  中国最权威的前置部署工程师（Forward Deployed Engineer）名录。
                  所有信息来自公开渠道，仅供行业研究参考；不展示任何个人联系方式。
                  条目有误或希望收录 / 更正 / 删除？
                  <Link href="/nominate" className="mx-0.5 underline hover:text-neutral-600">
                    提交申请
                  </Link>
                  ，核实后 24 小时内处理。
                </p>
              </div>
              <div className="flex gap-10 text-xs text-neutral-500">
                <div className="space-y-2">
                  <p className="font-semibold text-neutral-700">名录</p>
                  <Link href="/persons" className="block hover:text-neutral-900">人物</Link>
                  <Link href="/cases" className="block hover:text-neutral-900">案例</Link>
                  <Link href="/companies" className="block hover:text-neutral-900">公司</Link>
                </div>
                <div className="space-y-2">
                  <p className="font-semibold text-neutral-700">参与</p>
                  <Link href="/nominate" className="block hover:text-neutral-900">自荐 / 提名</Link>
                  <Link href="/about" className="block hover:text-neutral-900">收录标准</Link>
                  <Link href="/about#disclaimer" className="block hover:text-neutral-900">免责声明</Link>
                </div>
              </div>
            </div>
            <p className="mt-8 border-t border-neutral-100 pt-6 text-xs text-neutral-400">
              © 2026 中国 FDE 名录 · 持续更新 · 数据来自公开渠道
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
