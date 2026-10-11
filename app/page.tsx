import { displayName } from "@/lib/display-name";

const service = "forge-web";
const team = "platform-engineering";

export default function Home() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-24">
      <p className="text-sm font-medium uppercase tracking-wide text-indigo-600">Forge · Next.js</p>
      <h1 className="text-4xl font-semibold">{displayName(service)}</h1>
      <p className="text-lg text-slate-600">
        Owned by <span className="font-medium text-slate-900">{team}</span>. Edit{" "}
        <code className="rounded bg-slate-200 px-1.5 py-0.5 text-sm">app/page.tsx</code> and push to{" "}
        <code className="rounded bg-slate-200 px-1.5 py-0.5 text-sm">main</code>: CI tests it, builds the image and
        deploys it to staging.
      </p>
      <ul className="list-disc space-y-1 pl-6 text-slate-600">
        <li>
          <code>forge deploy status {service}</code>: what runs where
        </li>
        <li>
          <code>forge env create &lt;name&gt; --service {service}</code>: a preview of any branch
        </li>
        <li>
          <code>forge deploy promote {service}</code>: staging to production
        </li>
      </ul>
    </main>
  );
}
