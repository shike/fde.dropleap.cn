import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

export const metadata: Metadata = { title: "自荐上榜" };

export default function NominatePage() {
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">自荐上榜</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-neutral-500">
          你就是 FDE？扫码加主理人微信（备注「<strong className="text-neutral-700">FDE自荐</strong>」），
          通过后上「中国 FDE 名录」——和数万名一线实践者出现在同一张地图上。
        </p>
      </div>

      <section className="grid gap-6 md:grid-cols-[280px_1fr] md:items-start">
        <div className="rounded-2xl border border-neutral-200 bg-white p-5 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/wechat-qr.jpg"
            alt="主理人个人微信二维码（施可 · 江苏苏州）"
            className="mx-auto w-full max-w-[260px] rounded-xl"
          />
          <p className="mt-3 text-sm font-medium text-neutral-700">微信扫码添加主理人</p>
          <p className="mt-1 text-xs text-neutral-400">备注「FDE自荐」优先通过</p>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-neutral-200 bg-white p-6">
            <h2 className="font-bold tracking-tight">加微信后，请发我：</h2>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-neutral-600">
              <li>你的称呼与当前身份（公司 / 职位 / 独立开发者）</li>
              <li>
                公开主页：GitHub、抖音或个人网站链接（至少一个，
                <strong>有公开自述更容易通过</strong>）
              </li>
              <li>一段交付故事：驻场给谁解决了什么问题、你亲手做了什么</li>
              <li>（可选）代表作品：文章 / 开源项目 / 演讲 / 视频</li>
            </ol>
          </div>

          <div className="rounded-2xl border border-dashed border-neutral-300 bg-white p-6">
            <h3 className="text-sm font-bold text-neutral-800">收录标准（严口径）</h3>
            <ol className="mt-2.5 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-neutral-500">
              <li>驻场或深度贴近客户工作</li>
              <li>亲手用技术手段解决客户具体问题</li>
              <li>对交付结果负责</li>
            </ol>
            <p className="mt-3 text-xs leading-relaxed text-neutral-400">
              仅收录中国大陆从业者；营销 / 培训向账号不收；
              条目信息全部来自公开渠道并附证据，
              <Link href="/about" className="mx-0.5 underline hover:text-neutral-600">详见收录标准</Link>。
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
