"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { DocReader } from "@/components/doc-reader";
import { Crumbs } from "@/components/ui/layout";
import { docHref, docPathOf, START } from "@/lib/docs";

// One service's docs, a page at a time: /docs/<service>/<path under docs/>.
export default function DocPage() {
  const params = useParams<{ service: string; path?: string[] }>();
  const router = useRouter();
  const id = decodeURIComponent(params.service);
  const path = docPathOf(params.path);
  return (
    <>
      <Crumbs>
        <Link href="/docs">Docs</Link>
        <span>/</span>
        <Link href={`/services/${encodeURIComponent(id)}`} className="font-mono">
          {id}
        </Link>
        {path !== START ? (
          <>
            <span>/</span>
            <span className="font-mono">{path}</span>
          </>
        ) : null}
      </Crumbs>
      <DocReader id={id} path={path} onOpen={(p, hash) => router.push(docHref(id, p, hash))} />
    </>
  );
}
